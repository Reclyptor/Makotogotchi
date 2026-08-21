// Contested caretaker titles (SPEC §24): one current holder per title, per
// generation, earned by HOW you play. Nothing here enters the fold — counts
// are incremental write-path stats like the leaderboard's, and the claim is
// the records-style compare-and-swap. The one thing records could not teach:
// the takeover message must name the loser, so the prior holder is read from
// the SAME atomic findOneAndUpdate that installs the winner — a separate
// read can name the wrong loser under two concurrent takeovers.

import type { Collection, Db } from "mongodb";
import { quirks } from "@/sim/quirks";
import type { CareAction } from "@/sim/tuning";
import type { Generation } from "@/sim/model";
import type { Milestone } from "@/sim/events";
import { isDuplicateKeyError } from "./db/collections";
import { anonymousName, nicknameMap } from "./social";
import { localHourAt } from "./schedule";
import type { TitleMessage } from "./engine/messages";

import { NIGHT_END_HOUR, type TitleId } from "@/sim/titles";

export { NIGHT_END_HOUR, TITLE_IDS, TITLES, type TitleId } from "@/sim/titles";

export type TitleStatsDoc = {
  generationId: string;
  caretakerId: string;
  counts: Partial<Record<TitleId, number>>;
};

export type TitleDoc = {
  generationId: string;
  titleId: TitleId;
  caretakerId: string;
  value: number;
  takenAt: Date;
};

export type TitleHolder = { titleId: TitleId; caretakerId: string; value: number };

export type TitleTakeover = {
  titleId: TitleId;
  caretakerId: string;
  previousId: string;
  value: number;
};

const titleStats = (db: Db): Collection<TitleStatsDoc> => db.collection("titleStats");
const titles = (db: Db): Collection<TitleDoc> => db.collection("titles");

let ensured = false;

export const ensureTitleIndexes = async (db: Db): Promise<void> => {
  if (ensured) return;
  await titleStats(db).createIndex({ generationId: 1, caretakerId: 1 }, { unique: true });
  // Unique: the CAS relies on it to reject a losing upsert (records pattern).
  await titles(db).createIndex({ generationId: 1, titleId: 1 }, { unique: true });
  ensured = true;
};

export const resetTitleIndexCache = (): void => {
  ensured = false;
};

/** What an accepted action means for the roster (SPEC §24.1). */
export const classifyTitles = (input: {
  action: CareAction;
  itemId?: string;
  seed: number;
  /** Pet-local hour of the action's tick (localHourAt). */
  localHour: number;
  /** The outcome carried SLEPT — the lullaby actually worked. */
  becameAsleep: boolean;
  /** The outcome carried WANT_FULFILLED. */
  wantFulfilled: boolean;
}): TitleId[] => {
  const earned: TitleId[] = [];
  // Any accepted care action counts at night: MEDICATE alone would make the
  // title a sickness lottery (SPEC §24.1).
  if (input.localHour < NIGHT_END_HOUR) earned.push("night-nurse");
  if (input.action === "FEED" && input.itemId !== undefined && input.itemId === quirks(input.seed).favoriteFood) {
    earned.push("chef");
  }
  if (input.action === "CLEAN") earned.push("groundskeeper");
  // A lullaby sung to an already-sleeping pet validates but applies nothing;
  // counting it would make the title farmable by no-ops (SPEC §24.1).
  if (input.action === "LULLABY" && input.becameAsleep) earned.push("sandman");
  if (input.action === "PET") earned.push("cuddler");
  if (input.wantFulfilled) earned.push("wish-granter");
  return earned;
};

/** $inc one stat and return the post-increment count. The retry settles the
 *  first-write upsert race, exactly as records' claim does. */
const bumpCount = async (db: Db, generationId: string, caretakerId: string, titleId: TitleId): Promise<number> => {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const doc = await titleStats(db).findOneAndUpdate(
        { generationId, caretakerId },
        { $inc: { [`counts.${titleId}`]: 1 } },
        { upsert: true, returnDocument: "after" },
      );
      const value = doc?.counts[titleId];
      if (value !== undefined) return value;
    } catch (error) {
      if (!isDuplicateKeyError(error)) throw error;
    }
  }
  throw new Error(`title stat increment failed twice for ${caretakerId}/${titleId}`);
};

/**
 * Take the title iff the count strictly exceeds the holder's — ties keep the
 * incumbent (SPEC §24.2). Returns the takeover when a DIFFERENT caretaker
 * held it before; a first claim and a self-raise both stay silent.
 */
