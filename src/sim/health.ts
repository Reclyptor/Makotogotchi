// The health clock's arithmetic, one tick's worth (SPEC §2.3). project.ts
// folds it into healthRaw; derive.ts reads the same terms to say which way
// health is moving, so the screen and the death clock share one set of numbers.
//
// They do not share one ranking of the causes, and under ruleset 2 that is on
// purpose. The screen is for the person looking at it, so it names what they
// can fix first: a critical need, then sickness, then age. A sick adult with a
// need under 20% is told about the need, because sickness alone only stalls an
// adult and feeding is the cure; a sick elder below its line is told about the
// sickness, because medicine is. The gravestone is for the pet, and `causeOfDeath`
// credits what the pet was: a need, then age, then sickness, so an elder worn
// down by age under devoted care reads as the win it was even when it was also
// ill. Ruleset 1 ranks both by largest drain.

import { elderRampDayAt, meditatingAt, rulesVersionOf, stageOf, type CauseOfDeath, type PetState } from "./model";
import {
  CRITICAL_THRESHOLD,
  elderHoldLine,
  elderVigourPermille,
  HEALTH_DRAIN_AGE,
  HEALTH_DRAIN_PER_NEED,
  HEALTH_DRAIN_SICK,
  HEALTH_REGEN,
  HEALTH_REGEN_ELDER,
  needsMean,
  NEED_KEYS,
  RULES_SINCE,
  sageHoldMean,
  sageVigourPermille,
  type NeedKey,
} from "./tuning";

export type HealthTerms = {
  /** Health lost this tick to needs below critical. */
  drainNeeds: number;
  drainSick: number;
  drainAge: number;
  regen: number;
  /** The deepest deficit below critical, if any need is there. */
  worstNeed: NeedKey | null;
  /** The elder's standing against its hold line, in thousandths of a bar. */
  elder: { holdPermille: number; meanPermille: number; vigour: number } | null;
};

/** What the health step takes and gives at `tick`, reading the needs as they stand in `state`. */
export const healthTerms = (state: PetState, tick: number): HealthTerms => {
  let deficitTotal = 0;
  let worstNeed: NeedKey | null = null;
  let worstDeficit = 0;
  for (const need of NEED_KEYS) {
    const deficit = CRITICAL_THRESHOLD - state.needs[need];
    if (deficit > 0) {
      deficitTotal += deficit;
      if (deficit > worstDeficit) {
        worstDeficit = deficit;
        worstNeed = need;
      }
    }
  }

  // Old age is held off by care (SPEC §2.3): the age drain scales with the
  // elder's vigour — against a hold line that climbs once the leader has
  // started the ramp — and an elder at full vigour regains health slowly.
  // A Sage stands against its own flat, lower line (SPEC §2.8).
  let elder: HealthTerms["elder"] = null;
  const stage = stageOf(state, tick);
  if (stage === "SAGE") {
    elder = {
      holdPermille: Math.floor(sageHoldMean(state.form) / 1000),
      meanPermille: Math.floor(needsMean(state.needs) / 1000),
      vigour: sageVigourPermille(state.needs, state.form),
    };
  } else if (stage === "ELDER") {
    const rampDay = elderRampDayAt(state, tick);
    const rules = rulesVersionOf(state);
    elder = {
      holdPermille: Math.floor(elderHoldLine(rampDay, state.form, rules) / 1000),
      meanPermille: Math.floor(needsMean(state.needs) / 1000),
      vigour: elderVigourPermille(state.needs, rampDay, state.form, rules),
    };
  }

  // Meditation is a stasis (SPEC §2.8): health neither drains nor heals, and
  // the elder's standing is still reported so the screen can show it.
  if (meditatingAt(state, tick)) {
    return { drainNeeds: 0, drainSick: 0, drainAge: 0, regen: 0, worstNeed, elder };
  }

  return {
    drainNeeds: HEALTH_DRAIN_PER_NEED * deficitTotal,
    drainSick: state.sick ? HEALTH_DRAIN_SICK : 0,
    drainAge: elder ? Math.floor((HEALTH_DRAIN_AGE * (1000 - elder.vigour)) / 1000) : 0,
    // Deficit drain and regeneration are mutually exclusive by construction.
    regen: deficitTotal !== 0 ? 0 : elder ? (elder.vigour === 1000 ? HEALTH_REGEN_ELDER : 0) : HEALTH_REGEN,
    worstNeed,
    elder,
  };
};

/**
 * What to write on the gravestone, given the terms of the tick that emptied the
 * bar (SPEC §2.3). A need below critical always wins — starvation is still
 * starvation. From there the histories part ways:
 *
 * - Ruleset 2: an elder below its hold line dies of age, sick or not; anything
 *   else of sickness.
 * - Before it: the largest drain at that moment, with ties going needs, then
 *   sickness, then age. A sick elder's 120M sickness term outweighs the age
 *   drain at every vigour, so under that rule age could only ever be credited
 *   to an elder who was not sick, and that is the rule old logs keep.
 */
export const causeOfDeath = (state: PetState, terms: HealthTerms): CauseOfDeath => {
  const { worstNeed } = terms;
  if (rulesVersionOf(state) >= RULES_SINCE.AGE_CREDIT) {
    if (worstNeed !== null) return worstNeed;
    return terms.elder !== null && terms.elder.vigour < 1000 ? "age" : "sickness";
  }
  let cause: CauseOfDeath = worstNeed ?? "sickness";
  let magnitude = worstNeed !== null ? HEALTH_DRAIN_PER_NEED * (CRITICAL_THRESHOLD - state.needs[worstNeed]) : 0;
  if (terms.drainSick > magnitude) {
    cause = "sickness";
    magnitude = terms.drainSick;
  }
  if (terms.drainAge > magnitude) cause = "age";
  return cause;
};
