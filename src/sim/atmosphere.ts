// What the room's backdrop is made of (SPEC §22.1): the hour, the weather,
// and the season. Pure and deterministic — the sky is derived from the pet's
// own clock and the generation seed, never from the viewer's machine, so a
// caretaker in Tokyo and one in Chicago look at the same dusk and the same
// rain at the same instant.
//
// Nothing here reaches PetState. The backdrop is derived exactly the way the
// animation key is (SPEC §4.3).

import type { SleepReason } from "./model";
import { draw32, RNG_PURPOSE } from "./rng";
import { SLEEP_HOUR, WAKE_HOUR } from "./tuning";

export const DAY_SEGMENTS = ["night", "dawn", "morning", "midday", "afternoon", "dusk"] as const;
export type DaySegment = (typeof DAY_SEGMENTS)[number];

export const SEASONS = ["spring", "summer", "autumn", "winter"] as const;
export type Season = (typeof SEASONS)[number];

export const WEATHERS = ["clear", "cloudy", "rain", "snow"] as const;
export type Weather = (typeof WEATHERS)[number];

const MINUTES_PER_DAY = 24 * 60;

// Segment boundaries, in pet-local hours. They bracket the sleep schedule
// (§2.4): dawn ends exactly as the pet wakes at 07:00, and night falls an
// hour before it goes to bed at 22:00, so the room is already dim when it
// climbs into bed.
const SEGMENT_STARTS: readonly { hour: number; segment: DaySegment }[] = [
  { hour: 0, segment: "night" },
  { hour: 5, segment: "dawn" },
  { hour: WAKE_HOUR, segment: "morning" },
  { hour: 11, segment: "midday" },
  { hour: 15, segment: "afternoon" },
  { hour: 18, segment: "dusk" },
  { hour: SLEEP_HOUR - 1, segment: "night" },
];

/** How long before a boundary the outgoing sky starts dissolving. */
const TRANSITION_MINUTES = 40;
/**
 * The dissolve is quantized into steps so the composed sky is a small,
 * stable set of images: it can be cached and reused across frames instead of
 * being recomputed every time the clock ticks a second.
 */
export const BLEND_STEPS = 8;

export type SkyMoment = {
  /** Position through the pet-day, 0 at midnight to 1 at the next. */
  progress: number;
  /** The sky being drawn. */
  segment: DaySegment;
  /** The sky it is dissolving into — equal to `segment` when settled. */
  next: DaySegment;
  /** Dissolve position, 0 (settled) to BLEND_STEPS - 1 (nearly arrived). */
  blend: number;
  /** How high the sun rides, 0 at night to 1 at solar noon. */
  sunHeight: number;
};

const minutesOf = (hour: number, minute: number): number => ((hour % 24) + 24) % 24 * 60 + minute;

/** Index of the boundary in force at a given minute. */
const boundaryIndex = (minutes: number): number => {
  let index = 0;
  for (let i = 0; i < SEGMENT_STARTS.length; i++) {
    if (minutes >= SEGMENT_STARTS[i]!.hour * 60) index = i;
  }
  return index;
};

/**
 * Where the sun sits, as a fraction of its arc. Zero all night; a smooth
 * hump peaking midway between dawn and dusk. Drives the celestial body's
 * position and the strength of the light the window throws on the floor.
 */
const sunHeightAt = (minutes: number): number => {
  const first = SEGMENT_STARTS[1]!.hour * 60; // dawn begins
  const last = SEGMENT_STARTS[SEGMENT_STARTS.length - 1]!.hour * 60; // night falls
  if (minutes <= first || minutes >= last) return 0;
  return Math.sin(((minutes - first) / (last - first)) * Math.PI);
};

/** The state of the sky at a pet-local time of day (SPEC §22.2). */
export const skyMomentAt = (hour: number, minute: number): SkyMoment => {
  const minutes = minutesOf(hour, minute);
  const index = boundaryIndex(minutes);
  const current = SEGMENT_STARTS[index]!;
  const upcoming = SEGMENT_STARTS[(index + 1) % SEGMENT_STARTS.length];
  // The final entry wraps to the first boundary of the next day.
  const nextStart = index + 1 < SEGMENT_STARTS.length ? upcoming!.hour * 60 : MINUTES_PER_DAY;
  const nextSegment = index + 1 < SEGMENT_STARTS.length ? upcoming!.segment : SEGMENT_STARTS[0]!.segment;

  const untilNext = nextStart - minutes;
  const blend =
    untilNext < TRANSITION_MINUTES
      ? Math.min(BLEND_STEPS - 1, Math.floor(((TRANSITION_MINUTES - untilNext) / TRANSITION_MINUTES) * BLEND_STEPS))
      : 0;

  return {
    progress: minutes / MINUTES_PER_DAY,
    segment: current.segment,
    next: blend > 0 ? nextSegment : current.segment,
    blend,
    sunHeight: sunHeightAt(minutes),
  };
};

