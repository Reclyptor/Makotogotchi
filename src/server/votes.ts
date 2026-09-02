// The naming vote (SPEC §2.10): while the egg incubates, anyone may propose
// a name or move their one vote onto a proposal. The winner at resolution is
// most votes, ties broken toward the earliest proposal; with zero proposals
// the egg simply waits.

import type { Collection, Db } from "mongodb";
import { NICKNAME_PATTERN } from "@/sim/events";
import { once } from "./once";

export type NameVoteDoc = {
  generationId: string;
  name: string;
  nameLower: string;
  proposerId: string;
  proposedAt: Date;
  voters: string[];
};

export const nameVotes = (db: Db): Collection<NameVoteDoc> => db.collection("nameVotes");

export const ensureVoteIndexes = once(async (db: Db): Promise<void> => {
  await nameVotes(db).createIndex({ generationId: 1, nameLower: 1 }, { unique: true });
});

export const resetVoteIndexCache = (): void => ensureVoteIndexes.reset();

export type ProposeResult = { ok: true } | { ok: false; reason: "INVALID" | "EXISTS" };

export const proposeName = async (db: Db, generationId: string, caretakerId: string, raw: string): Promise<ProposeResult> => {
  await ensureVoteIndexes(db);
  const name = raw.normalize("NFKC").trim();
  if (!NICKNAME_PATTERN.test(name)) return { ok: false, reason: "INVALID" };
  try {
    await castVote(
      db,
      generationId,
      caretakerId,
      name.toLowerCase(),
      { $setOnInsert: { generationId, name, nameLower: name.toLowerCase(), proposerId: caretakerId, proposedAt: new Date() } },
      true,
    );
  } catch (error) {
    if (typeof error === "object" && error !== null && (error as { code?: number }).code === 11000) {
      return { ok: false, reason: "EXISTS" };
    }
    throw error;
  }
  return { ok: true };
};

export type VoteResult = { ok: true } | { ok: false; reason: "NOT_FOUND" };

export const voteForName = async (db: Db, generationId: string, caretakerId: string, nameLower: string): Promise<VoteResult> => {
  await ensureVoteIndexes(db);
  const exists = await nameVotes(db).findOne({ generationId, nameLower });
  if (!exists) return { ok: false, reason: "NOT_FOUND" };
  await castVote(db, generationId, caretakerId, nameLower, {}, false);
  return { ok: true };
};

/** One vote per caretaker: pull them off every proposal, add to the target. */
const castVote = async (
  db: Db,
  generationId: string,
  caretakerId: string,
  nameLower: string,
  extra: object,
  upsert: boolean,
): Promise<void> => {
  await nameVotes(db).updateMany({ generationId }, { $pull: { voters: caretakerId } });
  await nameVotes(db).updateOne({ generationId, nameLower }, { $addToSet: { voters: caretakerId }, ...extra }, { upsert });
};

export type VoteTally = { name: string; votes: number; mine: boolean }[];

export const tallyVotes = async (db: Db, generationId: string, caretakerId: string): Promise<VoteTally> => {
  await ensureVoteIndexes(db);
  const docs = await nameVotes(db).find({ generationId }).sort({ proposedAt: 1 }).toArray();
  return docs
    .map((doc) => ({ name: doc.name, votes: doc.voters.length, mine: doc.voters.includes(caretakerId) }))
    .sort((a, b) => b.votes - a.votes);
};

/** The winner, or null if nothing was proposed. Ties go to the earliest. */
export const resolveWinner = async (db: Db, generationId: string): Promise<string | null> => {
  await ensureVoteIndexes(db);
  const docs = await nameVotes(db).find({ generationId }).sort({ proposedAt: 1 }).toArray();
  if (docs.length === 0) return null;
  let winner = docs[0]!;
  for (const doc of docs) {
    if (doc.voters.length > winner.voters.length) winner = doc;
  }
  return winner.name;
};
