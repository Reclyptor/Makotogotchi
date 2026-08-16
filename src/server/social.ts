// Caretaker profiles and the social ledgers (SPEC §2.11, §8.5): nicknames,
// daily streaks, contribution scores, and the leaderboard queries. All of
// this is derived data living beside the sim — never inside PetState — and
// every write here happens after the event is already durable.

import type { Collection, Db } from "mongodb";
import { contributionScore, petDay } from "@/sim/score";
import { NICKNAME_PATTERN } from "@/sim/events";
import type { CareAction } from "@/sim/tuning";
import { isDuplicateKeyError } from "./db/collections";

export type CaretakerDoc = {
  _id: string;
  nickname: string | null;
  nicknameLower: string | null;
  nicknameChangedAt: Date | null;
  score: number;
  actionCounts: Partial<Record<CareAction, number>>;
  streakDays: number;
  lastActiveDay: number | null;
  generationsSurvived: number;
  coins: number;
  /** Consumable shop items owned, itemId → count (SPEC §13.2). */
  inventory: Partial<Record<string, number>>;
  createdAt: Date;
};

export type ContributionDoc = {
  caretakerId: string;
  generationId: string;
  day: number;
  score: number;
  actions: number;
};

export const caretakers = (db: Db): Collection<CaretakerDoc> => db.collection("caretakers");
export const contributions = (db: Db): Collection<ContributionDoc> => db.collection("contributions");

let ensured = false;
export const ensureSocialIndexes = async (db: Db): Promise<void> => {
  if (ensured) return;
  await Promise.all([
    // Partial, not sparse: sparse indexes still index explicit nulls, and
    // profiles are created with nickname: null.
    caretakers(db).createIndex(
      { nicknameLower: 1 },
      { unique: true, partialFilterExpression: { nicknameLower: { $type: "string" } } },
    ),
    caretakers(db).createIndex({ score: -1 }),
    contributions(db).createIndex({ caretakerId: 1, generationId: 1, day: 1 }, { unique: true }),
    contributions(db).createIndex({ generationId: 1 }),
    contributions(db).createIndex({ day: 1 }),
  ]);
  ensured = true;
};

export const resetSocialIndexCache = (): void => {
  ensured = false;
};

// A tiny screen, not a moderation system: this is a toy for friends. Extend
// the list before extending the audience.
const NICKNAME_BLOCKLIST = ["admin", "makoto", "system", "server", "moderator"];

export type NicknameResult =
  | { ok: true; nickname: string }
  | { ok: false; reason: "INVALID" | "TAKEN" | "BLOCKED" | "TOO_SOON" };

const NICKNAME_CHANGE_INTERVAL_MS = 24 * 60 * 60 * 1000;

export const setNickname = async (db: Db, caretakerId: string, raw: string): Promise<NicknameResult> => {
  await ensureSocialIndexes(db);
  const nickname = raw.normalize("NFKC").trim();
  if (!NICKNAME_PATTERN.test(nickname)) return { ok: false, reason: "INVALID" };
  const lower = nickname.toLowerCase();
  if (NICKNAME_BLOCKLIST.includes(lower)) return { ok: false, reason: "BLOCKED" };

  const existing = await caretakers(db).findOne({ _id: caretakerId });
  if (existing?.nicknameChangedAt && Date.now() - existing.nicknameChangedAt.getTime() < NICKNAME_CHANGE_INTERVAL_MS) {
    return { ok: false, reason: "TOO_SOON" };
  }

  try {
    await caretakers(db).updateOne(
      { _id: caretakerId },
      {
        $set: { nickname, nicknameLower: lower, nicknameChangedAt: new Date() },
        $setOnInsert: emptyProfileFields(),
      },
      { upsert: true },
    );
  } catch (error) {
    if (isDuplicateKeyError(error)) return { ok: false, reason: "TAKEN" };
    throw error;
  }
  return { ok: true, nickname };
};

const emptyProfileFields = (): Omit<CaretakerDoc, "_id" | "nickname" | "nicknameLower" | "nicknameChangedAt"> => ({
  score: 0,
  actionCounts: {},
  streakDays: 0,
  lastActiveDay: null,
  generationsSurvived: 0,
  coins: 0,
  inventory: {},
  createdAt: new Date(),
});

/**
 * Roll one performed care action into the ledgers: total score, per-action
 * counts, the daily streak (consecutive pet-days with at least one action),
 * and the per-generation-per-day contribution row the leaderboards read.
 * Returns the coins earned (SPEC §13.1: proportional to how needed it was).
 */
