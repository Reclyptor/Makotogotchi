// A caretaker's own money and belongings, and the one place that says them out
// loud (SPEC §7.2, §13.1).
//
// Everything else on the events channel is public by nature — the pet, the
// room, who acted, who is watching — so the hub broadcasts it to every client
// and nobody minds. A purse is per caretaker. It rides the same channel
// because giving each caretaker a channel would cost one Redis subscription
// per connected caretaker, which is the exact thing stream/hub.ts exists to
// avoid; /api/stream drops the ones that are not its own before they reach the
// wire.
//
// The rule this module exists to enforce: the *mutation* announces, never its
// callers. Coins and pack contents are written in five places and read from
// nine or so; a publish bolted onto the call sites would go missing in one of
// them eventually, and a balance that has quietly stopped being live is
// indistinguishable from one that is.

import { key, redis } from "./redis/client";
import type { EngineMessage } from "./engine/messages";

/** What a caretaker has: what they can spend, and what they already bought. */
export type Purse = {
  coins: number;
  inventory: Partial<Record<string, number>>;
};

/**
 * A caretaker document's purse. Structural rather than typed against
 * CaretakerDoc so this module stays a leaf — social.ts imports it, not the
 * other way round.
 */
export const purseOf = (doc: { coins?: number; inventory?: Partial<Record<string, number>> } | null): Purse => ({
  coins: doc?.coins ?? 0,
  inventory: doc?.inventory ?? {},
});

/**
 * Tell the caretaker what they now have. Best effort by design: a publish that
 * fails must not roll back money that has already moved, and the next `hello`
 * or shop fetch corrects the display anyway.
 */
export const announcePurse = async (caretakerId: string, purse: Purse): Promise<void> => {
  const message: EngineMessage = { type: "purse", caretakerId, ...purse };
  try {
    await redis().publish(key("events"), JSON.stringify(message));
  } catch {
    // The balance is right in the database; only its echo was lost.
  }
};
