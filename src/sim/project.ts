// Advances simulated time. This is the reference semantics of the whole game:
// an exact, per-tick, integer fold with a pinned step order. Path independence
// — project(project(s, a), b) === project(s, b) — holds by construction
// because each tick is a pure function of the previous tick's state and the
// absolute tick index (SPEC §4.5). Any closed-form optimization must
// property-test equal to this.
//
// Step order within one tick, pinned and load-bearing (changing it changes
// every replay):
//   1. stage evolution (EVOLVED; adult form decided at the ADULT boundary;
//      MEDITATING on the first tick of an elder's meditation)
//   2. schedule sleep/wake sync
//   3. need decay / sleep recovery
//   4. involuntary-nap transitions (post-decay energy)
//   5. CRITICAL crossing milestones
//   6. careScore accumulation (JUVENILE only, post-decay)
//   7. sickness onset draw (keyed by absolute tick, pre-drain health)
//   8. health drain / regeneration, death check
//
// A meditating pet skips 3 and 7, and health.ts gives it no terms for 8: the
// two days are a stasis (SPEC §2.8).

import {
  isAlive,
  meditatingAt,
  meditationStartTickOf,
  rulesVersionOf,
  sageStartTickOf,
  stageAt,
  type PetState,
  type ProjectionContext,
} from "./model";
import { causeOfDeath, healthTerms } from "./health";
import { careMultiplierOf } from "./difficulty";
import { draw32, RNG_PURPOSE } from "./rng";
import {
  BASELINE_CARE_PERMILLE,
  CRITICAL_THRESHOLD,
  decayRates,
  ENERGY_SLEEP_RECOVERY,
  EXHAUSTED_THRESHOLD,
  FADING_THRESHOLD,
  formThresholds,
  HEALTH_MAX,
  isOld,
  NAP_WAKE_THRESHOLD,
  NEED_KEYS,
  NEED_MAX,
  RULES_SINCE,
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

  // Only a RULES event moves either, and events fold between projections.
  const meditationStart = meditationStartTickOf(state);
  const sageStart = sageStartTickOf(state);
  const formLines = formThresholds(state.generation.sageBlessed === true);
  let stage = stageAt(bornAtTick, state.tick, sageStart);
  // How hard the community has made the pet (SPEC §23). It is fixed for the
  // whole projection: only a POPULATION event changes it, and events are
  // folded between projections, never during one.
  const difficultyPermille = careMultiplierOf(state);
  // Under ruleset 2 the night is exempt from it (SPEC §23): only a RULES event
  // changes this, and events fold between projections.
  const nightExempt = rulesVersionOf(state) >= RULES_SINCE.NIGHT_EXEMPT;

  for (let tick = state.tick + 1; tick <= toTick; tick++) {
    // 1. Stage evolution.
    const nextStage = stageAt(bornAtTick, tick, sageStart);
    if (nextStage !== stage) {
      if (nextStage === "ADULT" && state.form === null) {
        // careScore is the mean of all four needs across the window:
        // careNum / (careTicks × NEED_KEYS.length) — compared without
        // division by scaling the threshold instead.
        const denominator = state.careTicks * NEED_KEYS.length;
        state.form =
          state.careTicks === 0
            ? "STEADY"
            : state.careNum >= formLines.thriving * denominator
              ? "THRIVING"
              : state.careNum >= formLines.steady * denominator
                ? "STEADY"
                : "FRAIL";
      }
      stage = nextStage;
      milestones.push({ kind: "EVOLVED", tick, detail: stage });
    }
    if (tick === meditationStart) milestones.push({ kind: "MEDITATING", tick });
    const meditating = meditatingAt(state, tick);

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
    const rates = meditating ? null : decayRates(
      stage as Exclude<LifeStage, "EGG">,
      state.form,
      state.asleep ? "SLEEP" : "WAKE",
      nightExempt && phase === "SLEEP" ? BASELINE_CARE_PERMILLE : difficultyPermille,
    );
    const before = { ...state.needs };
    if (rates !== null) {
      for (const need of NEED_KEYS) {
        state.needs[need] = clampNeed(state.needs[need] - rates[need], NEED_MAX);
      }
    }
    if (state.asleep && !meditating) {
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
    if (!state.sick && !meditating) {
      const threshold = sickOnsetThreshold(state.needs.hygiene, state.healthRaw);
      if (draw32(state.generation.seed, tick, RNG_PURPOSE.sickOnset) < threshold) {
        state.sick = true;
        state.sickSinceTick = tick;
        milestones.push({ kind: "BECAME_SICK", tick });
      }
    }

    // 8. Health. The terms (and why deficit drain and regeneration never
    // coexist) live in health.ts, shared with derive (SPEC §2.3).
    const terms = healthTerms(state, tick);
    const healthBefore = state.healthRaw;
    state.healthRaw = clampNeed(state.healthRaw - terms.drainNeeds - terms.drainSick - terms.drainAge + terms.regen, HEALTH_MAX);
    // An elder crossing below the fading line, once per descent (SPEC §2.10).
    if (isOld(stage) && healthBefore >= FADING_THRESHOLD && state.healthRaw < FADING_THRESHOLD) {
      milestones.push({ kind: "FADING", tick });
    }

    if (state.healthRaw === 0) {
      const cause = causeOfDeath(state, terms);
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
