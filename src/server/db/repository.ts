// The persistence operations the engine needs (SPEC §6.1). The events
// collection is append-only: nothing here updates or deletes an event, ever.

import type { Db } from "mongodb";
import type { Generation, PetState } from "@/sim/model";
import type { PetEvent } from "@/sim/events";
import { ensureIndexes, events, generations, snapshots, type EventDoc, type EventExtras, type GenerationDoc } from "./collections";

export const createGeneration = async (database: Db, generation: Generation): Promise<void> => {
  await ensureIndexes(database);
  await generations(database).insertOne({
    _id: generation.id,
    ordinal: generation.ordinal,
    seed: generation.seed,
    genesisEpochMs: generation.genesisEpochMs,
    name: generation.name,
    hatchedAtTick: null,
    died: null,
    memorial: null,
  });
};

export const latestGeneration = async (database: Db): Promise<GenerationDoc | null> => {
  await ensureIndexes(database);
  return generations(database).findOne({}, { sort: { ordinal: -1 } });
};

export const recordHatch = async (database: Db, generationId: string, tick: number, name: string): Promise<void> => {
  await generations(database).updateOne({ _id: generationId }, { $set: { hatchedAtTick: tick, name } });
};

export const recordDeath = async (database: Db, state: PetState): Promise<void> => {
  if (state.diedAtTick === null || state.causeOfDeath === null) {
    throw new Error("recordDeath called for a living pet");
  }
  await generations(database).updateOne(
    { _id: state.generation.id },
    { $set: { died: { tick: state.diedAtTick, at: new Date(), cause: state.causeOfDeath } } },
  );
};

/**
 * Append a run of events in one round trip. The caller holds the write lock
 * and supplies the seqs it computed from in-order state; the unique index
 * turns any serialization failure into a loud duplicate-key error instead of
 * a corrupted fold order.
 *
 * `ordered` is the point, not a default worth inheriting silently: these
 * events are one advance, their seqs are consecutive, and a failure part-way
 * must stop rather than carry on inserting past the gap. That is what makes
 * this equivalent to the loop of single inserts it replaces — a loop that ran
 * inside the fleet-wide write lock and paid a round trip per milestone.
 *
 * They share one `at` for the same reason they share a seq run: they happened
 * in one advance, and `at` is a display field rather than an ordering one.
 */
export const appendEvents = async (
  database: Db,
  entries: readonly { event: PetEvent; extras?: EventExtras }[],
): Promise<void> => {
  if (entries.length === 0) return;
  await ensureIndexes(database);
  const at = new Date();
  const docs: EventDoc[] = entries.map(({ event, extras }) => ({ ...event, ...extras, at }));
  await events(database).insertMany(docs, { ordered: true });
};

/** Append a single event — the same path, for callers that only ever have one. */
export const appendEvent = async (database: Db, event: PetEvent, extras: EventExtras = {}): Promise<void> => {
  await appendEvents(database, [{ event, extras }]);
};

export const eventsSince = async (database: Db, generationId: string, afterSeq: number): Promise<PetEvent[]> => {
  await ensureIndexes(database);
  const docs = await events(database)
    .find({ generationId, seq: { $gt: afterSeq } })
    .sort({ seq: 1 })
    .toArray();
  return docs.map(({ _id, at, applied, minigameScore, ...event }) => event as PetEvent);
};

export const lastSeq = async (database: Db, generationId: string): Promise<number> => {
  await ensureIndexes(database);
  const last = await events(database).findOne({ generationId }, { sort: { seq: -1 }, projection: { seq: 1 } });
  return last?.seq ?? -1;
};

export const writeSnapshot = async (database: Db, state: PetState, lastEventSeq: number): Promise<void> => {
  await ensureIndexes(database);
  await snapshots(database).insertOne({
    generationId: state.generation.id,
    tick: state.tick,
    state,
    lastEventSeq,
    at: new Date(),
  });
};

export const latestSnapshot = async (
  database: Db,
  generationId: string,
): Promise<{ state: PetState; lastEventSeq: number } | null> => {
  await ensureIndexes(database);
  const doc = await snapshots(database).findOne({ generationId }, { sort: { tick: -1 } });
  if (!doc) return null;
  return { state: doc.state, lastEventSeq: doc.lastEventSeq };
};