const claimTitle = async (
  db: Db,
  generationId: string,
  titleId: TitleId,
  caretakerId: string,
  value: number,
): Promise<TitleTakeover | null> => {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const before = await titles(db).findOneAndUpdate(
        { generationId, titleId, value: { $lt: value } },
        { $set: { caretakerId, value, takenAt: new Date() } },
        { upsert: true, returnDocument: "before" },
      );
      if (before && before.caretakerId !== caretakerId) {
        return { titleId, caretakerId, previousId: before.caretakerId, value };
      }
      return null;
    } catch (error) {
      // A duplicate key is the CAS losing — the row already holds an
      // equal-or-better count — except on the board's very first claim,
      // where two racing upserts can both insert. One retry settles it.
      if (!isDuplicateKeyError(error)) throw error;
    }
  }
  return null;
};

/**
 * Roll one accepted action into the title race: bump every stat it advances,
 * offer each new count to the board, and report the takeovers. Called from
 * both write routes beside recordContribution (SPEC §24.3).
 */
export const settleTitles = async (
  db: Db,
  generationId: string,
  caretakerId: string,
  earned: readonly TitleId[],
): Promise<TitleTakeover[]> => {
  await ensureTitleIndexes(db);
  const takeovers: TitleTakeover[] = [];
  for (const titleId of earned) {
    const value = await bumpCount(db, generationId, caretakerId, titleId);
    const takeover = await claimTitle(db, generationId, titleId, caretakerId, value);
    if (takeover) takeovers.push(takeover);
  }
  return takeovers;
};

/** The generation's current holders, for presence, boards, and the seal. */
export const titleHolders = async (db: Db, generationId: string): Promise<TitleHolder[]> => {
  await ensureTitleIndexes(db);
  const docs = await titles(db).find({ generationId }).toArray();
  return docs.map((doc) => ({ titleId: doc.titleId, caretakerId: doc.caretakerId, value: doc.value }));
};

/** Current holders keyed by caretaker — the presence join (SPEC §24.4). */
export const holderChips = async (db: Db, generationId: string): Promise<Map<string, TitleId[]>> => {
  const chips = new Map<string, TitleId[]>();
  for (const holder of await titleHolders(db, generationId)) {
    chips.set(holder.caretakerId, [...(chips.get(holder.caretakerId) ?? []), holder.titleId]);
  }
  return chips;
};

/**
 * The one call both write routes make (SPEC §24.3): classify the accepted
 * action off the care outcome, roll the counts, and publish any takeover.
 */
export const rollTitles = async (
  db: Db,
  publish: (message: TitleMessage) => Promise<void>,
  input: {
    generation: Generation;
    caretakerId: string;
    action: CareAction;
    itemId?: string;
    tick: number;
    timeZone: string;
    milestones: readonly Milestone[];
  },
): Promise<void> => {
  const earned = classifyTitles({
    action: input.action,
    ...(input.itemId !== undefined ? { itemId: input.itemId } : {}),
    seed: input.generation.seed,
    localHour: localHourAt(input.generation.genesisEpochMs, input.tick, input.timeZone),
    becameAsleep: input.milestones.some((milestone) => milestone.kind === "SLEPT"),
    wantFulfilled: input.milestones.some((milestone) => milestone.kind === "WANT_FULFILLED"),
  });
  if (earned.length === 0) return;
  const takeovers = await settleTitles(db, input.generation.id, input.caretakerId, earned);
  for (const message of await takeoverMessages(db, takeovers)) {
    await publish(message);
  }
};

/** Resolve takeovers into ready-to-publish messages (SPEC §24.2). */
export const takeoverMessages = async (db: Db, takeovers: readonly TitleTakeover[]): Promise<TitleMessage[]> => {
  if (takeovers.length === 0) return [];
  const ids = [...new Set(takeovers.flatMap((takeover) => [takeover.caretakerId, takeover.previousId]))];
  const names = await nicknameMap(db, ids);
  const nameOf = (id: string): string => names.get(id) ?? anonymousName(id);
  return takeovers.map((takeover) => ({
    type: "title",
    titleId: takeover.titleId,
    caretakerId: takeover.caretakerId,
    caretakerName: nameOf(takeover.caretakerId),
    previousId: takeover.previousId,
    previousName: nameOf(takeover.previousId),
    value: takeover.value,
  }));
};
