// The health clock's arithmetic, one tick's worth (SPEC §2.3). project.ts
// folds it into healthRaw; derive.ts reads the same terms to say which way
// health is moving and why — so the screen can never disagree with the death
// clock about what is draining it.

import { elderRampDayAt, rulesVersionOf, stageAt, type CauseOfDeath, type PetState } from "./model";
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
  let elder: HealthTerms["elder"] = null;
  if (stageAt(state.bornAtTick, tick) === "ELDER") {
    const rampDay = elderRampDayAt(state, tick);
    // The FRAIL cap only exists for a history lived under the rules that added it.
    const form = rulesVersionOf(state) >= RULES_SINCE.FRAIL_CAP ? state.form : null;
    elder = {
      holdPermille: Math.floor(elderHoldLine(rampDay, form) / 1000),
      meanPermille: Math.floor(needsMean(state.needs) / 1000),
      vigour: elderVigourPermille(state.needs, rampDay, form),
    };
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
