// The one timezone-aware module gets its own tests, DST above all — the
// whole point of generating boundary ticks server-side is that src/sim never
// has to know these two days a year exist (SPEC §4.5).

import { describe, expect, it } from "vitest";
import { scheduleFor } from "./schedule";
import { phaseAt } from "@/sim/model";
import { TICKS_PER_DAY, TICKS_PER_HOUR } from "@/sim/tuning";

describe("scheduleFor", () => {
  // 2026-01-05 07:00:00 America/Chicago (CST, UTC-6) = 13:00 UTC.
  const GENESIS = Date.UTC(2026, 0, 5, 13, 0, 0);

  it("anchors boundaries at local 07:00 and 22:00", () => {
    const schedule = scheduleFor(GENESIS, 0, 2 * TICKS_PER_DAY, "America/Chicago");
    expect(schedule.initialPhase).toBe("WAKE"); // genesis is exactly 07:00
    expect(schedule.boundaries[0]).toEqual({ tick: 15 * TICKS_PER_HOUR, phase: "SLEEP" }); // 22:00
    expect(schedule.boundaries[1]).toEqual({ tick: TICKS_PER_DAY, phase: "WAKE" }); // 07:00 next day
  });

  it("reports the correct phase for a window starting mid-night", () => {
    const midnightTick = 17 * TICKS_PER_HOUR; // 00:00 local
    const schedule = scheduleFor(GENESIS, midnightTick, midnightTick + TICKS_PER_DAY, "America/Chicago");
    expect(schedule.initialPhase).toBe("SLEEP");
    expect(phaseAt(schedule, midnightTick + 6 * TICKS_PER_HOUR)) // 06:00
      .toBe("SLEEP");
    expect(phaseAt(schedule, midnightTick + 8 * TICKS_PER_HOUR)) // 08:00
      .toBe("WAKE");
  });

  it("spring forward: the night of 2026-03-08 is one hour shorter", () => {
    // DST begins 2026-03-08 02:00 Chicago. The 22:00→07:00 night spanning it
    // contains only 8 wall-clock hours.
    const horizon = 70 * TICKS_PER_DAY;
    const schedule = scheduleFor(GENESIS, 0, horizon, "America/Chicago");
    const boundaries = schedule.boundaries;

    // Locate the WAKE boundary on the morning of Mar 8 and the SLEEP
    // boundary of the evening before.
    const mar8Wake = boundaries.find((b) => {
      const epoch = GENESIS + b.tick * 10_000;
      const date = new Date(epoch).toISOString();
      return b.phase === "WAKE" && date.startsWith("2026-03-08");
    });
    expect(mar8Wake).toBeDefined();
    const precedingSleep = [...boundaries].reverse().find((b) => b.phase === "SLEEP" && b.tick < mar8Wake!.tick);
    expect(precedingSleep).toBeDefined();
    expect(mar8Wake!.tick - precedingSleep!.tick).toBe(8 * TICKS_PER_HOUR);
  });

  it("fall back: the night of 2026-11-01 is one hour longer", () => {
    // DST ends 2026-11-01 02:00 Chicago: a 10-hour 22:00→07:00 night.
    const nov = Date.UTC(2026, 9, 25, 12, 0, 0); // genesis a week before
    const schedule = scheduleFor(nov, 0, 14 * TICKS_PER_DAY, "America/Chicago");
    const nov1Wake = schedule.boundaries.find((b) => {
      const epoch = nov + b.tick * 10_000;
      return b.phase === "WAKE" && new Date(epoch).toISOString().startsWith("2026-11-01");
    });
    expect(nov1Wake).toBeDefined();
    const precedingSleep = [...schedule.boundaries].reverse().find((b) => b.phase === "SLEEP" && b.tick < nov1Wake!.tick);
    expect(nov1Wake!.tick - precedingSleep!.tick).toBe(10 * TICKS_PER_HOUR);
  });
});
