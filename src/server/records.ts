// Per-game high scores (SPEC §21.3): the best plausible finish per game, kept
// twice — once for the week, once for all time. Both scopes live in one
// collection keyed by (gameId, scope, weekKey), where weekKey is "" for
// all-time and the pet's ISO week otherwise. The weekly board needs no reset
// job: a new week is a new key, and its query simply finds nothing yet.
//
// Claiming a record is a compare-and-swap, not a read-then-write: the `$lt`
// guard in the filter means two simultaneous finishes can never both win, and
// no lock is involved.

import type { Collection, Db } from "mongodb";
import { MINIGAMES, MINIGAME_IDS, type MinigameId } from "@/sim/minigames";
import { isDuplicateKeyError } from "./db/collections";
import { anonymousName, nicknameMap } from "./social";
import { once } from "./once";

export const RECORD_SCOPES = ["weekly", "alltime"] as const;
export type RecordScope = (typeof RECORD_SCOPES)[number];

export type RecordDoc = {
  gameId: MinigameId;
  scope: RecordScope;
  /** The pet's ISO week for `weekly`; "" for `alltime`. */
  weekKey: string;
  score: number;
  caretakerId: string;
  at: Date;
};

export const records = (db: Db): Collection<RecordDoc> => db.collection("records");

export const ensureRecordIndexes = once(async (db: Db): Promise<void> => {
  // Unique: the CAS relies on it to reject a losing upsert instead of
  // silently inserting a second row for the same board.
  await records(db).createIndex({ gameId: 1, scope: 1, weekKey: 1 }, { unique: true });
});

/**
 * True if this score took the board. A duplicate key means the row already
 * holds an equal-or-better score — the CAS losing, not a failure — except on
 * the very first finish of a board, where two racing upserts can both try to
 * insert. One retry settles that: the row exists by then, so the second pass
 * is a plain compare-and-swap.
 */
const claim = async (
  db: Db,
  scope: RecordScope,
  weekKey: string,
  input: { gameId: MinigameId; score: number; caretakerId: string },
): Promise<boolean> => {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const result = await records(db).updateOne(
        { gameId: input.gameId, scope, weekKey, score: { $lt: input.score } },
        { $set: { score: input.score, caretakerId: input.caretakerId, at: new Date() } },
        { upsert: true },
      );
      return result.modifiedCount === 1 || result.upsertedCount === 1;
    } catch (error) {
      if (!isDuplicateKeyError(error)) throw error;
    }
  }
  return false;
};

/** Offer a finish to both boards; returns the scopes it actually took. */
export const submitScore = async (
  db: Db,
  input: { gameId: MinigameId; score: number; caretakerId: string; weekKey: string },
): Promise<RecordScope[]> => {
  await ensureRecordIndexes(db);
  const taken: RecordScope[] = [];
  if (await claim(db, "alltime", "", input)) taken.push("alltime");
  if (await claim(db, "weekly", input.weekKey, input)) taken.push("weekly");
  return taken;
};

export type RecordHolder = { score: number; caretakerId: string; name: string };
export type GameRecords = {
  game: MinigameId;
  title: string;
  emoji: string;
  weekly: RecordHolder | null;
  alltime: RecordHolder | null;
};

/** Both boards for every game in the roster, with holder nicknames resolved. */
export const gameRecords = async (db: Db, weekKey: string): Promise<GameRecords[]> => {
  await ensureRecordIndexes(db);
  const docs = await records(db)
    .find({ $or: [{ scope: "alltime", weekKey: "" }, { scope: "weekly", weekKey }] })
    .toArray();
  const names = await nicknameMap(db, [...new Set(docs.map((doc) => doc.caretakerId))]);
  const holder = (game: MinigameId, scope: RecordScope): RecordHolder | null => {
    const doc = docs.find((candidate) => candidate.gameId === game && candidate.scope === scope);
    if (!doc) return null;
    return { score: doc.score, caretakerId: doc.caretakerId, name: names.get(doc.caretakerId) ?? anonymousName(doc.caretakerId) };
  };
  return MINIGAME_IDS.map((game) => ({
    game,
    title: MINIGAMES[game].title,
    emoji: MINIGAMES[game].emoji,
    weekly: holder(game, "weekly"),
    alltime: holder(game, "alltime"),
  }));
};
