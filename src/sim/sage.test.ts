// Meditation and the Sage (SPEC §2.8): when the rule starts, what the two days
// of stillness hold still, what they turn away, and what a Sage is asked for.

import { describe, expect, it } from "vitest";
import { derive } from "./derive";
import type { PetEvent } from "./events";
import { healthTerms } from "./health";
import { deepMeditationAt, meditatingAt, meditationStartTickOf, sageStartTickOf, stageOf, type PetState } from "./model";
import { project } from "./project";
import { reduce } from "./reduce";
import { hatchedState, projectImmortal, QUIET_SEED, testCtx, withSeed } from "./testkit";
import {
  CARE_ACTIONS,
  decayRates,
  ELDER_BAND,
  ELDER_STARTS_AT,
  FORM_STEADY_AT,
  FORM_THRIVING_AT,
  HEALTH_MAX,
  MEDITATION_STARTS_AT,
  MEDITATION_TICKS,
  NEED_KEYS,
  RULES_SINCE,
  SAGE_HOLD_MEAN,
  SAGE_HOLD_MEAN_FRAIL,
  sageVigourPermille,
  TICKS_PER_DAY,
} from "./tuning";
import { canPerform } from "./validate";

const ctx = testCtx(60);
const generation = withSeed(QUIET_SEED);

const rulesEvent = (tick: number, version: number = RULES_SINCE.SAGE): PetEvent => ({
  type: "RULES",
  generationId: generation.id,
  seq: 1,
  tick,
  version,
});

/** A pet hatched at tick 0 that the leader brings to `version` at `tick`. */
const recordedAt = (tick: number, version: number = RULES_SINCE.SAGE): PetState => {
  const young = projectImmortal(hatchedState(ctx, generation), tick, ctx);
  return reduce(young, rulesEvent(tick, version), ctx).state;
};

const level = (value: number) => ({ hunger: value, energy: value, hygiene: value, joy: value });

describe("when the meditation starts", () => {
  it("is day 40 for a pet that was young when the rule arrived", () => {
    const state = recordedAt(5);
    expect(state.sageRuleFromTick).toBe(5);
    expect(meditationStartTickOf(state)).toBe(MEDITATION_STARTS_AT);
    expect(sageStartTickOf(state)).toBe(MEDITATION_STARTS_AT + MEDITATION_TICKS);
  });

  it("is the tick after the rule arrived for a pet already past day 40", () => {
    // Makoto the 2nd: about 46 days old at release.
    const release = 46 * TICKS_PER_DAY + 123;
    const state = recordedAt(release);
    expect(meditationStartTickOf(state)).toBe(release + 1);
    expect(meditatingAt(state, release)).toBe(false);
    expect(meditatingAt(state, release + 1)).toBe(true);
  });

  it("is fixed by the first RULES event: a duplicate append changes nothing", () => {
    const once = recordedAt(5);
    const twice = reduce(projectImmortal(once, 10, ctx), rulesEvent(10), ctx).state;
    expect(twice.sageRuleFromTick).toBe(5);
  });

  it("never comes under an older ruleset", () => {
    const state = recordedAt(5, RULES_SINCE.SAGE - 1);
    expect(state.sageRuleFromTick).toBeUndefined();
    expect(meditationStartTickOf(state)).toBeNull();
    expect(stageOf(state, 60 * TICKS_PER_DAY)).toBe("ELDER");
  });
});

describe("stage", () => {
  const state = recordedAt(5);
  const start = MEDITATION_STARTS_AT;
  it("is ELDER through the meditation and SAGE from the tick it ends", () => {
    expect(stageOf(state, ELDER_STARTS_AT)).toBe("ELDER");
    expect(stageOf(state, start)).toBe("ELDER");
    expect(stageOf(state, start + MEDITATION_TICKS - 1)).toBe("ELDER");
    expect(stageOf(state, start + MEDITATION_TICKS)).toBe("SAGE");
  });

  it("marks the two days with MEDITATING and EVOLVED milestones on their exact ticks", () => {
    const before = projectImmortal(state, start - 1, ctx);
    const { milestones } = project({ ...before, healthRaw: HEALTH_MAX }, start + MEDITATION_TICKS, ctx);
    expect(milestones.filter((m) => m.kind === "MEDITATING")).toEqual([{ kind: "MEDITATING", tick: start }]);
    expect(milestones.filter((m) => m.kind === "EVOLVED")).toEqual([
      { kind: "EVOLVED", tick: start + MEDITATION_TICKS, detail: "SAGE" },
    ]);
  });

  it("emits MEDITATING on the first projected tick for a pet the rule reaches late", () => {
    const release = 46 * TICKS_PER_DAY;
    const { milestones } = project(recordedAt(release), release + 10, ctx);
    expect(milestones).toContainEqual({ kind: "MEDITATING", tick: release + 1 });
  });
});

