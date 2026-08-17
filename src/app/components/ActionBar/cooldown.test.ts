// The cooldown bar's arithmetic (SPEC §11.2). It is tested directly because
// the bugs it fixes were invisible in a still frame: driven by the sim's whole
// tick the bar sat motionless for ten seconds and then lurched, and driven by
// one of the two overlapping cooldowns it emptied and then refilled.

import { describe, expect, it } from "vitest";
import { cooldownProgress, cooldownSeconds } from "./index";
import { canPerform, cooldownWindow } from "@/sim/validate";
import { COOLDOWNS, TICK_SECONDS } from "@/sim/tuning";
import { project } from "@/sim/project";
import { EventLog, hatchedState, replay, testCtx } from "@/sim/testkit";

const TICK_MS = TICK_SECONDS * 1000;
const exactTick = (msSinceGenesis: number): number => msSinceGenesis / TICK_MS;

describe("cooldown progress", () => {
  it("drains continuously between whole ticks", () => {
    // A six-tick window that became ready at tick 6, sampled every second.
    const samples = Array.from({ length: 60 }, (_, second) => cooldownProgress(0, 6, exactTick(second * 1000)));
    for (let i = 1; i < samples.length; i++) {
      expect(samples[i]!).toBeLessThan(samples[i - 1]!);
    }
    // No sample repeats its predecessor — that repetition was the stutter.
    expect(new Set(samples).size).toBe(samples.length);
  });

  it("runs from full to empty across the window", () => {
    expect(cooldownProgress(0, 6, exactTick(0))).toBe(1);
    expect(cooldownProgress(0, 6, exactTick(30_000))).toBeCloseTo(0.5, 5);
    expect(cooldownProgress(0, 6, exactTick(60_000))).toBe(0);
    // Past the end it stays empty rather than going negative.
    expect(cooldownProgress(0, 6, exactTick(90_000))).toBe(0);
  });

  it("measures the whole window, not the tick it started from", () => {
    // Armed at tick 4, ready at tick 10: half drained at tick 7, not at 5.
    expect(cooldownProgress(4, 10, exactTick(70_000))).toBeCloseTo(0.5, 5);
    expect(cooldownProgress(4, 10, exactTick(40_000))).toBe(1);
    expect(cooldownProgress(4, 10, exactTick(100_000))).toBe(0);
  });

  it("never overflows its track when the clock lags behind", () => {
    expect(cooldownProgress(0, 6, exactTick(-20_000))).toBe(1);
    expect(cooldownProgress(6, 6, exactTick(0))).toBe(0);
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

// The bar and the button read the same window, so they can never disagree:
// the bar hits empty on exactly the tick canPerform() starts saying yes.
describe("the bar against the button it belongs to", () => {
  const CARETAKER = "caretaker-a";
  const ctx = testCtx();

  /** Hatched at tick 0, petted at tick 1, settled at `tick`. */
  const petted = (tick: number) => {
    const log = new EventLog();
    log.hatched(0);
    log.care(1, "PET", CARETAKER);
    return project(replay(log.events, ctx), tick, ctx).state;
  };

  it("drains once instead of emptying and refilling", () => {
    // PET holds the pet for 1 tick and the caretaker for 3. The old bar ran
    // the 1-tick global cooldown to empty and then jumped back up to 2/3.
    const fractions: number[] = [];
    for (let tick = 1; ; tick++) {
      const verdict = canPerform(petted(tick), "PET", CARETAKER, ctx);
      if (verdict.ok) break;
      fractions.push(cooldownProgress(verdict.sinceTick!, verdict.retryAtTick!, tick));
    }
    expect(fractions).toHaveLength(COOLDOWNS.PET.caretaker);
    for (let i = 1; i < fractions.length; i++) expect(fractions[i]!).toBeLessThan(fractions[i - 1]!);
  });

  it("empties on the same tick the action becomes available", () => {
    const ready = 1 + COOLDOWNS.PET.caretaker;
    const justBefore = canPerform(petted(ready - 1), "PET", CARETAKER, ctx);
    if (justBefore.ok) throw new Error("expected PET to still be on cooldown");
    // A sliver of bar is still showing right up to the boundary…
    expect(cooldownProgress(justBefore.sinceTick!, justBefore.retryAtTick!, ready - 0.001)).toBeGreaterThan(0);
    // …and it is exactly empty when the button starts saying yes.
    expect(cooldownProgress(justBefore.sinceTick!, justBefore.retryAtTick!, ready)).toBe(0);
    expect(canPerform(petted(ready), "PET", CARETAKER, ctx).ok).toBe(true);
  });

  it("binds to whichever cooldown ends last", () => {
    const state = hatchedState(ctx);
    // Someone else fed at tick 19 (pet busy until 24); this caretaker fed at
    // tick 4, so their own cooldown lapses at 22 — the global one binds.
    const busier = {
      ...state,
      tick: 20,
      lastActionTick: { FEED: 19 },
      caretakers: [{ id: CARETAKER, lastActionTick: { FEED: 4 }, budget: {} }],
    };
    expect(cooldownWindow(busier, "FEED", CARETAKER)).toEqual({
      reason: "COOLDOWN_GLOBAL",
      sinceTick: 19,
      readyAtTick: 24,
    });
    // Move this caretaker's own feed later and theirs takes over at 33.
    const ownLater = { ...busier, caretakers: [{ id: CARETAKER, lastActionTick: { FEED: 15 }, budget: {} }] };
    expect(cooldownWindow(ownLater, "FEED", CARETAKER)).toEqual({
      reason: "COOLDOWN_CARETAKER",
      sinceTick: 15,
      readyAtTick: 33,
    });
    // The bar spans that whole window rather than restarting at 24.
    const verdict = canPerform(ownLater, "FEED", CARETAKER, ctx);
    if (verdict.ok) throw new Error("expected FEED to still be on cooldown");
    expect(cooldownProgress(verdict.sinceTick!, verdict.retryAtTick!, 24)).toBeCloseTo(0.5, 5);
  });
});
