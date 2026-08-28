// The single authority on whether an action is legal (SPEC §4.1). The server
// uses it to reject; the client uses it to grey out buttons with a reason.
// It operates on a state already projected to the current tick.
//
// An exhausted caretaker budget is deliberately NOT a rejection: the action
// validates and applies zero (SPEC §2.5) — the UI explains separately.

import { isAlive, type PetState, type ProjectionContext } from "./model";
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
  | "NOT_SLEEPY"; // LULLABY needs an awake pet that is running low on energy

export type ValidationResult =
  | { ok: true }
  | { ok: false; reason: RejectionReason; retryAtTick?: number; sinceTick?: number };

const reject = (reason: RejectionReason, window?: CooldownWindow): ValidationResult =>
  window === undefined
    ? { ok: false, reason }
    : { ok: false, reason, retryAtTick: window.readyAtTick, sinceTick: window.sinceTick };

/**
 * The one span an action is held for: from the tick that armed it to the tick
 * it frees up again.
 *
 * Both cooldowns run at once, so the binding one is whichever ends *last* —
 * reporting the global cooldown while a longer caretaker cooldown is still
 * running would tell the UI the action is nearly ready and then hold it for
 * minutes more (SPEC §11.2). Ties go to the global one: "the pet is busy"
 * reads better than "catch your breath" when both are true.
 */
export type CooldownWindow = { reason: RejectionReason; sinceTick: number; readyAtTick: number };

export const cooldownWindow = (
  state: PetState,
  action: CareAction,
  caretakerId: string,
): CooldownWindow | null => {
  const cooldown = COOLDOWNS[action];
  const lastGlobal = state.lastActionTick[action];
  const lastOwn = state.caretakers.find((entry) => entry.id === caretakerId)?.lastActionTick[action];
  const windows: CooldownWindow[] = [];
  if (lastGlobal !== undefined) {
    windows.push({ reason: "COOLDOWN_GLOBAL", sinceTick: lastGlobal, readyAtTick: lastGlobal + cooldown.global });
  }
  if (lastOwn !== undefined) {
    windows.push({ reason: "COOLDOWN_CARETAKER", sinceTick: lastOwn, readyAtTick: lastOwn + cooldown.caretaker });
  }
  let binding: CooldownWindow | null = null;
  for (const window of windows) {
    if (binding === null || window.readyAtTick > binding.readyAtTick) binding = window;
  }
  return binding;
};

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
    const window = cooldownWindow(state, action, caretakerId);
    if (window !== null && state.tick < window.readyAtTick) return reject(window.reason, window);
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
    case "LULLABY":
      // A pet that is already asleep cannot be put to sleep. Reading the gate
      // off energy alone got this backwards both ways: a napping pet recovers
      // past LULLABY_ENERGY_GATE on its way to NAP_WAKE_THRESHOLD, so the tile
      // said "wide awake" over a visibly sleeping pet — and below the gate it
      // said yes, where reduce() skips the sleep transition but still applies
      // the energy, spending a cooldown to hurry the nap toward waking.
      if (state.asleep) return reject("ASLEEP");
      // Night wants no clause of its own: projection puts the pet down at the
      // SLEEP boundary, so a state at night is an asleep state, caught above.
      return state.needs.energy < LULLABY_ENERGY_GATE ? { ok: true } : reject("NOT_SLEEPY");
    case "PET":
      return { ok: true };
  }
};
