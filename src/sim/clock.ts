// The pet's own wall clock (SPEC §22.1). Every client reads the hour in the
// pet's timezone rather than its own, which is what lets a room in Osaka and
// a room in Chicago hold the same dusk at the same instant.
//
// It lives in the sim rather than beside the scene because the server needs
// the same `dayIndex` the scene draws with: it stamps each venue ballot with
// the day that ballot decides (SPEC §22.9). Note that `schedule.ts`'s
// `localDayIndex` counts days since GENESIS, which is a different base —
// the two are not interchangeable, and keying a ballot on the wrong one
// produces a feature that looks wired up and silently does nothing.

export type PetClock = {
  hour: number;
  minute: number;
  /** 1-based month, for the season. */
  month: number;
  /** Days since the Unix epoch on the pet's calendar — fixes the weather. */
  dayIndex: number;
};

// Building an Intl.DateTimeFormat is expensive out of all proportion to what
// it is used for here — measured in Chrome at 43µs against 1.65µs to reuse
// one, and the scene asks for the pet's hour on every frame it paints. The
// formatter depends on nothing but the zone, so one per zone is all there
// ever needs to be; the map holds a handful of entries at the very most.
const formatters = new Map<string, Intl.DateTimeFormat>();

const formatterFor = (timeZone: string): Intl.DateTimeFormat => {
  const cached = formatters.get(timeZone);
  if (cached) return cached;
  const created = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
  formatters.set(timeZone, created);
  return created;
};

/**
 * Days from the civil date to the Unix epoch — Howard Hinnant's algorithm,
 * exact for every proleptic Gregorian date and pure integer arithmetic.
 *
 * `Date.UTC` would say the same thing in one line, but time enters this
 * layer only as an explicit parameter (SPEC §4.4, enforced in eslint), and
 * that rule is worth more than the line it costs: it is what stops the
 * simulation from ever quietly reading the machine's clock.
 */
const daysFromCivil = (year: number, month: number, day: number): number => {
  const y = year - (month <= 2 ? 1 : 0);
  const era = Math.floor(y / 400);
  const yearOfEra = y - era * 400; // [0, 399]
  const dayOfYear = Math.floor((153 * (month + (month > 2 ? -3 : 9)) + 2) / 5) + day - 1; // [0, 365]
  const dayOfEra = yearOfEra * 365 + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100) + dayOfYear;
  return era * 146_097 + dayOfEra - 719_468;
};

/**
 * The pet's wall clock at an instant. `nowMs` is explicit and required: the
 * scene passes the frame's time, and the server passes its own, so the two
 * agree about which day a venue ballot belongs to (SPEC §22.9).
 */
export const petClock = (timeZone: string, nowMs: number): PetClock => {
  // formatToParts takes an epoch millisecond directly — no Date needed.
  const parts = formatterFor(timeZone).formatToParts(nowMs);
  const field = (type: Intl.DateTimeFormatPartTypes): number => Number(parts.find((part) => part.type === type)?.value ?? 0);
  const month = field("month");
  return {
    hour: field("hour") % 24,
    minute: field("minute"),
    month,
    dayIndex: daysFromCivil(field("year"), month, field("day")),
  };
};
