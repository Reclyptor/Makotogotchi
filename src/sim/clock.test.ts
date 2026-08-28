// The pet's clock is read by the scene and stamped by the server, and both
// must land on the same day (SPEC §22.9). These check the arithmetic itself
// rather than two callers agreeing, because there is only one of it.
//
// Every instant here is an explicit epoch millisecond — the same rule the
// clock itself obeys, and the reason it can live in the pure layer at all.

import { describe, expect, it } from "vitest";
import { petClock } from "./clock";

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

// Instants are written as literal epoch milliseconds rather than computed:
// a helper that derived them would be reimplementing the very arithmetic
// under test, and would agree with a broken clock.

/** 2026-03-15T12:00:00Z */
const MAR_15_NOON = 1_773_576_000_000;
/** 2026-03-01T00:00:00Z */
const MAR_01_MIDNIGHT = 1_772_323_200_000;
/** 2026-03-08T06:00:00Z — US spring-forward, 01:00 CST → 03:00 CDT. */
const SPRING_FORWARD = 1_772_949_600_000;
/** 2026-11-01T05:00:00Z — US fall-back. */
const FALL_BACK = 1_782_018_000_000;

/** Every zone the project plausibly holds a day in, plus the ones that break
 *  naive arithmetic: a 45-minute offset, and the two extremes. */
const ZONES = [
  "UTC",
  "America/Chicago",
  "Europe/Paris",
  "Asia/Tokyo",
  "Asia/Kathmandu", // +05:45 — not a whole number of hours
  "Australia/Lord_Howe", // +10:30, with a 30-minute DST shift
  "Pacific/Kiritimati", // +14, the furthest ahead of UTC
  "Pacific/Niue", // −11, among the furthest behind
];

describe("the pet's clock", () => {
  it("reads the wall time in the pet's zone, not the machine's", () => {
    expect(petClock("Asia/Tokyo", MAR_15_NOON).hour).toBe(21);
    expect(petClock("America/Chicago", MAR_15_NOON).hour).toBe(7);
    expect(petClock("Asia/Kathmandu", MAR_15_NOON)).toMatchObject({ hour: 17, minute: 45 });
  });

  it("advances the day exactly once per local midnight, in every zone", () => {
    for (const zone of ZONES) {
      // A week of hourly samples: the index may only ever hold or step by
      // one, and must have stepped exactly 7 times after 7 days.
      let previous = petClock(zone, MAR_01_MIDNIGHT).dayIndex;
      const first = previous;
      for (let hour = 1; hour <= 24 * 7; hour++) {
        const index = petClock(zone, MAR_01_MIDNIGHT + hour * HOUR_MS).dayIndex;
        const step = index - previous;
        if (step !== 0 && step !== 1) throw new Error(`${zone} jumped ${step} days at hour ${hour}`);
        previous = index;
      }
      expect(`${zone}:${previous - first}`).toBe(`${zone}:7`);
    }
  });

  it("holds one day across a DST transition rather than skipping or repeating one", () => {
    // The local day is 23 hours long in spring and 25 in autumn; the index
    // must still tick exactly once across each.
    for (const [label, at] of [
      ["spring forward", SPRING_FORWARD],
      ["fall back", FALL_BACK],
    ] as const) {
      const before = petClock("America/Chicago", at - HOUR_MS).dayIndex;
      const after = petClock("America/Chicago", at + HOUR_MS).dayIndex;
      expect(`${label}:${after - before}`).toBe(`${label}:1`);
    }
  });

  it("counts epoch days, which is the base the venue draw and the forecast key on", () => {
    // Not days since genesis — schedule.ts's localDayIndex is that, and the
    // two differ by a constant that would silently misfile every ballot.
    const marchFifteenth = Math.floor(MAR_15_NOON / DAY_MS);
    expect(petClock("UTC", MAR_15_NOON).dayIndex).toBe(marchFifteenth);
    // At that instant Kiritimati is already on the 16th; Niue still on the 15th.
    expect(petClock("Pacific/Kiritimati", MAR_15_NOON).dayIndex).toBe(marchFifteenth + 1);
    expect(petClock("Pacific/Niue", MAR_15_NOON).dayIndex).toBe(marchFifteenth);
  });

  it("agrees with itself either side of the epoch and a leap day", () => {
    // 2024-02-29 and 1969-12-31: the civil-date arithmetic has to hold for
    // leap years and for negative day indices alike.
    const leapDay = Math.floor(1_709_208_000_000 / DAY_MS); // 2024-02-29T12:00Z
    expect(petClock("UTC", 1_709_208_000_000).dayIndex).toBe(leapDay);
    expect(petClock("UTC", 1_709_208_000_000)).toMatchObject({ month: 2 });
    expect(petClock("UTC", -43_200_000).dayIndex).toBe(-1); // 1969-12-31T12:00Z
  });
});
