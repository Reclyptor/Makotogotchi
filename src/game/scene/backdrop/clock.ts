// The pet's own wall clock (SPEC §22.1). Every client reads the hour in the
// pet's timezone rather than its own, which is what lets a room in Osaka and
// a room in Chicago hold the same dusk at the same instant.

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

export const petClock = (timeZone: string, now: Date = new Date()): PetClock => {
  const parts = formatterFor(timeZone).formatToParts(now);
  const field = (type: Intl.DateTimeFormatPartTypes): number => Number(parts.find((part) => part.type === type)?.value ?? 0);
  const year = field("year");
  const month = field("month");
  const day = field("day");
  return {
    hour: field("hour") % 24,
    minute: field("minute"),
    month,
    dayIndex: Math.floor(Date.UTC(year, month - 1, day) / 86_400_000),
  };
};
