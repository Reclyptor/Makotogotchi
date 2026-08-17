// What the room's backdrop is made of (SPEC §22.1): the hour, the weather,
// and the season. Pure and deterministic — the sky is derived from the pet's
// own clock and the generation seed, never from the viewer's machine, so a
// caretaker in Tokyo and one in Chicago look at the same dusk and the same
// rain at the same instant.
//
// Nothing here reaches PetState. The backdrop is derived exactly the way the
// animation key is (SPEC §4.3).

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
