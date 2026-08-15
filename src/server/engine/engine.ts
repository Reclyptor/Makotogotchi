// The engine: the single write path for pet state (SPEC §3.3–3.4).
//
// Everything that advances state — a care action, the tick loop, a hatch —
// funnels through advance(), which runs under the cross-process write lock:
//
//   load authoritative state → project to now → record crossed milestones
//   → apply the input event, if any → append all to Mongo with sequential seq
//   → publish → snapshot
//
// Seq order must be foldable: projection milestones carry ticks ≤ now, so
// they are sequenced BEFORE the input event (whose tick is now). Milestones
// are recorded by whichever caller advances the state first; because every
// advance is serialized and folds from the shared hot state, each milestone
// is recorded exactly once.
//
// The tick loop is just advance-with-no-input on a timer, gated by the
// leader lease. Losing leadership mid-flight is harmless: projection is
// keyed to absolute time, so the next leader reproduces the identical state.

import type { Db } from "mongodb";
import type Redis from "ioredis";
import { genesis } from "@/sim/genesis";
import { project } from "@/sim/project";
import { reduce } from "@/sim/reduce";
import { canPerform, type ValidationResult } from "@/sim/validate";
import type { Generation, PetState, ProjectionContext } from "@/sim/model";
import { TICKS_PER_DAY, TICK_SECONDS, type CareAction } from "@/sim/tuning";
import type { Milestone, PetEvent } from "@/sim/events";
import {
  appendEvent,
  createGeneration,
  eventsSince,
  latestGeneration,
  latestSnapshot,
  recordDeath,
  recordHatch,
  writeSnapshot,
} from "../db/repository";
import { withLock } from "../redis/lock";
import { scheduleFor } from "../schedule";
import type { EngineMessage } from "./messages";

const SNAPSHOT_INTERVAL_TICKS = 30; // 5 minutes
const SCHEDULE_MARGIN_TICKS = 2 * TICKS_PER_DAY;

export type EngineDeps = {
  db: Db;
  redis: Redis;
  key: (name: string) => string;
  timeZone: string;
  now?: () => number; // test seam; defaults to Date.now
  /** Resolves a caretaker's display name for published care messages. */
  caretakerName?: (caretakerId: string) => Promise<string>;
};

export type CareOutcome =
  | { ok: true; applied: number; state: PetState }
  | { ok: false; rejection: Exclude<ValidationResult, { ok: true }> };

type HotState = { state: PetState; lastEventSeq: number };

/** What the caller wants applied once the lock is held and state is current. */
type Prepared =
  | { kind: "event"; event: (nextSeq: number, state: PetState) => PetEvent }
  | { kind: "reject"; rejection: Exclude<ValidationResult, { ok: true }> }
  | { kind: "skip" };

type AdvanceResult = { state: PetState; applied: number; rejected: Exclude<ValidationResult, { ok: true }> | null };

export class PetEngine {
  private readonly now: () => number;

  constructor(private readonly deps: EngineDeps) {
    this.now = deps.now ?? Date.now;
  }

  private ctxFor(generation: Generation, fromTick: number, toTick: number): ProjectionContext {
    return {
      schedule: scheduleFor(generation.genesisEpochMs, fromTick, toTick + SCHEDULE_MARGIN_TICKS, this.deps.timeZone),
    };
  }

  private currentTick(generation: Generation): number {
    return Math.floor((this.now() - generation.genesisEpochMs) / (TICK_SECONDS * 1000));
  }

  /** The active generation, creating generation 1 on a virgin database. */
  async ensureGeneration(): Promise<Generation> {
    const existing = await latestGeneration(this.deps.db);
    if (existing) {
      return {
        id: existing._id,
        ordinal: existing.ordinal,
        seed: existing.seed,
        genesisEpochMs: existing.genesisEpochMs,
        name: existing.name,
      };
    }
    const generation: Generation = {
      id: `gen-${crypto.randomUUID()}`,
      ordinal: 1,
      seed: crypto.getRandomValues(new Uint32Array(1))[0]!,
      genesisEpochMs: this.now(),
      name: null,
    };
    await createGeneration(this.deps.db, generation);
    return generation;
  }

  /** Authoritative state: Redis hot key, else Mongo snapshot + event fold. */
  private async loadHot(generation: Generation): Promise<HotState> {
    const cached = await this.deps.redis.get(this.deps.key("state"));
    if (cached) {
      const parsed = JSON.parse(cached) as HotState;
      if (parsed.state.generation.id === generation.id) return parsed;
    }
    return this.recover(generation);
  }

  /** Rebuild from durable truth (SPEC §6.1): flushing Redis costs a cold cache. */
  async recover(generation: Generation): Promise<HotState> {
    const snapshot = await latestSnapshot(this.deps.db, generation.id);
    let state = snapshot?.state ?? genesis(generation);
    let seq = snapshot?.lastEventSeq ?? -1;
    const pending = await eventsSince(this.deps.db, generation.id, seq);
    for (const event of pending) {
      const ctx = this.ctxFor(generation, state.tick, event.tick);
      state = reduce(state, event, ctx).state;
      seq = event.seq;
    }
    return { state, lastEventSeq: seq };
  }

  private async publish(message: EngineMessage): Promise<void> {
    await this.deps.redis.publish(this.deps.key("events"), JSON.stringify(message));
  }

