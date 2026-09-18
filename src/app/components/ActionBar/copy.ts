// Why a care action is unavailable, in words a player reads (SPEC §11.3).
//
// The sim's RejectionReason is an enum meant for the server; it is not copy.
// This lives beside the action bar because that is where care is initiated,
// but the shop uses it too — using a snack from your pack is a FEED and gets
// rejected for the same reasons — and a second private copy of these strings
// is how "Makoto can't right now (ASLEEP)" ended up in front of a player.

import type { RejectionReason } from "@/sim/validate";
import type { ZeroApplyReason } from "@/sim/score";
import type { CareAction } from "@/sim/tuning";

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

/**
 * The same reason with the pet's name taken out, for controls too narrow to
 * hold a sentence.
 *
 * A care tile is a sixth of a phone's width — an 85px box for this line, once
 * the grid and the padding have taken their share. "Makoto is asleep" wants
 * 82px of it, so it truncated to "Makoto is asl…" on anything narrower than a
 * 320px screen: every tile opening with the same three words and cutting off
 * before the one word that differed. Worse, the pet is community-named, so
 * that width was partly up to the players — "Bartholomew is asleep" wants
 * 107px and clips on any phone.
 *
 * Taking the name out is what fixes it rather than shortening the phrasing:
 * the label then has a fixed upper bound (see copy.test.ts) instead of a
 * user-controlled one. The name is redundant here anyway — it is the page's
 * heading, an inch up — and the full sentence still goes in the accessible
 * name (SPEC §11.3), so nothing is lost to a screen reader.
 */
export const REASON_SHORT: Record<LockReason, string> = {
  NOT_BORN: "Not hatched",
  DEAD: "Gone",
  ASLEEP: "Asleep",
  TOO_TIRED: "Too tired",
  NOT_SICK: "Not sick",
  NOT_SLEEPY: "Wide awake",
  COOLDOWN_GLOBAL: "Busy",
  COOLDOWN_CARETAKER: "Wait",
  NO_ITEM: "None left",
};

/** Whether a `reason` off the wire is one we have copy for. */
export const isLockReason = (value: unknown): value is LockReason =>
  typeof value === "string" && value in rejectionText("");

/**
 * A glyph for the reason, so a locked control carries its state at a glance
 * and not only in the small print. Deliberately absent for the two cooldowns:
 * those already draw a drain bar and count seconds down, and a third signal
 * on the same tile is noise.
 *
 * Each one borrows a symbol the game already uses for that idea rather than
 * inventing a private vocabulary: ❤️ is the Health meter's, 🪫 answers the
 * Energy meter's ⚡, ☀️ is daylight against 💤's night. A green heart was the
 * mistake worth recording — in a game about a pet that gets sick, green reads
 * as poison, which is the opposite of "isn't sick".
 */
export const REASON_GLYPH: Partial<Record<LockReason, string>> = {
  NOT_BORN: "🥚",
  DEAD: "🪦",
  ASLEEP: "💤",
  TOO_TIRED: "🪫",
  NOT_SICK: "❤️",
  NOT_SLEEPY: "☀️",
  NO_ITEM: "📭",
};

// ── Allowed, but it would restore nothing (SPEC §2.5, §2.6) ─────────────────

/**
 * An action can be perfectly legal and still apply zero, for two reasons that
 * could hardly be less alike: this caretaker's weekly allowance for the need
 * is spent, or the need is already full.
 *
 * One line used to cover both — "Makoto wants someone else's attention". It is
 * a fair description of the first and plainly false about the second, and the
 * players who met it most were the regulars, who read the false half as the
 * pet singling them out personally. A shared budget saying "not you, someone
 * else" is the one thing §2.4 promises the game will never mean.
 */
const SPENT_VERB: Record<CareAction, string> = {
  FEED: "fed",
  PLAY: "played with",
  CLEAN: "cleaned",
  LULLABY: "settled",
  PET: "fussed over",
  MEDICATE: "treated",
};

const SATED_STATE: Record<CareAction, string> = {
  FEED: "is full up",
  PLAY: "has had plenty of fun for now",
  CLEAN: "is already spotless",
  LULLABY: "is rested",
  PET: "has had plenty of fuss for now",
  MEDICATE: "is fine",
};

export const zeroApplyText = (petName: string, action: CareAction, reason: ZeroApplyReason): string =>
  reason === "SPENT"
    ? `You've ${SPENT_VERB[action]} ${petName} all you can this week — some of your allowance returns each night.`
    : `${petName} ${SATED_STATE[action]}.`;

/** The tile-sized form, under the same width bound as REASON_SHORT. */
export const ZERO_APPLY_SHORT: Record<ZeroApplyReason, string> = {
  SPENT: "Spent",
  SATED: "Not needed",
};

/** 🎟️ is the allowance; 👌 says the need is already met, not that you are. */
export const ZERO_APPLY_GLYPH: Record<ZeroApplyReason, string> = {
  SPENT: "🎟️",
  SATED: "👌",
};
