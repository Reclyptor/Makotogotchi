// Collection accessors and index management (SPEC §6.1). Every index the
// queries rely on is declared here and ensured once per process — schema and
// access patterns live together or they drift apart.

import type { Collection, Db } from "mongodb";
import type { CauseOfDeath, PetState } from "@/sim/model";
import type { PetEvent } from "@/sim/events";
import type { Quirks } from "@/sim/quirks";

export type GenerationDoc = {
  _id: string;
  ordinal: number;
  seed: number;
  genesisEpochMs: number;
  name: string | null;
  hatchedAtTick: number | null;
  died: { tick: number; at: Date; cause: CauseOfDeath } | null;
  /** Written once at seal time — the permanent record the memorial reads. */
  memorial: {
    sealedAt: Date;
    ranking: { caretakerId: string; name: string; score: number }[];
    /**
     * The generation's personality, frozen at death (SPEC §21.4). Derivable
     * from the seed today, but the memorial is a historical record: it must
     * still say what was true even if the quirk tables are ever retuned.
     * Absent on generations sealed before quirks existed.
     */
    quirks?: Quirks;
  } | null;
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

/** Mongo's unique-index violation — what every upsert race lands on. */
export const isDuplicateKeyError = (error: unknown): boolean =>
  typeof error === "object" && error !== null && (error as { code?: number }).code === 11000;

export const generations = (database: Db): Collection<GenerationDoc> => database.collection("generations");
export const events = (database: Db): Collection<EventDoc> => database.collection("events");
export const snapshots = (database: Db): Collection<SnapshotDoc> => database.collection("snapshots");

let ensured = false;

export const ensureIndexes = async (database: Db): Promise<void> => {
  if (ensured) return;
  await Promise.all([
    // Unique: the lifecycle's rotation guard — two leaders racing a rebirth
    // collapse into one successor generation.
    generations(database).createIndex({ ordinal: -1 }, { unique: true }),
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
