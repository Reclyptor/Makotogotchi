import { describe, expect, it } from "vitest";
import { project } from "./project";
import { stageAt } from "./model";
import { genesis } from "./genesis";
import { hatchedState, projectImmortal, TEST_GENERATION, testCtx } from "./testkit";
import {
  CRITICAL_THRESHOLD,
  EXHAUSTED_THRESHOLD,
  HEALTH_MAX,
  NAP_WAKE_THRESHOLD,
  NEED_MAX,
  TICKS_PER_DAY,
  TICKS_PER_HOUR,
  decayRates,
} from "./tuning";

const ctx = testCtx();

describe("project", () => {
  it("refuses to go backwards", () => {
    const state = hatchedState(ctx);
    const ahead = project(state, 100, ctx).state;
    expect(() => project(ahead, 50, ctx)).toThrow(/backwards/);
  });

  it("freezes an unhatched egg entirely", () => {
    const egg = genesis(TEST_GENERATION);
    const later = project(egg, 5000, ctx).state;
    expect(later.tick).toBe(5000);
    expect(later.needs).toEqual(egg.needs);
    expect(later.healthRaw).toBe(HEALTH_MAX);
    expect(later.asleep).toBe(false);
  });

  it("decays needs at the awake HATCHLING rate after hatch", () => {
    const state = hatchedState(ctx);
    const rates = decayRates("HATCHLING", null, "WAKE");
    const after = project(state, 100, ctx).state;
    expect(after.needs.hunger).toBe(NEED_MAX - 100 * rates.hunger);
    expect(after.needs.joy).toBe(NEED_MAX - 100 * rates.joy);
    expect(after.needs.hygiene).toBe(NEED_MAX - 100 * rates.hygiene);
    expect(after.needs.energy).toBe(NEED_MAX - 100 * rates.energy);
  });

  it("falls asleep at the schedule boundary and recovers energy overnight", () => {
    const state = hatchedState(ctx);
    const nightfall = 15 * TICKS_PER_HOUR; // 22:00 relative to a 07:00 tick 0
    const { state: evening, milestones } = project(state, nightfall, ctx);
    expect(evening.asleep).toBe(true);
    expect(evening.sleepReason).toBe("NIGHT");
    expect(milestones.some((m) => m.kind === "SLEPT")).toBe(true);

    const { state: morning, milestones: wakeMilestones } = project(evening, TICKS_PER_DAY, ctx);
    expect(morning.asleep).toBe(false);
    expect(wakeMilestones.some((m) => m.kind === "WOKE")).toBe(true);
    // A full night at +300/tick caps energy out; the wake tick itself decays
    // one awake step at the new PUP rate (stage turns over at the same tick).
    expect(morning.needs.energy).toBe(NEED_MAX - decayRates("PUP", null, "WAKE").energy);
  });

  it("emits CRITICAL exactly when a need crosses the threshold downward", () => {
    const state = hatchedState(ctx);
    const { milestones } = project(state, 4 * TICKS_PER_DAY, ctx);
    const criticalHunger = milestones.filter((m) => m.kind === "CRITICAL" && m.detail === "hunger");
    expect(criticalHunger).toHaveLength(1);
    const atTick = criticalHunger[0]!.tick;
    const justBefore = project(state, atTick - 1, ctx).state;
    const atCrossing = project(state, atTick, ctx).state;
    expect(justBefore.needs.hunger).toBeGreaterThanOrEqual(CRITICAL_THRESHOLD);
    expect(atCrossing.needs.hunger).toBeLessThan(CRITICAL_THRESHOLD);
  });

  it("takes an involuntary nap when exhausted and wakes at the threshold", () => {
    const state = hatchedState(ctx);
    const tired = { ...state, needs: { ...state.needs, energy: EXHAUSTED_THRESHOLD + 100 } };
    const { state: napping, milestones } = project(tired, state.tick + 10, ctx);
    expect(napping.asleep).toBe(true);
    expect(napping.sleepReason).toBe("NAP");
    expect(milestones.some((m) => m.kind === "SLEPT")).toBe(true);

    // Recovery to the wake threshold takes (400k − ~150k) / 300 ≈ 834 ticks;
    // after waking, the remaining ticks decay awake again, so the final value
    // sits just under the threshold.
    const { state: rested, milestones: wake } = project(napping, napping.tick + 900, ctx);
    expect(rested.asleep).toBe(false);
    expect(rested.needs.energy).toBeGreaterThan(NAP_WAKE_THRESHOLD - 10_000);
    expect(wake.some((m) => m.kind === "WOKE")).toBe(true);
  });

  it("evolves through the life stages at the tick boundaries", () => {
    const state = hatchedState(ctx);
    expect(stageAt(0, TICKS_PER_DAY - 1)).toBe("HATCHLING");
    expect(stageAt(0, TICKS_PER_DAY)).toBe("PUP");
    expect(stageAt(0, 3 * TICKS_PER_DAY)).toBe("JUVENILE");
    expect(stageAt(0, 7 * TICKS_PER_DAY)).toBe("ADULT");
    expect(stageAt(0, 21 * TICKS_PER_DAY)).toBe("ELDER");

    const { milestones } = project(state, 2 * TICKS_PER_DAY, ctx);
    const evolved = milestones.filter((m) => m.kind === "EVOLVED");
    expect(evolved).toHaveLength(1);
    expect(evolved[0]).toMatchObject({ tick: TICKS_PER_DAY, detail: "PUP" });
  });

  it("assigns FRAIL to a neglected juvenile at the ADULT boundary", () => {
    // Untouched from hatch: needs bottom out long before the juvenile window
    // ends, so the care score lands far below the STEADY threshold. (Immortal
    // projection — an untended pet dies of neglect well before day 7, which
    // would freeze the state and never reach the branch.)
    const state = hatchedState(ctx);
    const adult = projectImmortal(state, 7 * TICKS_PER_DAY + 1, ctx);
    expect(adult.form).toBe("FRAIL");
  });

  it("assigns THRIVING when the juvenile window is spent near-full", () => {
    // Skip to the JUVENILE boundary with perfect needs, then hold them full
    // through the window by pinning between chunks — isolates the branching
    // rule from care mechanics.
    const state = hatchedState(ctx);
    let pinned = { ...projectImmortal(state, 3 * TICKS_PER_DAY, ctx), needs: { hunger: NEED_MAX, energy: NEED_MAX, hygiene: NEED_MAX, joy: NEED_MAX } };
    while (pinned.tick < 7 * TICKS_PER_DAY + 1) {
      const next = Math.min(pinned.tick + 200, 7 * TICKS_PER_DAY + 1);
      pinned = {
        ...project(pinned, next, ctx).state,
        needs: { hunger: NEED_MAX, energy: NEED_MAX, hygiene: NEED_MAX, joy: NEED_MAX },
        healthRaw: HEALTH_MAX,
      };
    }
    expect(pinned.form).toBe("THRIVING");
  });

  it("onsets sickness deterministically from the seeded stream", () => {
    const state = hatchedState(ctx);
    const horizon = 5 * TICKS_PER_DAY;
    const a = projectImmortal(state, horizon, ctx);
    const b = projectImmortal(state, horizon, ctx);
    expect(a.sick).toBe(b.sick);
    expect(a.sickSinceTick).toBe(b.sickSinceTick);
  });

  it("kills an abandoned pet and records the dominant cause", () => {
    const state = hatchedState(ctx);
    const { state: dead, milestones } = project(state, 10 * TICKS_PER_DAY, ctx);
    expect(dead.diedAtTick).not.toBeNull();
    expect(dead.causeOfDeath).not.toBeNull();
    const died = milestones.filter((m) => m.kind === "DIED");
    expect(died).toHaveLength(1);
    expect(died[0]!.tick).toBe(dead.diedAtTick);
    // Frozen after death.
    const later = project(dead, 20 * TICKS_PER_DAY, ctx).state;
    expect(later.needs).toEqual(dead.needs);
    expect(later.healthRaw).toBe(0);
  });

  it("keeps a well-tended pet's health at maximum through day one", () => {
    // Nothing goes critical inside 24h, so regeneration holds health full.
    const state = hatchedState(ctx);
    const soon = project(state, TICKS_PER_DAY, ctx).state;
    expect(soon.healthRaw).toBe(HEALTH_MAX);
  });

  it("drains ELDER health unconditionally — old age is always fatal", () => {
    const state = hatchedState(ctx);
    const atElder = projectImmortal(state, 21 * TICKS_PER_DAY, ctx);
    const elder = {
      ...atElder,
      needs: { hunger: NEED_MAX, energy: NEED_MAX, hygiene: NEED_MAX, joy: NEED_MAX },
      sick: false,
      sickSinceTick: null,
      healthRaw: HEALTH_MAX,
    };
    const later = project(elder, elder.tick + 100, ctx).state;
    expect(later.healthRaw).toBeLessThan(HEALTH_MAX);
  });
});
