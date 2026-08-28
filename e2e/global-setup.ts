// Hatches the pet. Runs after Playwright's webServer (which owns the store
// containers — see start-stack.mjs) is up, so the stores are reachable and
// the server has already created generation 1 at boot.

import { E2E } from "../playwright.config";
import { TICK_SECONDS } from "@/sim/tuning";

export default async function globalSetup(): Promise<void> {
  process.env.MONGODB_URI = E2E.mongoUri;
  process.env.MONGODB_DB = "makotogotchi-e2e";
  process.env.REDIS_URL = E2E.redisUrl;
  process.env.CARETAKER_SECRET = E2E.caretakerSecret;

  const { db, closeDb } = await import("@/server/db/client");
  const { redis, key, closeRedis } = await import("@/server/redis/client");
  const { PetEngine } = await import("@/server/engine/engine");
  const { createGeneration } = await import("@/server/db/repository");

  // The boot generation carries a random seed, which would make want draws —
  // and therefore the wants spec — nondeterministic. Supersede it with a
  // known layout: seed 21 draws nothing in window 0 (asserted in
  // src/server/wants.test.ts), so the only want open during the suite is the
  // dust-bath the setup opens itself, ~85 minutes before its deadline.
  // Genesis sits BASE_TICK ticks in the past, early in window 0.
  const BASE_TICK = 30;
  const generation = {
    id: "gen-e2e",
    ordinal: 2,
    seed: 21,
    genesisEpochMs: Date.now() - BASE_TICK * TICK_SECONDS * 1000,
    name: null,
  };
  await createGeneration(await db(), generation);

  // Hatch the pet the same way production will: through the engine.
  const engine = new PetEngine({ db: await db(), redis: redis(), key, timeZone: "America/Chicago" });
  await engine.hatch(generation, "Makoto");
  await engine.openWant(generation, 0, { kind: "dust-bath" });

  // The ancient code's guard holds the room for five minutes (SPEC §26.2),
  // which outlives a run. A leftover from the previous one would send the
  // first spectacle down the local-only path and fail its spec for a reason
  // that has nothing to do with the code.
  await redis().del(key("konami:guard"));

  await closeDb();
  await closeRedis();

  // The app's generation pointer is a 10s-TTL cache (src/server/runtime.ts),
  // and a page that connects before it flips is told about the boot egg and
  // stays there until the next snapshot. Hold the suite until the app is
  // actually serving the superseding generation, so no test can race it.
  const deadline = Date.now() + 30_000;
  for (;;) {
    const body = (await fetch(`http://localhost:${E2E.appPort}/api/feed`)
      .then((response) => (response.ok ? response.json() : null))
      .catch(() => null)) as { generationName: string | null } | null;
    if (body?.generationName === "Makoto") return;
    if (Date.now() > deadline) throw new Error("app never converged on the e2e generation");
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}
