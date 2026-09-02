// Process-wide singletons: the engine, the lifecycle, the leader-gated tick
// loop, and the current-generation resolver. Stored on globalThis so
// Next.js dev-mode module reloads reuse the running instances instead of
// stacking tick timers.
//
// The generation pointer is a short-TTL cache over Mongo: only the leader
// rotates generations (and swaps its own pointer instantly); every other
// process converges within the TTL, which merely delays its first sight of
// the new egg by seconds.

import { db } from "./db/client";
import { key, redis } from "./redis/client";
import { env } from "./env";
import { PetEngine } from "./engine/engine";
import { Lifecycle } from "./engine/lifecycle";
import { Lease } from "./redis/lock";
import { latestGeneration } from "./db/repository";
import { anonymousName, nicknameMap } from "./social";
import { PushDispatcher } from "./push/dispatcher";
import { pushConfigured, webPushSender } from "./push/sender";
import { TICK_SECONDS, TICKS_PER_HOUR } from "@/sim/tuning";
import { ambientAt } from "@/sim/ambient";
import { worthRecording } from "@/sim/difficulty";
import { activeCaretakers } from "./population";
import { subscribeToEvents } from "./stream/hub";
import { primeRoomCache } from "./snapshot";
import type { EngineMessage } from "./engine/messages";
import { settleQuest } from "./quests";
import { observeWants } from "./wants";
import { isAlive, type Generation } from "@/sim/model";

const GENERATION_TTL_MS = 10_000;
const NAME_CACHE_TTL_MS = 30_000;
/** A caretaker with no nickname yet — re-checked sooner, because that is the
 *  answer most likely to have just changed. */
const ANONYMOUS_CACHE_TTL_MS = 5_000;
/** Leak guard on a map keyed by caretaker, in a process that runs for months. */
const NAME_CACHE_LIMIT = 10_000;

export type Runtime = {
  engine: PetEngine;
  generation: () => Promise<Generation>;
};

const GLOBAL_KEY = Symbol.for("makotogotchi.runtime");
type GlobalWithRuntime = typeof globalThis & { [GLOBAL_KEY]?: Promise<Runtime> };

const toGeneration = (doc: NonNullable<Awaited<ReturnType<typeof latestGeneration>>>): Generation => ({
  id: doc._id,
  ordinal: doc.ordinal,
  seed: doc.seed,
  genesisEpochMs: doc.genesisEpochMs,
  name: doc.name,
});

