// The ruleset version (SPEC §23.2): the one event that gates every rule which
// changes how a pet lives or dies, so that a log from before a change keeps
// folding as it always did.

import { describe, expect, it } from "vitest";
import { derive } from "./derive";
import { petEventSchema, type RulesEvent } from "./events";
import { rulesVersionOf, type PetState } from "./model";
import { project } from "./project";
import { reduce } from "./reduce";
import { hatchedState, projectImmortal, TEST_GENERATION, testCtx } from "./testkit";
import {
  AWAKE_HOURS,
  CURRENT_RULES_VERSION,
  ELDER_HOLD_CAP,
  ELDER_HOLD_CAP_FRAIL,
  ELDER_STARTS_AT,
  elderHoldMean,
  HEALTH_MAX,
  NEED_MAX,
  TICKS_PER_DAY,
  TICKS_PER_HOUR,
} from "./tuning";

const ctx = testCtx();

const rulesAt = (tick: number, version: number, seq = 800): RulesEvent => ({
  type: "RULES",
  generationId: TEST_GENERATION.id,
  seq,
  tick,
  version,
});

describe("the RULES event", () => {
  it("reads as version 1 in a history with no event, and leaves the field out entirely", () => {
    const state = hatchedState(ctx);
    expect(rulesVersionOf(state)).toBe(1);
    expect("rulesVersion" in project(state, state.tick + TICKS_PER_DAY, ctx).state).toBe(false);
  });

  it("records its version after projecting to its tick under the old rules", () => {
    const state = hatchedState(ctx);
    const tick = state.tick + 500;
    const folded = reduce(state, rulesAt(tick, 2), ctx).state;
    expect(folded.rulesVersion).toBe(2);
    expect(folded.tick).toBe(tick);
    expect(folded.healthRaw).toBe(project(state, tick, ctx).state.healthRaw);
  });

  it("keeps the highest version it has seen", () => {
    const state = hatchedState(ctx);
    const high = reduce(state, rulesAt(state.tick + 10, 3), ctx).state;
    expect(reduce(high, rulesAt(high.tick + 10, 2, 801), ctx).state.rulesVersion).toBe(3);
    expect(reduce(high, rulesAt(high.tick + 10, 3, 801), ctx).state.rulesVersion).toBe(3);
  });

  it("does not add the field for a version that changes nothing", () => {
    const state = hatchedState(ctx);
    expect("rulesVersion" in reduce(state, rulesAt(state.tick + 10, 1), ctx).state).toBe(false);
  });

  it("survives the hot-state JSON round trip", () => {
    const state = hatchedState(ctx);
    const { state: folded } = reduce(state, rulesAt(state.tick + 10, CURRENT_RULES_VERSION), ctx);
    expect(JSON.parse(JSON.stringify(folded)) as PetState).toEqual(folded);
  });

  it("validates at the wire: a positive whole version and nothing else", () => {
    const event = rulesAt(10, 2);
    expect(petEventSchema.safeParse(event).success).toBe(true);
    expect(petEventSchema.safeParse({ ...event, version: 0 }).success).toBe(false);
    expect(petEventSchema.safeParse({ ...event, version: 1.5 }).success).toBe(false);
    expect(petEventSchema.safeParse({ ...event, version: undefined }).success).toBe(false);
  });
});

const level = (value: number): PetState["needs"] => ({ hunger: value, energy: value, hygiene: value, joy: value });
const v2 = (state: PetState): PetState => ({ ...state, rulesVersion: 2 });

describe("no community scaling at night", () => {
  const onset = 10 * TICKS_PER_DAY + AWAKE_HOURS * TICKS_PER_HOUR;
  const crowd = 20_000; // twenty caretakers, all week
  // Five of the night's six hours: the last tick of the sixth is already the morning.
  const adultAt = (tick: number, populationPermille: number, asleep: boolean): PetState => ({
    ...projectImmortal(hatchedState(ctx), tick, ctx),
    needs: level(NEED_MAX),
    healthRaw: HEALTH_MAX,
    populationPermille,
    asleep,
    sleepReason: asleep ? "NIGHT" : null,
    sick: false,
  });
  const lostOver = (state: PetState, ticks: number): PetState["needs"] => {
    const after = project(state, state.tick + ticks, ctx).state.needs;
    return { hunger: NEED_MAX - after.hunger, energy: NEED_MAX - after.energy, hygiene: NEED_MAX - after.hygiene, joy: NEED_MAX - after.joy };
  };

  it("scales a night by the crowd under ruleset 1, as it always did", () => {
    const crowded = lostOver(adultAt(onset, crowd, true), 5 * TICKS_PER_HOUR);
    const quiet = lostOver(adultAt(onset, 2_000, true), 5 * TICKS_PER_HOUR);
    expect(crowded.hunger).toBeGreaterThan(quiet.hunger * 3);
    expect(crowded.hygiene).toBeGreaterThan(quiet.hygiene * 3);
  });

  it("charges a crowded night the baseline under ruleset 2", () => {
    const crowded = lostOver(v2(adultAt(onset, crowd, true)), 5 * TICKS_PER_HOUR);
    expect(crowded).toEqual(lostOver(adultAt(onset, 2_000, true), 5 * TICKS_PER_HOUR));
  });

  it("keeps the full scaling by day under ruleset 2", () => {
    const morning = 10 * TICKS_PER_DAY;
    const day = lostOver(v2(adultAt(morning, crowd, false)), 5 * TICKS_PER_HOUR);
    expect(day).toEqual(lostOver(adultAt(morning, crowd, false), 5 * TICKS_PER_HOUR));
    expect(day.hunger).toBeGreaterThan(lostOver(adultAt(morning, 2_000, false), 5 * TICKS_PER_HOUR).hunger * 3);
  });

  it("switches at the schedule boundary, not at the pet's own sleep", () => {
    // A nap in the afternoon is still the day: the crowd still counts.
    const afternoon = 10 * TICKS_PER_DAY + 8 * TICKS_PER_HOUR;
    const napping = { ...adultAt(afternoon, crowd, true), sleepReason: "NAP" as const, needs: { ...level(NEED_MAX), energy: 100_000 } };
    expect(lostOver(v2(napping), 60)).toEqual(lostOver(napping, 60));
  });
});

