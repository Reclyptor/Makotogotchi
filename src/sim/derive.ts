// Everything presentational, computed from stored state and never stored
// (SPEC §4.3). The renderer receives an animation key from here; PetState has
// no field capable of holding one — the class of bug where animation frames
// leak into game state is structurally impossible.

import { careMultiplier, DIFFICULTY_BASELINE, presencePermilleOf } from "./difficulty";
import { healthTerms, type HealthTerms } from "./health";
import { deepMeditationAt, isAlive, meditatingAt, rulesVersionOf, sageStartTickOf, stageOf, type PetState } from "./model";
import {
  AILMENT_THRESHOLDS,
  CRITICAL_THRESHOLD,
  FADING_THRESHOLD,
  HEALTH_MAX,
  isOld,
  NEED_KEYS,
  RULES_SINCE,
  type LifeStage,
  type NeedKey,
} from "./tuning";

export type Ailment = "SICK" | "FILTHY" | "STARVING" | "EXHAUSTED" | "SAD";

export type AnimationKey =
  | "egg"
  | "idle"
  | "meditating"
  | "sleeping"
  | "sick"
  | "dirty"
  | "hungry"
  | "tired"
  | "bored"
  | "dead";

export type AlertLevel = "OK" | "WARN" | "CRITICAL";

/**
 * How the death clock is doing, for copy that has to say more than "fine":
 * `well` above the critical line; below it, `recovering` while health is
 * actually climbing back, `frail` while it is not — sickness or a critical
 * need cancels the regen, and an elder regains health only at full vigour
 * (SPEC §2.3). `fading` is the elder's twilight (§2.10): health under the
 * fading line and still drifting down because the needs' mean is short of
 * the hold line.
 */
export type Vitality = "well" | "fading" | "recovering" | "frail";

/** Which term is moving health most (SPEC §2.3); the UI words it. */
export type HealthReason =
  | { kind: "need"; need: NeedKey } // a need is below critical
  | { kind: "sick" }
  | { kind: "age" } // an elder below its hold line
  | { kind: "regen" } // recovering
  | { kind: "full" } // at max, nothing moving
  | { kind: "holding" }; // drains equal regen, e.g. sick but fed

export type HealthView = {
  trend: "rising" | "falling" | "steady";
  /**
   * The term to blame. Ruleset 1: the largest drain, ties to need, then
   * sickness, then age. Ruleset 2: the first of need, sickness, age that is
   * draining — the order of what a caretaker can fix (health.ts).
   */
  reason: HealthReason;
  /** An elder's hold line and the needs' mean today, in thousandths of a bar (600 = 60%) so a half-point line is not rounded away. */
  elder: { linePermille: number; meanPermille: number } | null;
};

export type DerivedState = {
  stage: LifeStage;
  /** The tick an elder's meditation ends, while it is meditating (SPEC §2.8). */
  meditatingUntilTick: number | null;
  /** Whether the meditation is on its second day, when the room draws an aura (SPEC §2.8). */
  deepMeditation: boolean;
  ailments: Ailment[];
  animation: AnimationKey;
  alert: AlertLevel;
  vitality: Vitality;
  /** Needs as display percentages, 0–100. */
  percentages: Record<NeedKey, number> & { health: number };
  /** Named caretakers who cared this week (SPEC §23.3) — a head count. */
  population: number;
  /** What their number multiplies need decay by, e.g. 2.28. */
  careMultiplier: number;
  /** Which way health is moving this tick, and why. */
  health: HealthView;
};

const HEALTH_CRITICAL = HEALTH_MAX / 4; // 25% — the strongest push trigger

const fallingReason = (state: PetState, terms: HealthTerms): HealthReason => {
  const { worstNeed, drainNeeds, drainSick, drainAge } = terms;
  if (rulesVersionOf(state) >= RULES_SINCE.ACTIONABLE_REASON) {
    if (worstNeed !== null) return { kind: "need", need: worstNeed };
    return drainSick > 0 ? { kind: "sick" } : { kind: "age" };
  }
  if (worstNeed !== null && drainNeeds >= drainSick && drainNeeds >= drainAge) return { kind: "need", need: worstNeed };
  return drainSick >= drainAge ? { kind: "sick" } : { kind: "age" };
};

