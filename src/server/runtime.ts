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
import { TICK_SECONDS } from "@/sim/tuning";
import type { Generation } from "@/sim/model";

const GENERATION_TTL_MS = 10_000;
const NAME_CACHE_TTL_MS = 30_000;

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
  const nameCache = new Map<string, { name: string; at: number }>();
  const caretakerName = async (caretakerId: string): Promise<string> => {
    const cached = nameCache.get(caretakerId);
    if (cached && Date.now() - cached.at < NAME_CACHE_TTL_MS) return cached.name;
    const names = await nicknameMap(database, [caretakerId]);
    const name = names.get(caretakerId) ?? anonymousName(caretakerId);
    nameCache.set(caretakerId, name === anonymousName(caretakerId) ? { name, at: Date.now() } : { name, at: Date.now() });
    return name;
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

  // The tick loop: advance under the leader lease, then let the lifecycle
  // inspect the result for hatches, seals, and rebirths.
  const lease = new Lease(redis(), key("tick-leader"), 15_000);
  setInterval(() => {
    void (async () => {
      if (!(await lease.acquire())) return;
      const current = await generation();
      const state = await engine.tick(current);
      const successor = await lifecycle.check(current, state);
      if (successor) cached = { generation: successor, at: Date.now() };
      await lease.renew();
    })().catch((error: unknown) => {
      // Failed ticks retry next interval; projection catches up losslessly.
      console.error("tick failed", error);
    });
  }, TICK_SECONDS * 1000);

  return { engine, generation };
};

export const runtime = (): Promise<Runtime> => {
  const holder = globalThis as GlobalWithRuntime;
  holder[GLOBAL_KEY] ??= boot();
  return holder[GLOBAL_KEY];
};
