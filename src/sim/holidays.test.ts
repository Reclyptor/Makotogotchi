// The holiday calendar reads the pet's own day (SPEC §22.11), so what these
// pin is the edges of that day: Halloween starts and ends at the pet's
// midnight, not the player's and not UTC's.
//
// Instants are literal epoch milliseconds, for the reason clock.test.ts gives.

import { describe, expect, it } from "vitest";
import { petClock } from "./clock";
import { HOLIDAYS, holidayOn, isHolidayId } from "./holidays";

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
    expect(isHolidayId("christmas")).toBe(false);
  });
});
