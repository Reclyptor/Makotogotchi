// Why a care action is unavailable, in words a player reads (SPEC §11.3).
//
// The sim's RejectionReason is an enum meant for the server; it is not copy.
// This lives beside the action bar because that is where care is initiated,
// but the shop uses it too — using a snack from your pack is a FEED and gets
// rejected for the same reasons — and a second private copy of these strings
// is how "Makoto can't right now (ASLEEP)" ended up in front of a player.

import type { RejectionReason } from "@/sim/validate";

/** Every reason a care control can be locked, including the shop's own. */
export type LockReason = RejectionReason | "NO_ITEM";

/**
 * The reason, phrased for the player. Total over LockReason on purpose — a
 * missing entry should be a type error, not a silent "Not right now".
 */
export const rejectionText = (petName: string): Record<LockReason, string> => ({
  NOT_BORN: `${petName} hasn't hatched yet`,
  DEAD: `${petName} is gone`,
  ASLEEP: `${petName} is asleep`,
  TOO_TIRED: `${petName} is too tired to play`,
  NOT_SICK: `${petName} isn't sick`,
  NOT_SLEEPY: `${petName} isn't sleepy`,
  COOLDOWN_GLOBAL: `${petName} is busy`,
  COOLDOWN_CARETAKER: "Catch your breath",
  NO_ITEM: "None left",
});

/** Whether a `reason` off the wire is one we have copy for. */
export const isLockReason = (value: unknown): value is LockReason =>
  typeof value === "string" && value in rejectionText("");

/**
 * A glyph for the reason, so a locked control carries its state at a glance
 * and not only in the small print. Deliberately absent for the two cooldowns:
 * those already draw a drain bar and count seconds down, and a third signal
 * on the same tile is noise.
 */
export const REASON_GLYPH: Partial<Record<LockReason, string>> = {
  NOT_BORN: "🥚",
  DEAD: "🪦",
  ASLEEP: "💤",
  TOO_TIRED: "🪫",
  NOT_SICK: "💚",
  NOT_SLEEPY: "☀️",
  NO_ITEM: "📭",
};
