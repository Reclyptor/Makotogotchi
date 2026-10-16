// The health clock's arithmetic, one tick's worth (SPEC §2.3). project.ts
// folds it into healthRaw; derive.ts reads the same terms to say which way
// health is moving and why — so the screen can never disagree with the death
// clock about what is draining it.

import { elderRampDayAt, stageAt, type PetState } from "./model";
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
    elder = {
      holdPermille: Math.floor(elderHoldLine(rampDay) / 1000),
      meanPermille: Math.floor(needsMean(state.needs) / 1000),
      vigour: elderVigourPermille(state.needs, rampDay),
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
