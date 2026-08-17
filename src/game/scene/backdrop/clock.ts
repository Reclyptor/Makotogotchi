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

export const petClock = (timeZone: string, now: Date = new Date()): PetClock => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(now);
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
