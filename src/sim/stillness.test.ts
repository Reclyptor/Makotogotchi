// The second day of meditation (SPEC §2.8, ruleset 5): when it restores the
// pet, and what it turns away.

import { describe, expect, it } from "vitest";
import type { PetEvent } from "./events";
import { deepMeditationAt, deepStillnessStartTickOf, type PetState } from "./model";
import { project } from "./project";
import { reduce } from "./reduce";
import { hatchedState, projectImmortal, QUIET_SEED, testCtx, withSeed } from "./testkit";
import { CARE_ACTIONS, HEALTH_MAX, MEDITATION_STARTS_AT, MEDITATION_TICKS, NEED_KEYS, NEED_MAX, RULES_SINCE, TICKS_PER_DAY } from "./tuning";
import { canPerform } from "./validate";

const ctx = testCtx(60);
const generation = withSeed(QUIET_SEED);
const dayTwo = MEDITATION_STARTS_AT + TICKS_PER_DAY;
const sageStart = MEDITATION_STARTS_AT + MEDITATION_TICKS;

const rulesEvent = (tick: number, version: number): PetEvent => ({
  type: "RULES",
  generationId: generation.id,
  seq: 1,
  tick,
  version,
});

/** A pet hatched at tick 0, run unharmed to `tick`, that the leader brings to `version` there. */
const recordedAt = (tick: number, version: number): PetState =>
  reduce(projectImmortal(hatchedState(ctx, generation), tick, ctx), rulesEvent(tick, version), ctx).state;

const worn = (state: PetState, sick = false): PetState => ({
  ...state,
  needs: { hunger: 410_000, energy: 380_000, hygiene: 520_000, joy: 300_000 },
  healthRaw: HEALTH_MAX / 2,
  sick,
  sickSinceTick: sick ? state.tick : null,
});

const whole = (state: PetState) => {
  expect(NEED_KEYS.map((need) => state.needs[need])).toEqual(NEED_KEYS.map(() => NEED_MAX));
  expect(state.healthRaw).toBe(HEALTH_MAX);
};

describe("when day two restores the pet", () => {
  it("is the first tick of day two for a pet that was young when the rule arrived", () => {
    expect(deepStillnessStartTickOf(recordedAt(5, RULES_SINCE.DEEP_STILLNESS))).toBe(dayTwo);
  });

  it("is the tick after the rule arrived for a pet already in day two", () => {
    const release = dayTwo + 123;
    const meditating = projectImmortal(recordedAt(5, RULES_SINCE.SAGE), release, ctx);
    const state = reduce(meditating, rulesEvent(release, RULES_SINCE.DEEP_STILLNESS), ctx).state;
    expect(deepStillnessStartTickOf(state)).toBe(release + 1);
  });

  it("never comes under ruleset 4", () => {
    const state = recordedAt(5, RULES_SINCE.DEEP_STILLNESS - 1);
    expect(state.deepStillnessFromTick).toBeUndefined();
    expect(deepStillnessStartTickOf(state)).toBeNull();
  });

  it("is fixed by the first RULES event: a duplicate append changes nothing", () => {
    const once = recordedAt(5, RULES_SINCE.DEEP_STILLNESS);
    const twice = reduce(projectImmortal(once, 10, ctx), rulesEvent(10, RULES_SINCE.DEEP_STILLNESS), ctx).state;
    expect(twice.deepStillnessFromTick).toBe(5);
  });
});

describe("restoring", () => {
  it("leaves the first day as it is and makes the pet whole on the first tick of day two, then holds it", () => {
    const before = worn(projectImmortal(recordedAt(5, RULES_SINCE.DEEP_STILLNESS), dayTwo - 2, ctx));
    const dayOne = project(before, dayTwo - 1, ctx).state;
    expect(dayOne.needs).toEqual(before.needs);
    expect(dayOne.healthRaw).toBe(before.healthRaw);

    const first = project(dayOne, dayTwo, ctx).state;
    whole(first);
    whole(project(first, sageStart - 1, ctx).state);
  });

  it("restores a pet already in day two on the tick after the rule is recorded", () => {
    const meditating = worn(projectImmortal(recordedAt(5, RULES_SINCE.SAGE), dayTwo + 100, ctx));
    const recorded = reduce(meditating, rulesEvent(meditating.tick, RULES_SINCE.DEEP_STILLNESS), ctx).state;
    expect(recorded.needs).toEqual(meditating.needs);

    whole(project(recorded, recorded.tick + 1, ctx).state);
  });

  it("cures a sick pet and says so", () => {
    const sick = worn(projectImmortal(recordedAt(5, RULES_SINCE.DEEP_STILLNESS), dayTwo - 1, ctx), true);
    const { state, milestones } = project(sick, dayTwo, ctx);
    expect(state.sick).toBe(false);
    expect(state.sickSinceTick).toBeNull();
    expect(milestones).toContainEqual({ kind: "RECOVERED", tick: dayTwo });
  });

  it("says nothing for a pet that was well", () => {
    const { milestones } = project(worn(projectImmortal(recordedAt(5, RULES_SINCE.DEEP_STILLNESS), dayTwo - 1, ctx)), dayTwo, ctx);
    expect(milestones.some((m) => m.kind === "RECOVERED")).toBe(false);
  });

  it("restores nothing under ruleset 4", () => {
    const before = worn(projectImmortal(recordedAt(5, RULES_SINCE.SAGE), dayTwo - 1, ctx), true);
    const { state, milestones } = project(before, dayTwo + 50, ctx);
    expect(state.needs).toEqual(before.needs);
    expect(state.healthRaw).toBe(before.healthRaw);
    expect(state.sick).toBe(true);
    expect(milestones.some((m) => m.kind === "RECOVERED")).toBe(false);
  });
});

describe("turning everything away", () => {
  const state = recordedAt(5, RULES_SINCE.DEEP_STILLNESS);
  const at = (tick: number) => ({ ...projectImmortal(state, tick, ctx), sick: true });

  it("rejects every action with DEEP_MEDITATION on day two", () => {
    const deep = at(dayTwo + 100);
    expect(deepMeditationAt(deep, deep.tick)).toBe(true);
    for (const action of CARE_ACTIONS) {
      expect(canPerform(deep, action, "carer", ctx)).toEqual({ ok: false, reason: "DEEP_MEDITATION" });
    }
  });

  it("still lets a pat and medicine through on day one", () => {
    const day = at(MEDITATION_STARTS_AT + 100);
    expect(canPerform(day, "PET", "carer", ctx)).toEqual({ ok: true });
    expect(canPerform(day, "MEDICATE", "carer", ctx)).toEqual({ ok: true });
    expect(canPerform(day, "FEED", "carer", ctx)).toEqual({ ok: false, reason: "MEDITATING" });
  });

  it("lets a pat through on day two under ruleset 4", () => {
    const old = { ...projectImmortal(recordedAt(5, RULES_SINCE.SAGE), dayTwo + 100, ctx) };
    expect(canPerform(old, "PET", "carer", ctx)).toEqual({ ok: true });
  });

  it("cares again once the pet is a Sage", () => {
    const sage = projectImmortal(state, sageStart + 1, ctx);
    expect(canPerform(sage, "PET", "carer", ctx)).toEqual({ ok: true });
  });
});
