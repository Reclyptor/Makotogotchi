// Hatches the pet. Runs after Playwright's webServer (which owns the store
// containers — see start-stack.mjs) is up, so the stores are reachable and
// the server has already created generation 1 at boot.

import { E2E } from "../playwright.config";

export default async function globalSetup(): Promise<void> {
  process.env.MONGODB_URI = E2E.mongoUri;
  process.env.MONGODB_DB = "makotogotchi-e2e";
  process.env.REDIS_URL = E2E.redisUrl;
  process.env.CARETAKER_SECRET = E2E.caretakerSecret;

  // Hatch the pet the same way production will: through the engine.
  const { db, closeDb } = await import("@/server/db/client");
  const { redis, key, closeRedis } = await import("@/server/redis/client");
  const { PetEngine } = await import("@/server/engine/engine");
  const engine = new PetEngine({ db: await db(), redis: redis(), key, timeZone: "America/Chicago" });
  const generation = await engine.ensureGeneration();
  await engine.hatch(generation, "Makoto");
  await closeDb();
  await closeRedis();
}