/** Northern-hemisphere seasons from a 1-based month. */
export const seasonFor = (month: number): Season => {
  const normalized = ((Math.trunc(month) - 1) % 12 + 12) % 12; // 0 = January
  if (normalized <= 1 || normalized === 11) return "winter";
  if (normalized <= 4) return "spring";
  if (normalized <= 7) return "summer";
  return "autumn";
};

// One forecast per pet-day, weighted by season: snow belongs to winter
// alone, rain runs heavy in spring and autumn, and summer is mostly clear.
const WEATHER_WEIGHTS: Record<Season, Record<Weather, number>> = {
  spring: { clear: 4, cloudy: 3, rain: 4, snow: 0 },
  summer: { clear: 6, cloudy: 2, rain: 2, snow: 0 },
  autumn: { clear: 3, cloudy: 4, rain: 4, snow: 0 },
  winter: { clear: 3, cloudy: 4, rain: 1, snow: 3 },
};

/**
 * The day's weather (SPEC §22.1). Keyed by the day index rather than the
 * tick, so it is fixed the moment the pet's calendar turns over and every
 * caretaker spends the whole day under the same sky.
 */
export const weatherFor = (seed: number, dayIndex: number, season: Season): Weather => {
  const weights = WEATHER_WEIGHTS[season];
  const total = WEATHERS.reduce((sum, weather) => sum + weights[weather], 0);
  let remaining = draw32(seed, dayIndex, RNG_PURPOSE.weather) % total;
  // The walk always lands inside the table; the last eligible entry is the
  // tail case for the same reason the ambient table has one (§21.5).
  let chosen: Weather = "clear";
  for (const weather of WEATHERS) {
    if (weights[weather] === 0) continue;
    chosen = weather;
    if (remaining < weights[weather]) break;
    remaining -= weights[weather];
  }
  return chosen;
};

export type Celestial = {
  body: "sun" | "moon";
  /** Position along the arc, 0 rising to 1 setting. */
  t: number;
  /** Height above the horizon, 0 at the edges to 1 at the peak. */
  height: number;
};

/**
 * Which light is in the sky and where it sits (SPEC §22.2). The sun runs
 * from first light to nightfall and the moon takes the hours between, so
 * the window always holds exactly one of them.
 */
