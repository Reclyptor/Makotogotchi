// Everything presentational, computed from stored state and never stored
// (SPEC §4.3). The renderer receives an animation key from here; PetState has
// no field capable of holding one — the class of bug where animation frames
// leak into game state is structurally impossible.

import { isAlive, stageAt, type PetState } from "./model";
import {
  AILMENT_THRESHOLDS,
  CRITICAL_THRESHOLD,
  HEALTH_MAX,
  NEED_KEYS,
  type NeedKey,
} from "./tuning";

export type Ailment = "SICK" | "FILTHY" | "STARVING" | "EXHAUSTED" | "SAD";

export type AnimationKey = "egg" | "idle" | "sleeping" | "sick" | "dirty" | "hungry" | "tired" | "bored" | "dead";

export type AlertLevel = "OK" | "WARN" | "CRITICAL";

export type DerivedState = {
  stage: ReturnType<typeof stageAt>;
  ailments: Ailment[];
  animation: AnimationKey;
  alert: AlertLevel;
  /** Needs as display percentages, 0–100. */
  percentages: Record<NeedKey, number> & { health: number };
};

const HEALTH_CRITICAL = HEALTH_MAX / 4; // 25% — the strongest push trigger

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

  const percentages = {
    hunger: Math.floor(state.needs.hunger / 10_000),
    energy: Math.floor(state.needs.energy / 10_000),
    hygiene: Math.floor(state.needs.hygiene / 10_000),
    joy: Math.floor(state.needs.joy / 10_000),
    health: Math.floor(state.healthRaw / (HEALTH_MAX / 100)),
  };

  return { stage, ailments, animation, alert, percentages };
};