describe("the second day of meditation", () => {
  const state = recordedAt(5);
  const start = MEDITATION_STARTS_AT;
  const end = start + MEDITATION_TICKS;

  it("is not deep on the first day", () => {
    expect(deepMeditationAt(state, start)).toBe(false);
    expect(deepMeditationAt(state, start + TICKS_PER_DAY - 1)).toBe(false);
  });

  it("is deep from the first tick of day 2 to the last tick of meditation", () => {
    expect(deepMeditationAt(state, start + TICKS_PER_DAY)).toBe(true);
    expect(deepMeditationAt(state, end - 1)).toBe(true);
  });

  it("ends the moment the pet is a Sage", () => {
    expect(deepMeditationAt(state, end)).toBe(false);
    expect(deepMeditationAt(state, end + TICKS_PER_DAY)).toBe(false);
  });

  it("is never deep for a pet the rule has not reached", () => {
    const young = projectImmortal(hatchedState(ctx, generation), start + TICKS_PER_DAY, ctx);
    expect(deepMeditationAt(young, start + TICKS_PER_DAY)).toBe(false);
  });

  it("reaches the derived state only while the pet meditates deeply", () => {
    const at = (tick: number) => derive({ ...projectImmortal(state, tick, ctx) }).deepMeditation;
    expect([at(start + 10), at(start + TICKS_PER_DAY), at(end + 10)]).toEqual([false, true, false]);
  });
});

describe("serene stasis", () => {
  const start = MEDITATION_STARTS_AT;
  const entering = (sick: boolean): PetState => {
    const before = projectImmortal(recordedAt(5), start - 1, ctx);
    return {
      ...before,
      needs: { hunger: 410_000, energy: 380_000, hygiene: 520_000, joy: 300_000 },
      healthRaw: HEALTH_MAX / 2,
      sick,
      sickSinceTick: sick ? before.tick : null,
    };
  };

  it("holds every need and health still for the two days, even through the nights", () => {
    const inState = project(entering(false), start, ctx).state;
    const outState = project(inState, start + MEDITATION_TICKS - 1, ctx).state;
    expect(outState.needs).toEqual(inState.needs);
    expect(outState.healthRaw).toBe(inState.healthRaw);
  });

  it("holds a sick pet's health still too, and draws no new sickness", () => {
    const sickIn = project(entering(true), start, ctx).state;
    const sickOut = project(sickIn, start + MEDITATION_TICKS - 1, ctx).state;
    expect(sickOut.healthRaw).toBe(sickIn.healthRaw);

    const wellOut = project(project(entering(false), start, ctx).state, start + MEDITATION_TICKS - 1, ctx).state;
    expect(wellOut.sick).toBe(false);
  });

  it("gives the health step no terms, and the screen a meditation to show", () => {
    const meditating = project(entering(true), start + 100, ctx).state;
    const terms = healthTerms(meditating, meditating.tick);
    expect([terms.drainNeeds, terms.drainSick, terms.drainAge, terms.regen]).toEqual([0, 0, 0, 0]);
    const view = derive(meditating);
    expect(view.animation).toBe("meditating");
    expect(view.meditatingUntilTick).toBe(start + MEDITATION_TICKS);
    expect(view.health.trend).toBe("steady");
  });

  it("decays again from the first Sage tick", () => {
    const atEnd = project(entering(false), start + MEDITATION_TICKS - 1, ctx).state;
    const after = project(atEnd, start + MEDITATION_TICKS + 1, ctx).state;
    expect(after.needs.hunger).toBeLessThan(atEnd.needs.hunger);
  });

  it("turns away FEED, PLAY, CLEAN and LULLABY, and lets a pat and medicine through", () => {
    const meditating = project(entering(true), start + 100, ctx).state;
    const verdicts = Object.fromEntries(CARE_ACTIONS.map((action) => [action, canPerform(meditating, action, "carer", ctx)]));
    for (const action of ["FEED", "PLAY", "CLEAN", "LULLABY"] as const) {
      expect(verdicts[action]).toEqual({ ok: false, reason: "MEDITATING" });
    }
    expect(verdicts.PET).toEqual({ ok: true });
    expect(verdicts.MEDICATE).toEqual({ ok: true });
  });

  it("lets a wish that lapses mid-meditation go without a joy debit", () => {
    const meditating = project(entering(false), start + 100, ctx).state;
    const open: PetState = { ...meditating, wantOpen: { window: 7, kind: "cuddle" } };
    const expired: PetEvent = { type: "WANT_EXPIRED", generationId: generation.id, seq: 2, tick: meditating.tick, windowIndex: 7 };
    const after = reduce(open, expired, ctx).state;
    expect(after.needs.joy).toBe(meditating.needs.joy);
    expect(after.wantOpen).toBeNull();
    expect(after.wantSettledWindow).toBe(7);
  });

  it("lets a medicated pet leave the meditation well", () => {
    const meditating = project(entering(true), start + 100, ctx).state;
    const care: PetEvent = {
      type: "CARE",
      generationId: generation.id,
      seq: 2,
      tick: meditating.tick,
      action: "MEDICATE",
      caretakerId: "carer",
    };
    expect(reduce(meditating, care, ctx).state.sick).toBe(false);
  });
});

