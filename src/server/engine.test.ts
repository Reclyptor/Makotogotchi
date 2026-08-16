// Integration tests against real dockerized Mongo and Redis (SPEC §16.4).
// The three claims that matter: a killed engine recovers to the exact state,
// parallel writes produce a totally ordered replay-identical log, and the
// leader lease admits exactly one holder with clean handover.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, db } from "./db/client";
import { closeRedis, key, redis } from "./redis/client";
import { eventsSince } from "./db/repository";
import { Lease } from "./redis/lock";
import { PetEngine } from "./engine/engine";
import { startTestInfra, type TestInfra } from "./testsetup";
import { genesis } from "@/sim/genesis";
import { project } from "@/sim/project";
import { reduce } from "@/sim/reduce";
import { scheduleFor } from "./schedule";
import { ambientAt } from "@/sim/ambient";
import type { Generation, PetState } from "@/sim/model";
import { CARE_ACTIONS, TICK_SECONDS } from "@/sim/tuning";

let infra: TestInfra;
let engine: PetEngine;
let generation: Generation;

// A controllable clock: starts at a fixed instant — late morning in the
// pet's timezone, so the freshly hatched pet is awake — and advances when
// told. (1_760_028_800_000 ≈ 2025-10-09 11:53 America/Chicago.)
let fakeNowMs = 1_760_028_800_000;
const advanceClockTicks = (ticks: number): void => {
  fakeNowMs += ticks * TICK_SECONDS * 1000;
};

const buildEngine = async (): Promise<PetEngine> =>
  new PetEngine({ db: await db(), redis: redis(), key, timeZone: "America/Chicago", now: () => fakeNowMs });

/** Replay the full Mongo log from genesis — the canonical fold (SPEC §3.1). */
const replayFromLog = async (): Promise<PetState> => {
  const log = await eventsSince(await db(), generation.id, -1);
  let state = genesis(generation);
  for (const event of log) {
    const ctx = { schedule: scheduleFor(generation.genesisEpochMs, state.tick, event.tick + 8640, "America/Chicago") };
    state = reduce(state, event, ctx).state;
  }
  return state;
};

beforeAll(async () => {
  infra = startTestInfra();
  engine = await buildEngine();
  generation = await engine.ensureGeneration();
}, 120_000);

afterAll(async () => {
  await closeDb();
  await closeRedis();
  infra.stop();
});

describe("PetEngine", () => {
  it("creates one generation and returns it stably", async () => {
    const again = await engine.ensureGeneration();
    expect(again.id).toBe(generation.id);
    expect(again.ordinal).toBe(1);
  });

  it("hatches, applies care, and the log replays to the identical state", async () => {
    advanceClockTicks(200);
    const hatched = await engine.hatch(generation, "Makoto");
    expect(hatched.bornAtTick).not.toBeNull();

    advanceClockTicks(60);
    const fed = await engine.care(generation, "FEED", "emilio");
    expect(fed.ok).toBe(true);

    advanceClockTicks(6);
    const played = await engine.care(generation, "PLAY", "ana");
    expect(played.ok).toBe(true);

    const view = await engine.view(generation);
    const replayed = await replayFromLog();
    // The view projects to "now"; bring the replay to the same tick first.
    const ctx = { schedule: scheduleFor(generation.genesisEpochMs, replayed.tick, view.tick + 8640, "America/Chicago") };
    expect(project(replayed, view.tick, ctx).state).toEqual(view);
  });

  it("rejects an illegal action inside the lock with a typed reason", async () => {
    const outcome = await engine.care(generation, "MEDICATE", "emilio");
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.rejection.reason).toBe("NOT_SICK");
  });

  it("survives losing Redis entirely — recovery folds snapshot + events to the exact hot state", async () => {
    advanceClockTicks(30);
    await engine.care(generation, "PET", "cyn");
    const before = await engine.view(generation);

    // Kill the hot state and every other Redis key — cold cache only.
    await redis().flushall();

    const recovered = await engine.recover(generation);
    const ctx = { schedule: scheduleFor(generation.genesisEpochMs, recovered.state.tick, before.tick + 8640, "America/Chicago") };
    expect(project(recovered.state, before.tick, ctx).state).toEqual(before);
  });

  it("records a shared rare moment that survives a cold restart (SPEC §21.5)", async () => {
    advanceClockTicks(30);
    const moment = ambientAt(generation.seed, 4242, false) ?? "butterfly";
    const before = await engine.milestone(generation, "AMBIENT", moment);

    const log = await eventsSince(await db(), generation.id, -1);
    const recorded = log.filter((event) => event.type === "MILESTONE" && event.kind === "AMBIENT");
    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({ type: "MILESTONE", kind: "AMBIENT", detail: moment });

    // Losing Redis loses nothing: the moment is in the durable log, so the
    // fold that rebuilds the pet replays it and lands on the same state — a
    // milestone asserts what happened, it never mutates.
    await redis().flushall();
    const recovered = await engine.recover(generation);
    const ctx = { schedule: scheduleFor(generation.genesisEpochMs, recovered.state.tick, before.tick + 8640, "America/Chicago") };
    expect(project(recovered.state, before.tick, ctx).state).toEqual(before);
  });

  it("serializes concurrent care writes: unique contiguous seqs, replay-identical fold", async () => {
    advanceClockTicks(360); // give cooldowns room
    const caretakers = ["a1", "a2", "a3", "a4", "a5"];
    const attempts = caretakers.flatMap((caretaker) =>
      CARE_ACTIONS.filter((action) => action !== "MEDICATE").map((action) => ({ caretaker, action })),
    );

    const results = await Promise.all(
      attempts.map(({ caretaker, action }) => engine.care(generation, action, caretaker)),
    );
    const accepted = results.filter((result) => result.ok).length;
    expect(accepted).toBeGreaterThan(0);

    const log = await eventsSince(await db(), generation.id, -1);
    const seqs = log.map((event) => event.seq);
    // Total order: strictly ascending, no gaps, no duplicates.
    expect(seqs).toEqual(Array.from({ length: seqs.length }, (_, index) => index));
    // Ticks never regress along the fold order.
    for (let index = 1; index < log.length; index++) {
      expect(log[index]!.tick).toBeGreaterThanOrEqual(log[index - 1]!.tick);
    }

    // The fold of the durable log equals the authoritative hot state.
    const view = await engine.view(generation);
    const replayed = await replayFromLog();
    const ctx = { schedule: scheduleFor(generation.genesisEpochMs, replayed.tick, view.tick + 8640, "America/Chicago") };
    expect(project(replayed, view.tick, ctx).state).toEqual(view);
  });

  it("admits exactly one leader and hands over cleanly", async () => {
    const a = new Lease(redis(), key("test-lease"), 500);
    const b = new Lease(redis(), key("test-lease"), 500);

    expect(await a.acquire()).toBe(true);
    expect(await b.acquire()).toBe(false);
    expect(await a.renew()).toBe(true);

    await a.release();
    expect(await b.acquire()).toBe(true);

    // Expiry handover: let B's lease lapse without renewal.
    await new Promise((resolve) => setTimeout(resolve, 700));
    expect(await a.acquire()).toBe(true);
    await a.release();
  });
});
