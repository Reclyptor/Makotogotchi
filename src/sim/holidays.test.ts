// The holiday calendar reads the pet's own day (SPEC §22.11), so what these
// pin is the edges of that day: Halloween starts and ends at the pet's
// midnight, not the player's and not UTC's.
//
// Instants are literal epoch milliseconds, for the reason clock.test.ts gives.

import { describe, expect, it } from "vitest";
import { daysFromCivil, petClock } from "./clock";
import { fireworksAt, HOLIDAYS, holidayOn, isHolidayId } from "./holidays";

const ZONE = "America/Chicago";

/** 2026-10-30T23:59-05:00 */
const OCT_30_LATE = 1_793_422_740_000;
/** 2026-10-31T00:00-05:00 */
const OCT_31_START = 1_793_422_800_000;
/** 2026-10-31T23:59-05:00 */
const OCT_31_LATE = 1_793_509_140_000;
/** 2026-11-01T00:00-05:00 */
const NOV_01_START = 1_793_509_200_000;
/** 2027-10-31T12:00-05:00 */
const OCT_31_2027_NOON = 1_825_002_000_000;

const holidayAt = (nowMs: number, zone = ZONE) => holidayOn(petClock(zone, nowMs).dayIndex);

describe("the holiday calendar", () => {
  it("keeps Halloween to the pet's Oct 31, midnight to midnight", () => {
    expect(holidayAt(OCT_30_LATE)).toBeNull();
    expect(holidayAt(OCT_31_START)).toBe("halloween");
    expect(holidayAt(OCT_31_LATE)).toBe("halloween");
    expect(holidayAt(NOV_01_START)).toBeNull();
  });

  it("follows the pet's zone rather than the viewer's", () => {
    // Oct 31 00:00 Chicago is already 14:00 on Oct 31 in Tokyo, and the
    // evening of Oct 30 in Honolulu: only the pet's own zone decides.
    expect(holidayAt(OCT_31_START, "Asia/Tokyo")).toBe("halloween");
    expect(holidayAt(OCT_31_START, "Pacific/Honolulu")).toBeNull();
  });

  it("returns every year without a code change", () => {
    expect(holidayAt(OCT_31_2027_NOON)).toBe("halloween");
  });

  it("is quiet on an ordinary day", () => {
    expect(holidayAt(1_773_576_000_000)).toBeNull(); // 2026-03-15
  });

  it("names every holiday it can return", () => {
    expect(HOLIDAYS.every((holiday) => isHolidayId(holiday.id))).toBe(true);
    expect(isHolidayId("halloween")).toBe(true);
    expect(isHolidayId("easter")).toBe(false);
  });
});

describe("the rest of the calendar", () => {
  const onDay = (year: number, month: number, day: number): ReturnType<typeof holidayOn> => holidayOn(daysFromCivil(year, month, day));

  it("finds Thanksgiving on the fourth Thursday of November, whichever day that is", () => {
    expect(onDay(2026, 11, 26)).toBe("thanksgiving");
    expect(onDay(2027, 11, 25)).toBe("thanksgiving");
    expect(onDay(2028, 11, 23)).toBe("thanksgiving");
    // Not the Thursdays either side, nor the fourth day of another weekday.
    for (const [year, month, day] of [[2026, 11, 19], [2026, 12, 3], [2026, 11, 25], [2026, 11, 27]] as const) {
      expect(onDay(year, month, day), `${year}-${month}-${day}`).toBeNull();
    }
  });

  it("finds Thanksgiving when November starts on a Thursday, and when it ends on one", () => {
    // 2029 opens on a Thursday: the fourth is the 22nd. 2024 puts the fourth on the 28th.
    expect(onDay(2029, 11, 22)).toBe("thanksgiving");
    expect(onDay(2024, 11, 28)).toBe("thanksgiving");
    expect(onDay(2024, 11, 21)).toBeNull();
  });

  it("finds Christmas, New Year's Day and Valentine's Day every year", () => {
    for (const year of [2026, 2027, 2028, 2100]) {
      expect(onDay(year, 12, 25), `${year} Christmas`).toBe("christmas");
      expect(onDay(year, 1, 1), `${year} New Year`).toBe("newYear");
      expect(onDay(year, 2, 14), `${year} Valentine's`).toBe("valentines");
    }
  });

  it("turns over at the year's end: Dec 31 is ordinary, Jan 1 is New Year's Day", () => {
    expect(onDay(2026, 12, 31)).toBeNull();
    expect(onDay(2027, 1, 1)).toBe("newYear");
    expect(onDay(2027, 1, 2)).toBeNull();
  });

  it("is quiet on every other day of a year", () => {
    const first = daysFromCivil(2027, 1, 1);
    const named = Array.from({ length: 365 }, (_, i) => holidayOn(first + i)).filter((id) => id !== null);
    expect(named).toEqual(["newYear", "valentines", "halloween", "thanksgiving", "christmas"]);
  });
});

describe("New Year's Eve's fireworks", () => {
  const at = (month: number, day: number, hour: number) => fireworksAt({ hour, dayIndex: daysFromCivil(2026, month, day) });

  it("start at 23:00 on Dec 31 and end at 01:00 on Jan 1", () => {
    expect(at(12, 31, 22)).toBe(false);
    expect(at(12, 31, 23)).toBe(true);
    expect(at(1, 1, 0)).toBe(true);
    expect(at(1, 1, 1)).toBe(false);
  });

  it("are not lit by day, or on any other night", () => {
    expect(at(12, 31, 12)).toBe(false);
    expect(at(1, 1, 13)).toBe(false);
    expect(at(12, 30, 23)).toBe(false);
    expect(at(1, 2, 0)).toBe(false);
  });

  it("follow the pet's own midnight in its zone", () => {
    /** 2026-12-31T23:30-06:00, Chicago's own half past eleven. */
    const NYE_2330 = 1_798_781_400_000;
    const HOUR_MS = 3_600_000;
    const lit = (nowMs: number, zone = "America/Chicago") => fireworksAt(petClock(zone, nowMs));
    expect(lit(NYE_2330 - HOUR_MS)).toBe(false); // 22:30
    expect(lit(NYE_2330)).toBe(true); // 23:30
    expect(lit(NYE_2330 + HOUR_MS)).toBe(true); // 00:30, the pet's New Year
    expect(lit(NYE_2330 + 2 * HOUR_MS)).toBe(false); // 01:30
    // The same instant is already January 2nd in Tokyo, where it is not the Eve.
    expect(lit(NYE_2330, "Asia/Tokyo")).toBe(false);
  });
});