describe("the Sage's gentler body", () => {
  it("decays at the adult rate, not the elder's", () => {
    for (const form of ["THRIVING", "STEADY", "FRAIL"] as const) {
      for (const phase of ["WAKE", "SLEEP"] as const) {
        expect(decayRates("SAGE", form, phase)).toEqual(decayRates("ADULT", form, phase));
      }
    }
    expect(decayRates("SAGE", "STEADY", "WAKE").hunger).toBeLessThan(decayRates("ELDER", "STEADY", "WAKE").hunger);
  });

  it("is held to a flat 65% line, 60% for a FRAIL Sage, with the elder's band beneath", () => {
    expect(sageVigourPermille(level(SAGE_HOLD_MEAN), "STEADY")).toBe(1000);
    expect(sageVigourPermille(level(SAGE_HOLD_MEAN - ELDER_BAND / 2), "STEADY")).toBe(500);
    expect(sageVigourPermille(level(SAGE_HOLD_MEAN - ELDER_BAND), "STEADY")).toBe(0);
    expect(sageVigourPermille(level(SAGE_HOLD_MEAN_FRAIL), "FRAIL")).toBe(1000);
  });

  it("reads its own line in the health terms", () => {
    const sage = projectImmortal(recordedAt(5), MEDITATION_STARTS_AT + MEDITATION_TICKS + 10, ctx);
    const terms = healthTerms({ ...sage, form: "STEADY", needs: level(SAGE_HOLD_MEAN) }, sage.tick);
    expect(terms.elder).toEqual({ holdPermille: 650, meanPermille: 650, vigour: 1000 });
    expect(derive(sage).stage).toBe("SAGE");
  });
});

describe("the Sage's blessing", () => {
  // A juvenile whose careScore sits between the blessed and the ordinary
  // THRIVING lines, carried across the ADULT boundary.
  const formWith = (blessed: boolean, careScore: number) => {
    const blessedGeneration = blessed ? { ...generation, sageBlessed: true as const } : generation;
    const juvenile = projectImmortal(hatchedState(ctx, blessedGeneration), 7 * TICKS_PER_DAY - 1, ctx);
    const ticks = 1000;
    const scored: PetState = { ...juvenile, form: null, careTicks: ticks, careNum: careScore * ticks * NEED_KEYS.length };
    return project(scored, 7 * TICKS_PER_DAY, ctx).state.form;
  };

  it("lowers the THRIVING line ten points", () => {
    expect(formWith(false, FORM_THRIVING_AT - 50_000)).toBe("STEADY");
    expect(formWith(true, FORM_THRIVING_AT - 50_000)).toBe("THRIVING");
  });

  it("lowers the STEADY line ten points", () => {
    expect(formWith(false, FORM_STEADY_AT - 50_000)).toBe("FRAIL");
    expect(formWith(true, FORM_STEADY_AT - 50_000)).toBe("STEADY");
  });
});