describe("the FRAIL elder's lower cap", () => {
  const elderAt = (form: "FRAIL" | "STEADY", needs: number, rampDay: number): PetState => {
    const start = projectImmortal(hatchedState(ctx), ELDER_STARTS_AT, ctx);
    return {
      ...start,
      form,
      needs: level(needs),
      healthRaw: HEALTH_MAX,
      sick: false,
      asleep: false,
      sleepReason: null,
      elderRampFromTick: start.tick,
      tick: start.tick + rampDay * TICKS_PER_DAY,
    };
  };
  const lostInATick = (state: PetState): number => state.healthRaw - project(state, state.tick + 1, ctx).state.healthRaw;

  it("caps the line at 80% for FRAIL and 85% for everyone else", () => {
    expect(elderHoldMean(40, "FRAIL")).toBe(ELDER_HOLD_CAP_FRAIL);
    expect(elderHoldMean(40, "STEADY")).toBe(ELDER_HOLD_CAP);
    expect(elderHoldMean(40)).toBe(ELDER_HOLD_CAP);
    // The two lines part ways only once the climb passes 80%, on ramp day 8.
    expect(elderHoldMean(7, "FRAIL")).toBe(elderHoldMean(7));
    expect(elderHoldMean(8, "FRAIL")).toBe(800_000);
    expect(elderHoldMean(9, "FRAIL")).toBe(800_000);
  });

  it("holds a FRAIL elder at 82% under ruleset 2 where ruleset 1 still drains it", () => {
    const frail = elderAt("FRAIL", 820_000, 12);
    expect(lostInATick(frail)).toBeGreaterThan(0);
    expect(lostInATick(v2(frail))).toBe(0);
    expect(derive(frail).health.elder?.linePercent).toBe(85);
    expect(derive(v2(frail)).health.elder?.linePercent).toBe(80);
  });

  it("leaves every other form at 85% under both", () => {
    const steady = elderAt("STEADY", 820_000, 12);
    expect(lostInATick(v2(steady))).toBe(lostInATick(steady));
    expect(lostInATick(v2(steady))).toBeGreaterThan(0);
    expect(derive(v2(steady)).health.elder?.linePercent).toBe(85);
  });

  it("is no different before ramp day 8", () => {
    const frail = elderAt("FRAIL", 700_000, 6);
    expect(lostInATick(v2(frail))).toBe(lostInATick(frail));
  });
});

describe("old age is credited to an elder below its line", () => {
  const dyingElder = (patch: Partial<PetState>): PetState => {
    const start = projectImmortal(hatchedState(ctx), ELDER_STARTS_AT, ctx);
    return { ...start, asleep: false, sleepReason: null, healthRaw: 1_000, needs: level(500_000), sick: false, ...patch };
  };
  const diedOf = (state: PetState): PetState["causeOfDeath"] => {
    const after = project(state, state.tick + 1, ctx).state;
    expect(after.diedAtTick).not.toBeNull();
    return after.causeOfDeath;
  };

  it("calls a sick elder below its line sickness under ruleset 1 and age under 2", () => {
    const sick = dyingElder({ sick: true });
    expect(diedOf(sick)).toBe("sickness");
    expect(diedOf(v2(sick))).toBe("age");
  });

  it("agrees on an elder who is not sick", () => {
    const frail = dyingElder({});
    expect(diedOf(frail)).toBe("age");
    expect(diedOf(v2(frail))).toBe("age");
  });

  it("still calls a sick elder held at its line sick", () => {
    const sick = dyingElder({ sick: true, needs: level(700_000) });
    expect(diedOf(sick)).toBe("sickness");
    expect(diedOf(v2(sick))).toBe("sickness");
  });

  it("puts a need below critical first, whatever else is draining", () => {
    // A 10-point deficit drains far less than the sickness beside it, so the
    // old order blamed the sickness; the starving elder starved.
    const starving = dyingElder({ sick: true, needs: { ...level(500_000), hunger: 190_000 } });
    expect(diedOf(starving)).toBe("sickness");
    expect(diedOf(v2(starving))).toBe("hunger");
    expect(diedOf(v2(dyingElder({ needs: { ...level(500_000), joy: 0 } })))).toBe("joy");
  });
});
