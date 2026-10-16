// The ruleset version (SPEC §23.2): the one event that gates every rule which
// changes how a pet lives or dies, so that a log from before a change keeps
// folding as it always did.

import { describe, expect, it } from "vitest";
import { careMultiplierOf, careMultiplierPermille, DIFFICULTY_CEILING_V3, PRESENCE_SCALE, worthRecording } from "./difficulty";
import { derive } from "./derive";
import { petEventSchema, type RulesEvent } from "./events";
import { rulesVersionOf, type PetState } from "./model";
import { project } from "./project";
import { QUESTS, questTarget } from "./quests";
import { reduce } from "./reduce";
import { allowanceRemaining } from "./score";
import { hatchedState, projectImmortal, TEST_GENERATION, testCtx } from "./testkit";
import {
  AWAKE_HOURS,
  CURRENT_RULES_VERSION,
  ELDER_HOLD_CAP,
  ELDER_HOLD_CAP_FRAIL,
  ELDER_HOLD_CAP_FRAIL_V3,
  ELDER_HOLD_CAP_V3,
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
const v3 = (state: PetState): PetState => ({ ...state, rulesVersion: 3 });

describe("no community scaling at night", () => {
  const onset = 10 * TICKS_PER_DAY + AWAKE_HOURS * TICKS_PER_HOUR;
  const crowd = 20_000; // twenty caretakers, all week
  // Five hours, not the night's six: the last tick of the sixth is already the
  // morning, and runs at the daytime rate.
  const fiveHours = 5 * TICKS_PER_HOUR;
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
    const crowded = lostOver(adultAt(onset, crowd, true), fiveHours);
    const quiet = lostOver(adultAt(onset, 2_000, true), fiveHours);
    expect(crowded.hunger).toBeGreaterThan(quiet.hunger * 3);
    expect(crowded.hygiene).toBeGreaterThan(quiet.hygiene * 3);
  });

  it("charges a crowded night the baseline under ruleset 2", () => {
    const crowded = lostOver(v2(adultAt(onset, crowd, true)), fiveHours);
    expect(crowded).toEqual(lostOver(adultAt(onset, 2_000, true), fiveHours));
  });

  it("keeps the full scaling by day under ruleset 2", () => {
    const morning = 10 * TICKS_PER_DAY;
    const day = lostOver(v2(adultAt(morning, crowd, false)), fiveHours);
    expect(day).toEqual(lostOver(adultAt(morning, crowd, false), fiveHours));
    expect(day.hunger).toBeGreaterThan(lostOver(adultAt(morning, 2_000, false), fiveHours).hunger * 3);
  });

  it("switches at the schedule boundary, not at the pet's own sleep", () => {
    // A nap in the afternoon is still the day: the crowd still counts.
    const afternoon = 10 * TICKS_PER_DAY + 8 * TICKS_PER_HOUR;
    const napping = { ...adultAt(afternoon, crowd, true), sleepReason: "NAP" as const, needs: { ...level(NEED_MAX), energy: 100_000 } };
    expect(lostOver(v2(napping), 60)).toEqual(lostOver(napping, 60));
  });
});

