// The cooldown bar's arithmetic (SPEC §11.2). It is tested directly because
// the bug it fixes was invisible in a still frame: driven by the sim's whole
// tick, the bar sat motionless for ten seconds and then lurched.

import { describe, expect, it } from "vitest";
import { cooldownProgress, cooldownSeconds } from "./index";
import { TICK_SECONDS } from "@/sim/tuning";

const TICK_MS = TICK_SECONDS * 1000;
const exactTick = (msSinceGenesis: number): number => msSinceGenesis / TICK_MS;

describe("cooldown progress", () => {
  it("drains continuously between whole ticks", () => {
    // A six-tick cooldown that became ready at tick 6, sampled every second.
    const samples = Array.from({ length: 60 }, (_, second) =>
      cooldownProgress(6, 6, exactTick(second * 1000)),
    );
    for (let i = 1; i < samples.length; i++) {
      expect(samples[i]!).toBeLessThan(samples[i - 1]!);
    }
    // No sample repeats its predecessor — that repetition was the stutter.
    expect(new Set(samples).size).toBe(samples.length);
  });

  it("runs from full to empty across the cooldown", () => {
    expect(cooldownProgress(6, 6, exactTick(0))).toBe(1);
    expect(cooldownProgress(6, 6, exactTick(30_000))).toBeCloseTo(0.5, 5);
    expect(cooldownProgress(6, 6, exactTick(60_000))).toBe(0);
    // Past the end it stays empty rather than going negative.
    expect(cooldownProgress(6, 6, exactTick(90_000))).toBe(0);
  });

  it("never overflows its track when the clock lags behind", () => {
    expect(cooldownProgress(6, 6, exactTick(-20_000))).toBe(1);
    expect(cooldownProgress(6, 0, exactTick(0))).toBe(0);
  });

  it("counts the label down a second at a time", () => {
    expect(cooldownSeconds(6, exactTick(0))).toBe(60);
    expect(cooldownSeconds(6, exactTick(500))).toBe(60);
    expect(cooldownSeconds(6, exactTick(1_000))).toBe(59);
    expect(cooldownSeconds(6, exactTick(59_500))).toBe(1);
    // It never shows zero — a bar still on screen always reads at least 1s.
    expect(cooldownSeconds(6, exactTick(60_000))).toBe(1);
  });
});
