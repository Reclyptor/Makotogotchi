// The calendar of dated holidays (SPEC §22.11). Like venues, a holiday is
// presentation: it is read off the pet's calendar day, which every client and
// the server already hold, and nothing about it enters `PetState` or the
// event log.

import { civilFromDays, type PetClock } from "./clock";

export type HolidayId = "halloween" | "thanksgiving" | "christmas" | "newYear" | "valentines";

/** The same date every year. */
type FixedDate = { month: number; day: number };
/** The nth weekday of a month: `weekday` 0 is Sunday, so the 4th Thursday of November is 11, 4, 4. */
type NthWeekday = { month: number; weekday: number; nth: number };

type Holiday = { id: HolidayId; rule: FixedDate | NthWeekday };

const DAYS_PER_WEEK = 7;
/** The Unix epoch, 1970-01-01, was a Thursday. */
const EPOCH_WEEKDAY = 4;

export const HOLIDAYS: readonly Holiday[] = [
  { id: "valentines", rule: { month: 2, day: 14 } },
  { id: "halloween", rule: { month: 10, day: 31 } },
  { id: "thanksgiving", rule: { month: 11, weekday: 4, nth: 4 } },
  { id: "christmas", rule: { month: 12, day: 25 } },
  { id: "newYear", rule: { month: 1, day: 1 } },
];

export const isHolidayId = (value: unknown): value is HolidayId =>
  HOLIDAYS.some((holiday) => holiday.id === value);

const matches = (rule: Holiday["rule"], dayIndex: number): boolean => {
  const { month, day } = civilFromDays(dayIndex);
  if (rule.month !== month) return false;
  if ("day" in rule) return rule.day === day;
  const weekday = (((dayIndex + EPOCH_WEEKDAY) % DAYS_PER_WEEK) + DAYS_PER_WEEK) % DAYS_PER_WEEK;
  return rule.weekday === weekday && Math.ceil(day / DAYS_PER_WEEK) === rule.nth;
};

/**
 * The holiday on a pet-day, or null. `dayIndex` is `petClock`'s — epoch days
 * on the pet's calendar — so a holiday starts and ends at the pet's midnight
 * wherever the player is, and returns every year without a code change.
 */
export const holidayOn = (dayIndex: number): HolidayId | null =>
  HOLIDAYS.find((holiday) => matches(holiday.rule, dayIndex))?.id ?? null;

/** The hour New Year's Eve's fireworks begin, and the hour after midnight they end. */
const FIREWORKS_FROM_HOUR = 23;
const FIREWORKS_UNTIL_HOUR = 1;

/**
 * Whether the sky over the window is lit with fireworks: from 23:00 on Dec 31
 * until 01:00 on Jan 1, pet time. A presentation moment, not a holiday day —
 * the room around it is the ordinary Dec 31 room until midnight, and New
 * Year's from then.
 */
export const fireworksAt = (clock: Pick<PetClock, "hour" | "dayIndex">): boolean => {
  const { month, day } = civilFromDays(clock.dayIndex);
  if (month === 12 && day === 31) return clock.hour >= FIREWORKS_FROM_HOUR;
  return month === 1 && day === 1 && clock.hour < FIREWORKS_UNTIL_HOUR;
};