describe("the community multiplier's ceiling (SPEC §23)", () => {
  const whole = (caretakers: number): number => caretakers * PRESENCE_SCALE;

  it("stops at 2× from ruleset 3 and at the table's 4× before", () => {
    for (const caretakers of [13, 20, 500]) {
      expect(careMultiplierPermille(whole(caretakers), 2)).toBe(4000);
      expect(careMultiplierPermille(whole(caretakers), 3)).toBe(DIFFICULTY_CEILING_V3);
    }
    expect(DIFFICULTY_CEILING_V3).toBe(2000);
  });

  it("leaves the table and its interpolation alone below the cap", () => {
    for (const presence of [0, whole(2), whole(3), whole(4), whole(4) + 500, whole(5)]) {
      expect(careMultiplierPermille(presence, 3)).toBe(careMultiplierPermille(presence, 2));
    }
    expect(careMultiplierPermille(whole(5), 3)).toBe(1988);
  });

  it("clamps the interpolation too, between the last whole caretaker under the cap and the next", () => {
    expect(careMultiplierPermille(whole(5) + 100, 2)).toBe(2017);
    expect(careMultiplierPermille(whole(5) + 100, 3)).toBe(2000);
  });

  it("is read off the state's own ruleset", () => {
    const crowded = { ...hatchedState(ctx), populationPermille: whole(20) };
    expect(careMultiplierOf(crowded)).toBe(4000);
    expect(careMultiplierOf(v2(crowded))).toBe(4000);
    expect(careMultiplierOf(v3(crowded))).toBe(2000);
  });

  it("caps decay in a crowd at the rate of a room that has just reached 2×", () => {
    const morning = 10 * TICKS_PER_DAY;
    const adultAt = (populationPermille: number, rulesVersion: number): PetState => ({
      ...projectImmortal(hatchedState(ctx), morning, ctx),
      needs: level(NEED_MAX),
      healthRaw: HEALTH_MAX,
      populationPermille,
      rulesVersion,
      asleep: false,
      sleepReason: null,
      sick: false,
    });
    const hungerAfter = (state: PetState): number => project(state, state.tick + 2 * TICKS_PER_HOUR, ctx).state.needs.hunger;
    expect(hungerAfter(adultAt(whole(20), 3))).toBe(hungerAfter(adultAt(whole(6), 3)));
    expect(hungerAfter(adultAt(whole(20), 2))).toBeLessThan(hungerAfter(adultAt(whole(20), 3)));
  });

  it("caps the caretaker's weekly allowance with it, so supply keeps pace with demand", () => {
    const fed = (rulesVersion: number): PetState => {
      const state = {
        ...hatchedState(ctx),
        needs: { ...level(NEED_MAX), hunger: 300_000 },
        populationPermille: whole(20),
        rulesVersion,
      };
      const event = {
        type: "CARE" as const,
        generationId: TEST_GENERATION.id,
        seq: 1,
        tick: state.tick + 1,
        action: "FEED" as const,
        caretakerId: "a",
      };
      return reduce(state, event, ctx).state;
    };
    const left = (state: PetState): number => allowanceRemaining(state, "a", state.tick).hunger;
    expect(left(fed(3))).toBeLessThan(left(fed(2)));
    expect(left(fed(3))).toBe(left({ ...fed(3), populationPermille: whole(6) }));
  });

  it("caps the care quests' bar with it, which reads what decay reads", () => {
    expect(questTarget(QUESTS["feast-day"], 13, whole(13), 2)).toBe(40);
    expect(questTarget(QUESTS["feast-day"], 13, whole(13), 3)).toBe(20);
  });

  it("stops recording a crowd once it no longer moves the multiplier", () => {
    expect(worthRecording(whole(6), whole(20), 2)).toBe(true);
    expect(worthRecording(whole(6), whole(20), 3)).toBe(false);
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
    expect(elderHoldMean(40, "FRAIL", 2)).toBe(ELDER_HOLD_CAP_FRAIL);
    expect(elderHoldMean(40, "STEADY", 2)).toBe(ELDER_HOLD_CAP);
    expect(elderHoldMean(40, null, 2)).toBe(ELDER_HOLD_CAP);
    // The two lines part ways only once the climb passes 80%, on ramp day 8.
    expect(elderHoldMean(7, "FRAIL", 2)).toBe(elderHoldMean(7, null, 2));
    expect(elderHoldMean(8, "FRAIL", 2)).toBe(800_000);
    expect(elderHoldMean(9, "FRAIL", 2)).toBe(800_000);
  });

  it("holds a FRAIL elder at 82% under ruleset 2 where ruleset 1 still drains it", () => {
    const frail = elderAt("FRAIL", 820_000, 12);
    expect(lostInATick(frail)).toBeGreaterThan(0);
    expect(lostInATick(v2(frail))).toBe(0);
    expect(derive(frail).health.elder?.linePermille).toBe(850);
    expect(derive(v2(frail)).health.elder?.linePermille).toBe(800);
  });

  it("leaves every other form at 85% under both", () => {
    const steady = elderAt("STEADY", 820_000, 12);
    expect(lostInATick(v2(steady))).toBe(lostInATick(steady));
    expect(lostInATick(v2(steady))).toBeGreaterThan(0);
    expect(derive(v2(steady)).health.elder?.linePermille).toBe(850);
  });

  it("is no different before ramp day 8", () => {
    const frail = elderAt("FRAIL", 700_000, 6);
    expect(lostInATick(v2(frail))).toBe(lostInATick(frail));
  });

  it("caps the line at 75% for everyone and 70% for FRAIL from ruleset 3, reached on ramp days 6 and 4", () => {
    expect(ELDER_HOLD_CAP_V3).toBe(750_000);
    expect(ELDER_HOLD_CAP_FRAIL_V3).toBe(700_000);
    expect(elderHoldMean(40, "STEADY", 3)).toBe(ELDER_HOLD_CAP_V3);
    expect(elderHoldMean(40, "THRIVING", 3)).toBe(ELDER_HOLD_CAP_V3);
    expect(elderHoldMean(40, null, 3)).toBe(ELDER_HOLD_CAP_V3);
    expect(elderHoldMean(40, "FRAIL", 3)).toBe(ELDER_HOLD_CAP_FRAIL_V3);
    expect(elderHoldMean(5, "STEADY", 3)).toBe(725_000);
    expect(elderHoldMean(6, "STEADY", 3)).toBe(750_000);
    expect(elderHoldMean(3, "FRAIL", 3)).toBe(675_000);
    expect(elderHoldMean(4, "FRAIL", 3)).toBe(700_000);
  });

  it("starts the climb where it always did, so the early days are unchanged", () => {
    for (const form of ["FRAIL", "STEADY", null] as const) {
      for (const day of [0, 1, 2, 3]) expect(elderHoldMean(day, form, 3)).toBe(elderHoldMean(day, form, 2));
    }
  });

  it("holds an elder at 76% under ruleset 3 where ruleset 2 still drains it", () => {
    const steady = elderAt("STEADY", 760_000, 12);
    expect(lostInATick(v2(steady))).toBeGreaterThan(0);
    expect(lostInATick(v3(steady))).toBe(0);
    expect(derive(v2(steady)).health.elder?.linePermille).toBe(850);
    expect(derive(v3(steady)).health.elder?.linePermille).toBe(750);
  });

  it("holds a FRAIL elder at 72% under ruleset 3 where ruleset 2 still drains it", () => {
    const frail = elderAt("FRAIL", 720_000, 12);
    expect(lostInATick(v2(frail))).toBeGreaterThan(0);
    expect(lostInATick(v3(frail))).toBe(0);
    expect(derive(v3(frail)).health.elder?.linePermille).toBe(700);
  });

  it("still drains an elder under the new line", () => {
    expect(lostInATick(v3(elderAt("STEADY", 740_000, 12)))).toBeGreaterThan(0);
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

describe("what the screen blames, and what the gravestone credits (SPEC §2.3)", () => {
  const adult = projectImmortal(hatchedState(ctx), 10 * TICKS_PER_DAY, ctx);
  const elder = projectImmortal(hatchedState(ctx), ELDER_STARTS_AT, ctx);
  const ill = (state: PetState, needs: PetState["needs"]): PetState => ({
    ...state,
    needs,
    sick: true,
    asleep: false,
    sleepReason: null,
    healthRaw: HEALTH_MAX / 2,
  });
  const diedOf = (state: PetState): PetState["causeOfDeath"] => {
    const after = project({ ...state, healthRaw: 1_000 }, state.tick + 1, ctx).state;
    expect(after.diedAtTick).not.toBeNull();
    return after.causeOfDeath;
  };

  it("keeps ruleset 1 on the largest drain: sickness outweighs a shallow deficit", () => {
    const state = ill(adult, { ...level(NEED_MAX), joy: 150_000 });
    expect(derive(state).health.reason).toEqual({ kind: "sick" });
  });

  it("tells a sick adult with a critical need about the need, however shallow", () => {
    const state = v2(ill(adult, { ...level(NEED_MAX), joy: 150_000 }));
    expect(derive(state).health).toMatchObject({ trend: "falling", reason: { kind: "need", need: "joy" } });
    expect(diedOf(state)).toBe("joy");
  });

  it("holds the order across the point where the deficits' drain passes sickness's", () => {
    // 550 a unit of deficit against 120M: hunger empty plus a joy deficit of
    // 18,181 is 119,999,550 a tick, just under sickness; one more unit is over.
    const under = ill(adult, { ...level(NEED_MAX), hunger: 0, joy: 181_819 });
    const over = ill(adult, { ...level(NEED_MAX), hunger: 0, joy: 181_818 });
    expect(derive(under).health.reason).toEqual({ kind: "sick" });
    expect(derive(over).health.reason).toEqual({ kind: "need", need: "hunger" });
    expect(derive(v2(under)).health.reason).toEqual({ kind: "need", need: "hunger" });
    expect(derive(v2(over)).health.reason).toEqual({ kind: "need", need: "hunger" });
  });

  it("tells a sick elder below its line about the sickness, and buries it as old age", () => {
    const state = v2(ill(elder, level(500_000)));
    expect(derive(state).health.reason).toEqual({ kind: "sick" });
    expect(diedOf(state)).toBe("age");
  });

  it("tells an unmedicated elder at its line about the sickness, and buries it as sick", () => {
    const state = v2(ill(elder, level(700_000)));
    expect(derive(state).health.reason).toEqual({ kind: "sick" });
    expect(diedOf(state)).toBe("sickness");
  });

  it("tells a well elder below its line about age, and buries it as old age", () => {
    const state = v2({ ...ill(elder, level(500_000)), sick: false });
    expect(derive(state).health.reason).toEqual({ kind: "age" });
    expect(diedOf(state)).toBe("age");
  });
});
