// The single authority on whether an action is legal (SPEC §4.1). The server
// uses it to reject; the client uses it to grey out buttons with a reason.
// It operates on a state already projected to the current tick.
//
// An exhausted caretaker budget is deliberately NOT a rejection: the action
// validates and applies zero (SPEC §2.5) — the UI explains separately.

import { isAlive, phaseAt, type PetState, type ProjectionContext } from "./model";
import { medicineItem } from "./economy";
import { COOLDOWNS, LULLABY_ENERGY_GATE, PLAY_ENERGY_GATE, type CareAction } from "./tuning";

export type RejectionReason =
  | "NOT_BORN" // still an egg
  | "DEAD"
  | "COOLDOWN_GLOBAL" // the pet is busy — a property of the pet, not the player
  | "COOLDOWN_CARETAKER"
  | "ASLEEP"
  | "TOO_TIRED" // PLAY needs energy
  | "NOT_SICK" // MEDICATE without illness
  | "NOT_SLEEPY"; // LULLABY needs night or low energy

export type ValidationResult = { ok: true } | { ok: false; reason: RejectionReason; retryAtTick?: number };

const reject = (reason: RejectionReason, retryAtTick?: number): ValidationResult =>
  retryAtTick === undefined ? { ok: false, reason } : { ok: false, reason, retryAtTick };

export const canPerform = (
  state: PetState,
  action: CareAction,
  caretakerId: string,
  ctx: ProjectionContext,
  itemId?: string,
): ValidationResult => {
  if (state.bornAtTick === null) return reject("NOT_BORN");
  if (!isAlive(state)) return reject("DEAD");

  // Emergency medicine cures instantly — cooldowns are bypassed (SPEC §13.2).
  const bypassCooldowns = action === "MEDICATE" && medicineItem(itemId) !== null;
  if (!bypassCooldowns) {
    const cooldown = COOLDOWNS[action];
    const lastGlobal = state.lastActionTick[action];
    if (lastGlobal !== undefined && state.tick - lastGlobal < cooldown.global) {
      return reject("COOLDOWN_GLOBAL", lastGlobal + cooldown.global);
    }
    const record = state.caretakers.find((entry) => entry.id === caretakerId);
    const lastOwn = record?.lastActionTick[action];
    if (lastOwn !== undefined && state.tick - lastOwn < cooldown.caretaker) {
      return reject("COOLDOWN_CARETAKER", lastOwn + cooldown.caretaker);
    }
  }

  switch (action) {
    case "FEED":
    case "CLEAN":
      return state.asleep ? reject("ASLEEP") : { ok: true };
    case "PLAY":
      if (state.asleep) return reject("ASLEEP");
      return state.needs.energy > PLAY_ENERGY_GATE ? { ok: true } : reject("TOO_TIRED");
    case "MEDICATE":
      return state.sick ? { ok: true } : reject("NOT_SICK");
    case "LULLABY": {
      const night = phaseAt(ctx.schedule, state.tick) === "SLEEP";
      return night || state.needs.energy < LULLABY_ENERGY_GATE ? { ok: true } : reject("NOT_SLEEPY");
    }
    case "PET":
      return { ok: true };
  }
};
