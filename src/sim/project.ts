// Advances simulated time. This is the reference semantics of the whole game:
// an exact, per-tick, integer fold with a pinned step order. Path independence
// — project(project(s, a), b) === project(s, b) — holds by construction
// because each tick is a pure function of the previous tick's state and the
// absolute tick index (SPEC §4.5). Any closed-form optimization must
// property-test equal to this.
//
// Step order within one tick, pinned and load-bearing (changing it changes
// every replay):
//   1. stage evolution (EVOLVED; adult form decided at the ADULT boundary)
//   2. schedule sleep/wake sync
//   3. need decay / sleep recovery
//   4. involuntary-nap transitions (post-decay energy)
//   5. CRITICAL crossing milestones
//   6. careScore accumulation (JUVENILE only, post-decay)
//   7. sickness onset draw (keyed by absolute tick, pre-drain health)
//   8. health drain / regeneration, death check

import { isAlive, stageAt, type CauseOfDeath, type PetState, type ProjectionContext } from "./model";
import { draw32, RNG_PURPOSE } from "./rng";
import {
  CRITICAL_THRESHOLD,
  decayRates,
  ENERGY_SLEEP_RECOVERY,
  EXHAUSTED_THRESHOLD,
  FORM_STEADY_AT,
  FORM_THRIVING_AT,
  HEALTH_DRAIN_AGE,
  HEALTH_DRAIN_PER_NEED,
  HEALTH_DRAIN_SICK,
  HEALTH_MAX,
  HEALTH_REGEN,
  NAP_WAKE_THRESHOLD,
  NEED_KEYS,
  NEED_MAX,
  sickOnsetThreshold,
  type LifeStage,
} from "./tuning";
import type { Milestone } from "./events";

export type ProjectionResult = {
  state: PetState;
  milestones: Milestone[];
};

const clampNeed = (value: number, max: number): number => (value < 0 ? 0 : value > max ? max : value);