const healthViewOf = (state: PetState, terms: HealthTerms): HealthView => {
  // Nothing is draining a pet that is not alive: an egg sits at full, a grave
  // at none, and there is no hold line to report.
  if (!isAlive(state)) {
    return { trend: "steady", reason: { kind: state.healthRaw >= HEALTH_MAX ? "full" : "holding" }, elder: null };
  }
  const elder = terms.elder
    ? { linePermille: terms.elder.holdPermille, meanPermille: terms.elder.meanPermille }
    : null;

  const drain = terms.drainNeeds + terms.drainSick + terms.drainAge;
  const net = terms.regen - drain;
  if (net > 0) {
    return state.healthRaw >= HEALTH_MAX
      ? { trend: "steady", reason: { kind: "full" }, elder }
      : { trend: "rising", reason: { kind: "regen" }, elder };
  }
  if (net === 0) {
    return { trend: "steady", reason: drain === 0 && state.healthRaw >= HEALTH_MAX ? { kind: "full" } : { kind: "holding" }, elder };
  }
  return { trend: "falling", reason: fallingReason(state, terms), elder };
};

export const derive = (state: PetState): DerivedState => {
  const stage = stageOf(state, state.tick);
  const meditating = isAlive(state) && meditatingAt(state, state.tick);

  const ailments: Ailment[] = [];
  if (state.sick) ailments.push("SICK");
  for (const [ailment, rule] of Object.entries(AILMENT_THRESHOLDS)) {
    if (state.needs[rule.need] < rule.onsetBelow) ailments.push(ailment as Ailment);
  }

  const animation: AnimationKey = !isAlive(state)
    ? state.diedAtTick !== null
      ? "dead"
      : "egg"
    : meditating
      ? "meditating"
      : state.asleep
        ? "sleeping"
        : state.sick
          ? "sick"
          : ailments.includes("STARVING")
            ? "hungry"
            : ailments.includes("FILTHY")
              ? "dirty"
              : ailments.includes("EXHAUSTED")
                ? "tired"
                : ailments.includes("SAD")
                  ? "bored"
                  : "idle";

  const anyCritical = NEED_KEYS.some((need) => state.needs[need] < CRITICAL_THRESHOLD);
  const alert: AlertLevel =
    state.healthRaw < HEALTH_CRITICAL || (state.sick && anyCritical) ? "CRITICAL" : anyCritical || state.sick ? "WARN" : "OK";
  // The same conditions under which project.ts lets health regenerate, and
  // sickness drains exactly what regen restores, so it stalls the climb.
  const terms = healthTerms(state, state.tick);
  const vigour = terms.elder?.vigour ?? 1000;
  const healing = !anyCritical && !state.sick && vigour === 1000;
  const fading = isOld(stage) && !meditating && state.healthRaw < FADING_THRESHOLD && vigour < 1000;
  const vitality: Vitality =
    state.healthRaw < HEALTH_CRITICAL ? (healing ? "recovering" : "frail") : fading ? "fading" : "well";

  const percentages = {
    hunger: Math.floor(state.needs.hunger / 10_000),
    energy: Math.floor(state.needs.energy / 10_000),
    hygiene: Math.floor(state.needs.hygiene / 10_000),
    joy: Math.floor(state.needs.joy / 10_000),
    health: Math.floor(state.healthRaw / (HEALTH_MAX / 100)),
  };

  return {
    stage,
    meditatingUntilTick: meditating ? sageStartTickOf(state) : null,
    deepMeditation: meditating && deepMeditationAt(state, state.tick),
    ailments,
    animation,
    alert,
    vitality,
    percentages,
    population: state.population ?? DIFFICULTY_BASELINE,
    careMultiplier: careMultiplier(presencePermilleOf(state), rulesVersionOf(state)),
    health: healthViewOf(state, terms),
  };
};
