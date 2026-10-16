// The leader's tick loop, driven for real: the runtime boots against the
// dockerized stores, its interval is stepped by hand, and the log is read back.
// What the engine does when asked is covered in engine.test.ts; what is pinned
// here is that the loop asks (SPEC §2.3, §23.2).

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { closeDb, db } from "./db/client";
import { closeRedis, key, redis } from "./redis/client";
import { createGeneration, eventsSince } from "./db/repository";
import { PetEngine } from "./engine/engine";
import { runtime } from "./runtime";
import { startTestInfra, type TestInfra } from "./testsetup";
import { CURRENT_RULES_VERSION, TICK_SECONDS } from "@/sim/tuning";
import type { Generation } from "@/sim/model";

let infra: TestInfra;
let generation: Generation;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const logCount = async (type: string): Promise<number> =>
  (await eventsSince(await db(), generation.id, -1)).filter((event) => event.type === type).length;

/** Step the leader's interval once; the tick it starts runs on its own. */
const stepLeader = (): void => {
  vi.advanceTimersByTime(TICK_SECONDS * 1000);
};

/** Wait for a count the tick is expected to reach, failing with the count it stuck at. */
const eventually = async (type: string, count: number): Promise<void> => {
  for (let waited = 0; waited < 5000; waited += 50) {
    if ((await logCount(type)) === count) return;
    await sleep(50);
  }
  expect(await logCount(type)).toBe(count);
};

beforeAll(async () => {
  infra = startTestInfra();
  // Born three days ago, so a pet hatched now has every stage ahead of it.
  generation = { id: "gen-runtime-test", ordinal: 1, seed: 5, genesisEpochMs: Date.now() - 3 * 86_400_000, name: null };
  await createGeneration(await db(), generation);
  await new PetEngine({ db: await db(), redis: redis(), key, timeZone: "America/Chicago" }).hatch(generation, "Makoto");
  // Only the interval is faked: the stores and the clock stay real.
  vi.useFakeTimers({ toFake: ["setInterval"] });
}, 120_000);

afterAll(async () => {
  vi.useRealTimers();
  await closeDb();
  await closeRedis();
  infra.stop();
});

describe("the leader's tick loop", () => {
  it("records the ruleset for a living pet, once, however many ticks follow", async () => {
    await runtime();
    expect(await logCount("RULES")).toBe(0);

    stepLeader();
    await eventually("RULES", 1);
    const [rules] = (await eventsSince(await db(), generation.id, -1)).filter((event) => event.type === "RULES");
    expect(rules).toMatchObject({ type: "RULES", version: CURRENT_RULES_VERSION });
    // The elder ramp rides the same loop.
    await eventually("ELDER_RAMP", 1);

    // Later ticks have nothing left to record: give them time to run, then look.
    for (let tick = 0; tick < 2; tick++) {
      stepLeader();
      await sleep(400);
    }
    expect(await logCount("RULES")).toBe(1);
    expect(await logCount("ELDER_RAMP")).toBe(1);
  }, 30_000);
});