const boot = async (): Promise<Runtime> => {
  const database = await db();

  // Small cache in front of nickname lookups for published care messages.
  //
  // What is remembered is the LOOKUP, not the rendered name: a caretaker with
  // no nickname is a cache entry too, or every care action by the many people
  // who never set one would cost a Mongo query. But a miss is remembered for
  // less time than a hit, because a miss is the answer most likely to have
  // just stopped being true — somebody who has this moment chosen a name
  // should not watch the room call them "Friend 3f2a" for another half minute.
  const nameCache = new Map<string, { nickname: string | null; at: number }>();
  const caretakerName = async (caretakerId: string): Promise<string> => {
    const cached = nameCache.get(caretakerId);
    if (cached) {
      const ttl = cached.nickname === null ? ANONYMOUS_CACHE_TTL_MS : NAME_CACHE_TTL_MS;
      if (Date.now() - cached.at < ttl) return cached.nickname ?? anonymousName(caretakerId);
    }
    const names = await nicknameMap(database, [caretakerId]);
    const nickname = names.get(caretakerId) ?? null;
    // Keyed by caretaker, so this grows with everyone who has ever been named
    // in a broadcast — bounded here rather than left to a process that stays
    // up for months. Entries are a TTL apart from worthless anyway.
    if (nameCache.size >= NAME_CACHE_LIMIT) nameCache.clear();
    nameCache.set(caretakerId, { nickname, at: Date.now() });
    return nickname ?? anonymousName(caretakerId);
  };

  const engine = new PetEngine({ db: database, redis: redis(), key, timeZone: env().PET_TIMEZONE, caretakerName });
  const lifecycle = new Lifecycle(database, engine);

  let cached: { generation: Generation; at: number } = {
    generation: await engine.ensureGeneration(),
    at: Date.now(),
  };
  const generation = async (): Promise<Generation> => {
    if (Date.now() - cached.at > GENERATION_TTL_MS) {
      const latest = await latestGeneration(database);
      if (latest) cached = { generation: toGeneration(latest), at: Date.now() };
    }
    return cached.generation;
  };

  // Push alerts observe the authoritative state on the same cadence
  // (SPEC §12) — disabled cleanly when no VAPID keys are configured.
  const dispatcher = pushConfigured() ? new PushDispatcher(database, redis(), key, webPushSender) : null;

  // The tick loop: advance under the leader lease, then let the lifecycle
  // inspect the result for hatches, seals, and rebirths.
  //
  // The shared rare moment (SPEC §21.5) is drawn here, from the tick the
  // leader actually settled on, and recorded as a milestone so every client
  // — and every future replay — sees the same instant. A tick index is drawn
  // at most once: a clock that fails to advance must not roll twice.
  const lease = new Lease(redis(), key("tick-leader"), 15_000);
  let lastAmbientTick = -1;
  // Difficulty is re-measured on the hour rather than every tick: the count
  // is a Mongo query, and the log should record changes in difficulty, not a
  // heartbeat (SPEC §23.2).
  let lastPopulationTick = -Infinity;
  // A tick that outruns its own interval must not start a second one beside
  // itself. The lease does not stop this — the overrunning tick is the leader,
  // so the next one acquires it too — and neither does the write lock, which
  // serializes them into a queue rather than refusing them. A slow store would
  // turn one late tick into a growing backlog of ticks all projecting to the
  // same instant. Skipping is free: the next interval projects from absolute
  // time and arrives at the identical state.
  let ticking = false;
  setInterval(() => {
    if (ticking) return;
    ticking = true;
    void (async () => {
      if (!(await lease.acquire())) return;
      const current = await generation();
      let state = await engine.tick(current);
      const successor = await lifecycle.check(current, state);
      if (successor) cached = { generation: successor, at: Date.now() };
      if (!successor && state.tick !== lastAmbientTick) {
        lastAmbientTick = state.tick;
        const moment = isAlive(state) ? ambientAt(current.seed, state.tick, state.asleep) : null;
        if (moment) await engine.milestone(current, "AMBIENT", moment);
      }
      if (!successor) {
        // The pet's asks (SPEC §25.2): expire a stale want, open this
        // window's. State-driven, so a leader outage settles late instead
        // of never; the engine re-validates everything under the lock.
        state = await observeWants(engine, current, state, env().PET_TIMEZONE);
      }
      if (!successor) {
        // The day's shared goal (SPEC §21.7): claimed once, then announced.
        const settled = await settleQuest(database, current, state, env().PET_TIMEZONE, Date.now());
        if (settled) await engine.milestone(current, "QUEST_DONE", settled.quest.id);
      }
      if (!successor && isAlive(state) && state.tick - lastPopulationTick >= TICKS_PER_HOUR) {
        lastPopulationTick = state.tick;
        const measured = await activeCaretakers(database, state.tick);
        if (worthRecording(state.population, measured)) await engine.population(current, measured);
      }
      await dispatcher?.observe(state);
      await lease.renew();
    })()
      .catch((error: unknown) => {
        // Failed ticks retry next interval; projection catches up losslessly.
        console.error("tick failed", error);
      })
      .finally(() => {
        ticking = false;
      });
  }, TICK_SECONDS * 1000);

  // Cache coherence across the fleet (SPEC §7.2). The room is cached for a
  // few seconds in front of Mongo, and the writer can only ever drop its
  // OWN copy — so every other pod kept serving the old room until its TTL
  // expired, while the very message that says the room changed was already
  // on its way to those pods' clients. The cache was contradicting a
  // broadcast the browser had in hand.
  //
  // Subscribing here rather than on the first SSE client matters as much as
  // the invalidation: the hub attaches lazily, so a replica serving only
  // /api/state would never have heard the message at all.
  await subscribeToEvents((raw) => {
    try {
      const message = JSON.parse(raw) as EngineMessage;
      if (message.type === "room") primeRoomCache(message.room);
    } catch {
      // A malformed payload is not worth taking the process down over; the
      // TTL is still there underneath as the backstop.
    }
  });

  return { engine, generation };
};

export const runtime = (): Promise<Runtime> => {
  const holder = globalThis as GlobalWithRuntime;
  holder[GLOBAL_KEY] ??= boot();
  return holder[GLOBAL_KEY];
};
