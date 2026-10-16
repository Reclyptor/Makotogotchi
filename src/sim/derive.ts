// Everything presentational, computed from stored state and never stored
// (SPEC §4.3). The renderer receives an animation key from here; PetState has
// no field capable of holding one — the class of bug where animation frames
// leak into game state is structurally impossible.

import { careMultiplier, DIFFICULTY_BASELINE, presencePermilleOf } from "./difficulty";
import { healthTerms, type HealthTerms } from "./health";
import { isAlive, stageAt, type PetState } from "./model";
import {
  AILMENT_THRESHOLDS,
  CRITICAL_THRESHOLD,
  FADING_THRESHOLD,
  HEALTH_MAX,
  NEED_KEYS,
  type NeedKey,
} from "./tuning";

export type Ailment = "SICK" | "FILTHY" | "STARVING" | "EXHAUSTED" | "SAD";

export type AnimationKey = "egg" | "idle" | "sleeping" | "sick" | "dirty" | "hungry" | "tired" | "bored" | "dead";

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
  /** The dominant term; ties go need, then sickness, then age. */
  reason: HealthReason;
  /** An elder's hold line and the needs' mean today, whole percentages 0–100. */
  elder: { linePercent: number; meanPercent: number } | null;
};

export type DerivedState = {
  stage: ReturnType<typeof stageAt>;
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

const healthViewOf = (state: PetState, terms: HealthTerms): HealthView => {
  const elder = terms.elder
    ? { linePercent: Math.floor(terms.elder.holdPermille / 10), meanPercent: Math.floor(terms.elder.meanPermille / 10) }
    : null;
  if (!isAlive(state)) return { trend: "steady", reason: { kind: "holding" }, elder };

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
  const reason: HealthReason =
    terms.worstNeed !== null && terms.drainNeeds >= terms.drainSick && terms.drainNeeds >= terms.drainAge
      ? { kind: "need", need: terms.worstNeed }
      : terms.drainSick >= terms.drainAge
        ? { kind: "sick" }
        : { kind: "age" };
  return { trend: "falling", reason, elder };
};

export const derive = (state: PetState): DerivedState => {
  const stage = stageAt(state.bornAtTick, state.tick);

  const ailments: Ailment[] = [];
  if (state.sick) ailments.push("SICK");
  for (const [ailment, rule] of Object.entries(AILMENT_THRESHOLDS)) {
    if (state.needs[rule.need] < rule.onsetBelow) ailments.push(ailment as Ailment);
  }

  const animation: AnimationKey = !isAlive(state)
    ? state.diedAtTick !== null
      ? "dead"
      : "egg"
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
  const fading = stage === "ELDER" && state.healthRaw < FADING_THRESHOLD && vigour < 1000;
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
    ailments,
    animation,
    alert,
    vitality,
    percentages,
    population: state.population ?? DIFFICULTY_BASELINE,
    careMultiplier: careMultiplier(presencePermilleOf(state)),
    health: healthViewOf(state, terms),
  };
};
