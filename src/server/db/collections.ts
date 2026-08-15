// Collection accessors and index management (SPEC §6.1). Every index the
// queries rely on is declared here and ensured once per process — schema and
// access patterns live together or they drift apart.

import type { Collection, Db } from "mongodb";
import type { CauseOfDeath, PetState } from "@/sim/model";
import type { PetEvent } from "@/sim/events";

export type GenerationDoc = {
  _id: string;
  ordinal: number;
  seed: number;
  genesisEpochMs: number;
  name: string | null;
  hatchedAtTick: number | null;
  died: { tick: number; at: Date; cause: CauseOfDeath } | null;
};

/** PetEvent plus denormalized display fields (SPEC §6.1) and a wall clock. */
export type EventDoc = PetEvent & {
  applied?: number;
  at: Date;
};

export type SnapshotDoc = {
  generationId: string;
  tick: number;
  state: PetState;
  /** Seq of the last event folded into this snapshot; recovery folds after it. */
  lastEventSeq: number;
  at: Date;
};

export const generations = (database: Db): Collection<GenerationDoc> => database.collection("generations");
export const events = (database: Db): Collection<EventDoc> => database.collection("events");
export const snapshots = (database: Db): Collection<SnapshotDoc> => database.collection("snapshots");

let ensured = false;

export const ensureIndexes = async (database: Db): Promise<void> => {
  if (ensured) return;
  await Promise.all([
    generations(database).createIndex({ ordinal: -1 }),
    // seq is the canonical fold order and MUST be unique per generation —
    // this index is the last line of defense if the write lock ever fails.
    events(database).createIndex({ generationId: 1, seq: 1 }, { unique: true }),
    events(database).createIndex({ at: -1 }),
    events(database).createIndex({ caretakerId: 1, at: -1 }),
    snapshots(database).createIndex({ generationId: 1, tick: -1 }),
  ]);
  ensured = true;
};

/** Test seam. */
export const resetIndexCache = (): void => {
  ensured = false;
};