export const project = (input: PetState, toTick: number, ctx: ProjectionContext): ProjectionResult => {
  if (toTick < input.tick) throw new Error(`cannot project backwards: ${input.tick} → ${toTick}`);
  if (toTick === input.tick) return { state: input, milestones: [] };

  // An unhatched egg and a dead pet are frozen — only the clock moves.
  if (!isAlive(input)) {
    return { state: { ...input, tick: toTick }, milestones: [] };
  }

  const state = structuredClone(input) as PetState;
  const milestones: Milestone[] = [];
  const bornAtTick = state.bornAtTick as number; // isAlive guarantees non-null

  // Walk the schedule with a cursor instead of re-scanning per tick.
  let boundaryIdx = 0;
  let phase = ctx.schedule.initialPhase;
  const boundaries = ctx.schedule.boundaries;
  while (boundaryIdx < boundaries.length && boundaries[boundaryIdx]!.tick <= state.tick) {
    phase = boundaries[boundaryIdx]!.phase;
    boundaryIdx += 1;
  }

  let stage = stageAt(bornAtTick, state.tick);

  for (let tick = state.tick + 1; tick <= toTick; tick++) {
    // 1. Stage evolution.
    const nextStage = stageAt(bornAtTick, tick);
    if (nextStage !== stage) {
      if (nextStage === "ADULT" && state.form === null) {
        // careScore is the mean of all four needs across the window:
        // careNum / (careTicks × NEED_KEYS.length) — compared without
        // division by scaling the threshold instead.
        const denominator = state.careTicks * NEED_KEYS.length;
        state.form =
          state.careTicks === 0
            ? "STEADY"
            : state.careNum >= FORM_THRIVING_AT * denominator
              ? "THRIVING"
              : state.careNum >= FORM_STEADY_AT * denominator
                ? "STEADY"
                : "FRAIL";
      }
      stage = nextStage;
      milestones.push({ kind: "EVOLVED", tick, detail: stage });
    }

    // 2. Scheduled sleep/wake.
    while (boundaryIdx < boundaries.length && boundaries[boundaryIdx]!.tick <= tick) {
      phase = boundaries[boundaryIdx]!.phase;
      boundaryIdx += 1;
    }
    if (phase === "SLEEP" && !state.asleep) {
      state.asleep = true;
      state.sleepReason = "NIGHT";
      milestones.push({ kind: "SLEPT", tick });
    } else if (phase === "SLEEP" && state.asleep && state.sleepReason !== "NIGHT") {
      state.sleepReason = "NIGHT"; // a nap that runs into the night becomes the night's sleep
    } else if (phase === "WAKE" && state.asleep && state.sleepReason === "NIGHT") {
      state.asleep = false;
      state.sleepReason = null;
      milestones.push({ kind: "WOKE", tick });
    }

    // 3. Decay / recovery. EGG never reaches here, so stage is post-hatch.
    const rates = decayRates(stage as Exclude<LifeStage, "EGG">, state.form, state.asleep ? "SLEEP" : "WAKE");
    const before = { ...state.needs };
    for (const need of NEED_KEYS) {
      state.needs[need] = clampNeed(state.needs[need] - rates[need], NEED_MAX);
    }
    if (state.asleep) {
      state.needs.energy = clampNeed(state.needs.energy + ENERGY_SLEEP_RECOVERY, NEED_MAX);
    }

    // 4. Involuntary naps; nap/lullaby sleep ends when rested.
    if (!state.asleep && state.needs.energy < EXHAUSTED_THRESHOLD) {
      state.asleep = true;
      state.sleepReason = "NAP";
      milestones.push({ kind: "SLEPT", tick });
    } else if (state.asleep && state.sleepReason !== "NIGHT" && state.needs.energy >= NAP_WAKE_THRESHOLD) {
      state.asleep = false;
      state.sleepReason = null;
      milestones.push({ kind: "WOKE", tick });
    }

    // 5. Downward CRITICAL crossings.
    for (const need of NEED_KEYS) {
      if (before[need] >= CRITICAL_THRESHOLD && state.needs[need] < CRITICAL_THRESHOLD) {
        milestones.push({ kind: "CRITICAL", tick, detail: need });
      }
    }

    // 6. careScore window.
    if (stage === "JUVENILE") {
      state.careNum += state.needs.hunger + state.needs.energy + state.needs.hygiene + state.needs.joy;
      state.careTicks += 1;
    }

    // 7. Sickness onset — the only randomness in the game (SPEC §2.9).
    if (!state.sick) {
      const threshold = sickOnsetThreshold(state.needs.hygiene, state.healthRaw);
      if (draw32(state.generation.seed, tick, RNG_PURPOSE.sickOnset) < threshold) {
        state.sick = true;
        state.sickSinceTick = tick;
        milestones.push({ kind: "BECAME_SICK", tick });
      }
    }

    // 8. Health. Deficit drain and regeneration are mutually exclusive by
    // construction (SPEC §2.3).
    let deficitDrain = 0;
    let worstNeed: CauseOfDeath = "hunger";
    let worstDeficit = -1;
    for (const need of NEED_KEYS) {
      const deficit = CRITICAL_THRESHOLD - state.needs[need];
      if (deficit > 0) {
        deficitDrain += deficit;
        if (deficit > worstDeficit) {
          worstDeficit = deficit;
          worstNeed = need;
        }
      }
    }
    const drainNeeds = HEALTH_DRAIN_PER_NEED * deficitDrain;
    const drainSick = state.sick ? HEALTH_DRAIN_SICK : 0;
    const drainAge = stage === "ELDER" ? HEALTH_DRAIN_AGE : 0;
    const regen = deficitDrain === 0 && stage !== "ELDER" ? HEALTH_REGEN : 0;
    state.healthRaw = clampNeed(state.healthRaw - drainNeeds - drainSick - drainAge + regen, HEALTH_MAX);

    if (state.healthRaw === 0) {
      // Cause: the largest drain source at the moment of death, with a
      // deterministic tie order of needs → sickness → age.
      let cause: CauseOfDeath = worstDeficit > 0 ? worstNeed : "sickness";
      let causeMagnitude = worstDeficit > 0 ? HEALTH_DRAIN_PER_NEED * worstDeficit : 0;
      if (drainSick > causeMagnitude) {
        cause = "sickness";
        causeMagnitude = drainSick;
      }
      if (drainAge > causeMagnitude) {
        cause = "age";
      }
      state.diedAtTick = tick;
      state.causeOfDeath = cause;
      state.tick = toTick;
      milestones.push({ kind: "DIED", tick, detail: cause });
      return { state, milestones };
    }
  }

  state.tick = toTick;
  return { state, milestones };
};
