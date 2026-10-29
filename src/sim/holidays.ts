// The calendar of dated holidays (SPEC §22.11). Like venues, a holiday is
// presentation: it is read off the pet's calendar day, which every client and
// the server already hold, and nothing about it enters `PetState` or the
// event log.

import { civilFromDays } from "./clock";

export type HolidayId = "halloween";

type Holiday = {
  id: HolidayId;
  /** 1-based, as `PetClock.month`. */
  month: number;
  day: number;
};

export const HOLIDAYS: readonly Holiday[] = [{ id: "halloween", month: 10, day: 31 }];

export const isHolidayId = (value: unknown): value is HolidayId =>
  HOLIDAYS.some((holiday) => holiday.id === value);

/**
 * The holiday on a pet-day, or null. `dayIndex` is `petClock`'s — epoch days
 * on the pet's calendar — so a holiday starts and ends at the pet's midnight
 * wherever the player is, and returns every year without a code change.
 */
export const holidayOn = (dayIndex: number): HolidayId | null => {
  const { month, day } = civilFromDays(dayIndex);
  return HOLIDAYS.find((holiday) => holiday.month === month && holiday.day === day)?.id ?? null;
};