export const recordContribution = async (
  db: Db,
  input: { caretakerId: string; generationId: string; action: CareAction; applied: number; tick: number },
): Promise<{ score: number; coins: number; streakDays: number }> => {
  await ensureSocialIndexes(db);
  const score = contributionScore(input.action, input.applied);
  const coins = Math.max(1, Math.floor(score / 10));
  const day = petDay(input.tick);

  const existing = await caretakers(db).findOne({ _id: input.caretakerId });
  const streakDays =
    existing?.lastActiveDay === day
      ? existing.streakDays
      : existing?.lastActiveDay === day - 1
        ? existing.streakDays + 1
        : 1;

  await caretakers(db).updateOne(
    { _id: input.caretakerId },
    {
      $set: { streakDays, lastActiveDay: day },
      $inc: { score, coins, [`actionCounts.${input.action}`]: 1 },
      $setOnInsert: { nickname: null, nicknameLower: null, nicknameChangedAt: null, generationsSurvived: 0, inventory: {}, createdAt: new Date() },
    },
    { upsert: true },
  );
  await contributions(db).updateOne(
    { caretakerId: input.caretakerId, generationId: input.generationId, day },
    { $inc: { score, actions: 1 } },
    { upsert: true },
  );
  return { score, coins, streakDays };
};

export type LeaderboardWindow = "today" | "week" | "all" | "generation";

export type LeaderboardRow = {
  caretakerId: string;
  name: string;
  score: number;
};

export const leaderboard = async (
  db: Db,
  window: LeaderboardWindow,
  context: { generationId: string; nowTick: number },
  limit = 20,
): Promise<LeaderboardRow[]> => {
  await ensureSocialIndexes(db);
  let rows: { caretakerId: string; score: number }[];

  if (window === "all") {
    const docs = await caretakers(db).find({ score: { $gt: 0 } }).sort({ score: -1 }).limit(limit).toArray();
    rows = docs.map((doc) => ({ caretakerId: doc._id, score: doc.score }));
  } else {
    const today = petDay(context.nowTick);
    const match =
      window === "generation"
        ? { generationId: context.generationId }
        : window === "today"
          ? { day: today }
          : { day: { $gte: today - 6 } };
    rows = await contributions(db)
      .aggregate<{ _id: string; score: number }>([
        { $match: match },
        { $group: { _id: "$caretakerId", score: { $sum: "$score" } } },
        { $sort: { score: -1 } },
        { $limit: limit },
      ])
      .toArray()
      .then((docs) => docs.map((doc) => ({ caretakerId: doc._id, score: doc.score })));
  }

  const names = await nicknameMap(db, rows.map((row) => row.caretakerId));
  return rows.map((row) => ({ ...row, name: names.get(row.caretakerId) ?? anonymousName(row.caretakerId) }));
};

export const anonymousName = (caretakerId: string): string => `Friend ${caretakerId.slice(0, 4)}`;

export const nicknameMap = async (db: Db, ids: string[]): Promise<Map<string, string>> => {
  if (ids.length === 0) return new Map();
  const docs = await caretakers(db)
    .find({ _id: { $in: ids }, nickname: { $ne: null } })
    .project<{ _id: string; nickname: string }>({ nickname: 1 })
    .toArray();
  return new Map(docs.map((doc) => [doc._id, doc.nickname]));
};

export const caretakerProfile = async (db: Db, caretakerId: string): Promise<CaretakerDoc | null> =>
  caretakers(db).findOne({ _id: caretakerId });

/** Bonus coins outside the per-action formula (minigame score, SPEC §13.1). */
export const creditCoins = async (db: Db, caretakerId: string, amount: number): Promise<void> => {
  if (amount > 0) await caretakers(db).updateOne({ _id: caretakerId }, { $inc: { coins: amount } });
};

/** Everyone who contributed to a generation gets survival tenure (SPEC §2.10). */
export const incrementGenerationsSurvived = async (db: Db, generationId: string): Promise<void> => {
  const ids = await contributions(db).distinct("caretakerId", { generationId });
  if (ids.length > 0) {
    await caretakers(db).updateMany({ _id: { $in: ids } }, { $inc: { generationsSurvived: 1 } });
  }
};

/** The ranked caretakers of a generation, for its memorial (SPEC §2.10). */
export const generationRanking = async (db: Db, generationId: string, limit = 10): Promise<LeaderboardRow[]> => {
  const rows = await contributions(db)
    .aggregate<{ _id: string; score: number }>([
      { $match: { generationId } },
      { $group: { _id: "$caretakerId", score: { $sum: "$score" } } },
      { $sort: { score: -1 } },
      { $limit: limit },
    ])
    .toArray();
  const names = await nicknameMap(db, rows.map((row) => row._id));
  return rows.map((row) => ({ caretakerId: row._id, score: row.score, name: names.get(row._id) ?? anonymousName(row._id) }));
};
