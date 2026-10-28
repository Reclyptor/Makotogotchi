// The Sage's ascension payout (SPEC §2.8, §13.1): when an elder rises a Sage,
// everyone who carried it through the last stretch of its old age is paid.
//
// Like the daily quest, the payout is claimed before anyone is paid. The
// marker's _id is the generation, so a second leader — or the same leader
// after a restart — loses the insert and pays nobody twice. Losing the process
// between the claim and the payout costs those coins; paying first would cost
// them twice. It is a state observer rather than a milestone listener, so a
// leader that was down at the moment of ascension still pays on its return.

import type { Collection, Db } from "mongodb";
import { isAlive, meditationStartTickOf, stageOf, type Generation, type PetState } from "@/sim/model";
import { TICKS_PER_DAY } from "@/sim/tuning";
import { events, isDuplicateKeyError } from "./db/collections";
import { creditCoins } from "./social";

export const SAGE_ASCENSION_COINS = 300;
/** How far back before the meditation a caretaker's care counts toward the payout. */
export const SAGE_ASCENSION_WINDOW_TICKS = 14 * TICKS_PER_DAY;

export type AscensionDoc = {
  /** `ascension:${generationId}` — the claim is the primary key. */
  _id: string;
  generationId: string;
  caretakers: string[];
  paidAt: Date;
};

export const ascensionMarkers = (db: Db): Collection<AscensionDoc> => db.collection("ascensions");

/** Everyone who cared for the elder in the window before it sat down to meditate. */
export const ascensionCaretakers = async (db: Db, generationId: string, meditationStartTick: number): Promise<string[]> => {
  const docs = await events(db)
    .find({
      generationId,
      type: "CARE",
      tick: { $gte: meditationStartTick - SAGE_ASCENSION_WINDOW_TICKS, $lt: meditationStartTick },
    })
    .toArray();
  return [...new Set(docs.flatMap((doc) => (doc.type === "CARE" ? [doc.caretakerId] : [])))].sort();
};

/** The leader's check. Returns who was paid, or null if nothing was due or it was paid before. */
export const settleAscension = async (db: Db, generation: Generation, state: PetState): Promise<string[] | null> => {
  if (!isAlive(state) || stageOf(state, state.tick) !== "SAGE") return null;
  const meditationStart = meditationStartTickOf(state)!;
  const markers = ascensionMarkers(db);
  const id = `ascension:${generation.id}`;
  // The cheap read keeps every later tick of the Sage's life off the event log.
  if ((await markers.findOne({ _id: id })) !== null) return null;

  const paid = await ascensionCaretakers(db, generation.id, meditationStart);
  try {
    await markers.insertOne({ _id: id, generationId: generation.id, caretakers: paid, paidAt: new Date() });
  } catch (error) {
    if (isDuplicateKeyError(error)) return null; // another leader claimed it
    throw error;
  }
  for (const caretakerId of paid) {
    await creditCoins(db, caretakerId, SAGE_ASCENSION_COINS);
  }
  return paid;
};
