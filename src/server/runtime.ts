// Process-wide singletons: the engine, its generation, and the tick loop.
// Stored on globalThis so Next.js dev-mode module reloads reuse the running
// instances instead of stacking tick timers.

import { db } from "./db/client";
import { key, redis } from "./redis/client";
import { env } from "./env";
import { PetEngine } from "./engine/engine";
import type { Generation } from "@/sim/model";

type Runtime = {
  engine: PetEngine;
  generation: Generation;
};

const GLOBAL_KEY = Symbol.for("makotogotchi.runtime");

type GlobalWithRuntime = typeof globalThis & { [GLOBAL_KEY]?: Promise<Runtime> };

const boot = async (): Promise<Runtime> => {
  const engine = new PetEngine({ db: await db(), redis: redis(), key, timeZone: env().PET_TIMEZONE });
  const generation = await engine.ensureGeneration();
  engine.startTicking(generation);
  return { engine, generation };
};

export const runtime = (): Promise<Runtime> => {
  const holder = globalThis as GlobalWithRuntime;
  holder[GLOBAL_KEY] ??= boot();
  return holder[GLOBAL_KEY];
};