  /** The serialized write path. */
  private async advance(generation: Generation, prepare: (state: PetState, ctx: ProjectionContext) => Prepared): Promise<AdvanceResult> {
    return withLock(this.deps.redis, this.deps.key("write"), async () => {
      const hot = await this.loadHot(generation);
      const nowTick = Math.max(this.currentTick(generation), hot.state.tick);
      const ctx = this.ctxFor(generation, hot.state.tick, nowTick);

      const projected = project(hot.state, nowTick, ctx);
      let state = projected.state;
      let seq = hot.lastEventSeq;
      const toAppend: { event: PetEvent; applied?: number }[] = [];
      const toPublish: EngineMessage[] = [];

      // Projection milestones first — their ticks precede any input event's.
      const recordMilestone = (milestone: Milestone): void => {
        seq += 1;
        toAppend.push({
          event: {
            type: "MILESTONE",
            generationId: generation.id,
            seq,
            tick: milestone.tick,
            kind: milestone.kind,
            ...(milestone.detail !== undefined ? { detail: milestone.detail } : {}),
          },
        });
      };
      projected.milestones.forEach(recordMilestone);

      const prepared = prepare(state, ctx);
      let applied = 0;
      let inputEvent: PetEvent | null = null;
      if (prepared.kind === "reject") {
        return { state, applied: 0, rejected: prepared.rejection };
      }
      if (prepared.kind === "event") {
        seq += 1;
        inputEvent = prepared.event(seq, state);
        const reduced = reduce(state, inputEvent, ctx);
        state = reduced.state;
        applied = reduced.applied;
        toAppend.push({ event: inputEvent, applied });
        // Milestones produced by applying the event (RECOVERED, lullaby
        // SLEPT) share its tick and fold cleanly after it.
        reduced.milestones.forEach(recordMilestone);
      }

      for (const entry of toAppend) {
        await appendEvent(this.deps.db, entry.event, entry.applied);
        if (entry.event.type === "MILESTONE") {
          toPublish.push({ type: "milestone", tick: state.tick, kind: entry.event.kind, ...(entry.event.detail !== undefined ? { detail: entry.event.detail } : {}), state });
        }
      }
      if (inputEvent?.type === "CARE") {
        const caretakerName = (await this.deps.caretakerName?.(inputEvent.caretakerId)) ?? undefined;
        toPublish.push({
          type: "care",
          tick: state.tick,
          action: inputEvent.action,
          caretakerId: inputEvent.caretakerId,
          ...(caretakerName !== undefined ? { caretakerName } : {}),
          applied,
          state,
        });
      }
      if (inputEvent?.type === "HATCHED") {
        await recordHatch(this.deps.db, generation.id, inputEvent.tick, inputEvent.name);
      }
      if (state.diedAtTick !== null && hot.state.diedAtTick === null) {
        await recordDeath(this.deps.db, state);
      }

      await this.deps.redis.set(this.deps.key("state"), JSON.stringify({ state, lastEventSeq: seq } satisfies HotState));
      for (const message of toPublish) {
        await this.publish(message);
      }

      // Snapshot on any recorded event, and periodically by tick distance.
      const snapshot = await latestSnapshot(this.deps.db, generation.id);
      const lastSnapshotTick = snapshot?.state.tick ?? -Infinity;
      if ((toAppend.length > 0 || state.tick - lastSnapshotTick >= SNAPSHOT_INTERVAL_TICKS) && state.tick > lastSnapshotTick) {
        await writeSnapshot(this.deps.db, state, seq);
      }

      return { state, applied, rejected: null };
    });
  }

  /** Advance to now with no input — the tick loop body. */
  async tick(generation: Generation): Promise<PetState> {
    const { state } = await this.advance(generation, () => ({ kind: "skip" }));
    return state;
  }

  /** Perform a care action. Validation happens inside the lock (SPEC §3.4). */
  async care(
    generation: Generation,
    action: CareAction,
    caretakerId: string,
    options: { itemId?: string; performance?: number } = {},
  ): Promise<CareOutcome> {
    const result = await this.advance(generation, (state, ctx) => {
      const verdict = canPerform(state, action, caretakerId, ctx, options.itemId);
      if (!verdict.ok) return { kind: "reject", rejection: verdict };
      return {
        kind: "event",
        event: (seq, current): PetEvent => ({
          type: "CARE",
          generationId: generation.id,
          seq,
          tick: current.tick,
          action,
          caretakerId,
          ...(options.itemId !== undefined ? { itemId: options.itemId } : {}),
          ...(options.performance !== undefined ? { performance: options.performance } : {}),
        }),
      };
    });
    if (result.rejected) return { ok: false, rejection: result.rejected };
    return { ok: true, applied: result.applied, state: result.state };
  }

  /** Install a communal toy for this generation (SPEC §13.2). */
  async addToy(generation: Generation, itemId: string): Promise<PetState> {
    const result = await this.advance(generation, (state) => {
      if (state.toys.includes(itemId)) return { kind: "skip" };
      return {
        kind: "event",
        event: (seq, current): PetEvent => ({
          type: "TOY_ADDED",
          generationId: generation.id,
          seq,
          tick: current.tick,
          itemId,
        }),
      };
    });
    return result.state;
  }

  /** Hatch the egg — driven by the naming vote (SPEC §2.10). */
  async hatch(generation: Generation, name: string): Promise<PetState> {
    const result = await this.advance(generation, (state) => {
      if (state.bornAtTick !== null) return { kind: "skip" };
      return {
        kind: "event",
        event: (seq, current): PetEvent => ({
          type: "HATCHED",
          generationId: generation.id,
          seq,
          tick: current.tick,
          name,
        }),
      };
    });
    return result.state;
  }

  /** Read-only view for handlers: hot state projected to now (no lock). */
  async view(generation: Generation): Promise<PetState> {
    const hot = await this.loadHot(generation);
    const nowTick = Math.max(this.currentTick(generation), hot.state.tick);
    const ctx = this.ctxFor(generation, hot.state.tick, nowTick);
    return project(hot.state, nowTick, ctx).state;
  }

}