export const celestialAt = (hour: number, minute: number): Celestial => {
  const minutes = minutesOf(hour, minute);
  const sunrise = SEGMENT_STARTS[1]!.hour * 60;
  const nightfall = SEGMENT_STARTS[SEGMENT_STARTS.length - 1]!.hour * 60;
  if (minutes >= sunrise && minutes < nightfall) {
    const t = (minutes - sunrise) / (nightfall - sunrise);
    return { body: "sun", t, height: Math.sin(t * Math.PI) };
  }
  const nightLength = MINUTES_PER_DAY - nightfall + sunrise;
  const since = (minutes - nightfall + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  const t = since / nightLength;
  return { body: "moon", t, height: Math.sin(t * Math.PI) };
};

export const isDaySegment = (value: unknown): value is DaySegment =>
  typeof value === "string" && (DAY_SEGMENTS as readonly string[]).includes(value);

// ── venues (SPEC §22.8) ─────────────────────────────────────────────────────

/** The venue catalog, in declaration order — the pick depends on it. New
 *  venues are appended, never inserted: the order is what every client walks. */
export const VENUE_IDS = ["home", "garden", "meadow", "beach", "forest", "blossom", "pond", "shrine", "mountain"] as const;
export type VenueId = (typeof VENUE_IDS)[number];

const AWAY_VENUES = VENUE_IDS.filter((venue) => venue !== "home");

/** The venues every room owns from the start (SPEC §22.8). They live here
 *  rather than beside the scenes because the server needs the rotation pool
 *  too, and it may not reach into `@/game`. */
export const FREE_VENUES: readonly VenueId[] = ["garden", "meadow"];

/**
 * The rotation pool: the free venues plus whatever the room has funded
 * (SPEC §22.8). One expression, because the scene, the caption and the
 * ballot must all walk the same pool — three copies of it is three ways for
 * them to disagree about where Makoto is. Walking the catalog rather than
 * the decor list gives declaration order and de-duplication for free.
 */
export const rotationPool = (decor: readonly string[]): VenueId[] =>
  AWAY_VENUES.filter((venue) => FREE_VENUES.includes(venue) || decor.includes(venue));

// ── the ballot (SPEC §22.9) ─────────────────────────────────────────────────

/** The most a venue can be backed by in one day — an anti-whale ceiling, set
 *  high enough that two caretakers backing different places can still say
 *  which of them wants it more (SPEC §22.9). */
export const BALLOT_MAX_EXTRA_TICKETS = 30;
/** What one extra ticket costs. Ten, so the shop's existing +10 and +50 are
 *  a ticket and five of them. */
export const VENUE_TICKET_COINS = 10;

/** A day's ballot: venue id to the extra tickets bought for it. */
export type VenueTickets = Readonly<Record<string, number>>;

/** One day's tickets, as they ride the roomState broadcast. */
export type DayBallot = { forDay: number; tickets: VenueTickets };

/**
 * The tickets weighting a given day, out of whatever ballots a client is
 * holding. Selecting by *matching* the day rather than by position is what
 * makes the midnight turn seamless: a client whose clock has rolled over
 * finds its new today already in the payload it has, and a broadcast that
 * is a few seconds stale is harmless rather than a divergence (SPEC §22.9).
 */
export const ticketsFor = (ballots: readonly DayBallot[], dayIndex: number): VenueTickets =>
  ballots.find((ballot) => ballot.forDay === dayIndex)?.tickets ?? {};

/**
 * A venue's weight in the draw. The counts arrive over the wire, so every
 * shape the wire can carry — negative, fractional, oversized, non-finite,
 * absent — has to collapse to something every client agrees on, or two
 * viewers draw different venues from the same broadcast. Zero is the
 * ordinary case: a venue nobody backed is not in the race at all.
 */
const ticketsOf = (tickets: VenueTickets, venue: VenueId): number => {
  const extra = Math.trunc(tickets[venue] ?? 0);
  if (!Number.isFinite(extra) || extra <= 0) return 0;
  return Math.min(BALLOT_MAX_EXTRA_TICKETS, extra);
};

/**
 * Where the day is spent (SPEC §22.8). Keyed by the pet-calendar day index
 * like the weather forecast, so it is fixed the moment the day turns over.
 *
 * **Makoto stays home unless the room voted it somewhere else.** There is no
 * home-or-away roll: an outing is not something that happens to a room, it
 * is something a room decides. A day nobody backed is a day at home, and
 * every venue that was backed is in the race, weighted by its tickets.
 *
 * That is also why this is a *race* and not a tally: the venue with the most
 * tickets is the favourite, never the winner. A single ticket on the meadow
 * against thirty on the mountain still takes the meadow one day in
 * thirty-one, so backing something unpopular is a long shot rather than a
 * waste (SPEC §22.9).
 *
 * The pool and the ballot are mutable server state, not seeded facts:
 * determinism comes from every viewer holding the same
 * (seed, dayIndex, pool, tickets), and both ride the roomState broadcast.
 * The filter normalizes any input ordering to the catalog's own, so the pick
 * cannot depend on array-order accidents.
 */
export const venueAt = (
  seed: number,
  dayIndex: number,
  ownedVenueIds: readonly string[],
  tickets: VenueTickets = {},
): VenueId => {
  // Only venues the room owns AND backed are in the race. Filtering by the
  // pool as well as the ballot is what stops a stale or hostile ballot from
  // sending Makoto somewhere nobody paid to unlock.
  const runners = AWAY_VENUES.filter((venue) => ownedVenueIds.includes(venue) && ticketsOf(tickets, venue) > 0);
  if (runners.length === 0) return "home";

  const weights = runners.map((venue) => ticketsOf(tickets, venue));
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  let remaining = draw32(seed, dayIndex, RNG_PURPOSE.venuePick) % total;
  // The same table walk the weather forecast takes; the last eligible entry
  // is the tail case for the same reason the forecast's is.
  let chosen: VenueId = runners[0]!;
  for (let index = 0; index < runners.length; index++) {
    chosen = runners[index]!;
    if (remaining < weights[index]!) break;
    remaining -= weights[index]!;
  }
  return chosen;
};

export const isVenueId = (value: unknown): value is VenueId =>
  typeof value === "string" && (VENUE_IDS as readonly string[]).includes(value);

/**
 * Where the scene is set right now (SPEC §22.8) — the day's venue, except
 * that the night's sleep is always spent at home: wherever the day was,
 * Makoto comes back to its own bed, and a pet asleep in a field is an
 * oversight rather than a place.
 *
 * Naps and lullabies deliberately do not relocate the scene. They are
 * minutes long and can strike at any hour, and cutting the meadow away
 * mid-afternoon to show a dark room and then back again reads as a bug, not
 * as bedtime. A nap that runs past bedtime is promoted to NIGHT by the
 * projection, so the pet is home by the time it matters.
 *
 * The scene and the caption both come through here. That is the point: they
 * are two renderings of one answer rather than two answers that have to be
 * kept in step.
 */
export const sceneVenueAt = (input: {
  seed: number;
  dayIndex: number;
  /** The room's decor list, which is also where funded venues live. */
  decor: readonly string[];
  ballots: readonly DayBallot[];
  sleepReason: SleepReason | null;
}): VenueId => {
  if (input.sleepReason === "NIGHT") return "home";
  return venueAt(input.seed, input.dayIndex, rotationPool(input.decor), ticketsFor(input.ballots, input.dayIndex));
};
