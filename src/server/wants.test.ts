// Integration tests for the leader-side want lifecycle (SPEC §25.2) against
// real dockerized Mongo and Redis. The claims that matter: a window opens and
// expires exactly once — across duplicate observations, engine restarts, and
// a flushed Redis — the egg and the boundary are respected, fulfillment rides
// the care outcome, and the whole log replays to the recovered state.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, db } from "./db/client";
import { closeRedis, key, redis } from "./redis/client";
import { createGeneration, eventsSince } from "./db/repository";
import { PetEngine } from "./engine/engine";
import { observeWants, settleWantFulfillment, windowIsScheduledAwake } from "./wants";
import { phaseAt } from "@/sim/model";
import { TICKS_PER_DAY } from "@/sim/tuning";
import { caretakerProfile } from "./social";
import { startTestInfra, type TestInfra } from "./testsetup";
import { genesis } from "@/sim/genesis";
import { reduce } from "@/sim/reduce";
import { scheduleFor } from "./schedule";
import { WANT_REWARD_COINS, wantAt, WANT_WINDOW_TICKS, windowEndTick } from "@/sim/wants";
import type { Generation, PetState } from "@/sim/model";
import { TICK_SECONDS } from "@/sim/tuning";

// 2025-10-09 ~11:53 America/Chicago — tick 0 is late morning, pet awake.
const GENESIS_MS = 1_760_028_800_000;

// Seed 21's first pet-day (awake windows 0–5) draws exactly two wants, both
// itemless: dust-bath in window 1, cuddle in window 2. Verified by
// src/sim/wants.test.ts determinism — the layout is a pure function of the
// seed and can never drift.
const SEED = 21;

const TZ = "America/Chicago";

let infra: TestInfra;
let engine: PetEngine;
let generation: Generation;

let fakeNowMs = GENESIS_MS;
const setClockTick = (tick: number): void => {
  fakeNowMs = GENESIS_MS + tick * TICK_SECONDS * 1000;
};

const buildEngine = async (): Promise<PetEngine> =>
  new PetEngine({ db: await db(), redis: redis(), key, timeZone: TZ, now: () => fakeNowMs });

const logEvents = async (type: string): Promise<number> =>
  (await eventsSince(await db(), generation.id, -1)).filter((event) => event.type === type).length;

/** Replay the full Mongo log from genesis — the canonical fold (SPEC §3.1). */
const replayFromLog = async (): Promise<PetState> => {
  const log = await eventsSince(await db(), generation.id, -1);
  let state = genesis(generation);
  for (const event of log) {
    const ctx = { schedule: scheduleFor(generation.genesisEpochMs, state.tick, event.tick + 8640, TZ) };
    state = reduce(state, event, ctx).state;
  }
  return state;
};

beforeAll(async () => {
  infra = startTestInfra();
  generation = { id: "gen-wants-test", ordinal: 1, seed: SEED, genesisEpochMs: GENESIS_MS, name: null };
  await createGeneration(await db(), generation);
  engine = await buildEngine();
  expect((await engine.ensureGeneration()).seed).toBe(SEED);
  // The layout the tests below stand on.
  expect(wantAt(SEED, 0)).toBeNull();
  expect(wantAt(SEED, 1)).toEqual({ kind: "dust-bath" });
  expect(wantAt(SEED, 2)).toEqual({ kind: "cuddle" });
}, 120_000);

afterAll(async () => {
  await closeDb();
  await closeRedis();
  infra.stop();
});

describe("want lifecycle on the leader", () => {
  it("never opens a want for an egg", async () => {
    setClockTick(WANT_WINDOW_TICKS + 20); // inside window 1, which draws
    const state = await engine.tick(generation);
    expect(state.bornAtTick).toBeNull();
    const after = await observeWants(engine, generation, state, TZ);
    expect(after.wantOpen ?? null).toBeNull();
    expect(await logEvents("WANT_OPENED")).toBe(0);
  });

  it("opens a drawn window's want exactly once, across restarts and a Redis flush", async () => {
    const hatched = await engine.hatch(generation, "Makoto");
    expect(hatched.bornAtTick).not.toBeNull();

    const opened = await observeWants(engine, generation, hatched, TZ);
    expect(opened.wantOpen).toEqual({ window: 1, kind: "dust-bath" });
    expect(await logEvents("WANT_OPENED")).toBe(1);

    // A second observation of the same state is a no-op.
    await observeWants(engine, generation, opened, TZ);
    expect(await logEvents("WANT_OPENED")).toBe(1);

    // Failover: a fresh engine on a flushed Redis recovers from Mongo and
    // still refuses to double-open — the guard is the state, not a key.
    await redis().del(key("state"));
    const successor = await buildEngine();
    const recovered = await successor.tick(generation);
    expect(recovered.wantOpen).toEqual({ window: 1, kind: "dust-bath" });
    await observeWants(successor, generation, recovered, TZ);
    expect(await logEvents("WANT_OPENED")).toBe(1);
  });

  it("expires a stale want late — then opens the current window in the same observation", async () => {
    setClockTick(2 * WANT_WINDOW_TICKS + 20); // window 2; window 1 lapsed unobserved
    const state = await engine.tick(generation);
    const after = await observeWants(engine, generation, state, TZ);
    expect(after.wantSettledWindow).toBe(1);
    expect(after.wantOpen).toEqual({ window: 2, kind: "cuddle" });
    expect(await logEvents("WANT_EXPIRED")).toBe(1);
    expect(await logEvents("WANT_OPENED")).toBe(2);

    // Idempotent: nothing further to settle or open.
    await observeWants(engine, generation, after, TZ);
    expect(await logEvents("WANT_EXPIRED")).toBe(1);
    expect(await logEvents("WANT_OPENED")).toBe(2);
  });

  it("carries WANT_FULFILLED on the care outcome, in the same write", async () => {
    setClockTick(2 * WANT_WINDOW_TICKS + 30);
    const outcome = await engine.care(generation, "PET", "emilio");
    if (!outcome.ok) throw new Error(`care rejected: ${outcome.rejection.reason}`);
    expect(outcome.milestones).toContainEqual({ kind: "WANT_FULFILLED", tick: outcome.state.tick, detail: "cuddle" });
    expect(outcome.state.wantOpen).toBeNull();
    expect(outcome.state.wantSettledWindow).toBe(2);
  });

  it("recovers from snapshots to the exact state the full log folds to", async () => {
    const recovered = await engine.recover(generation);
    const replayed = await replayFromLog();
    // Byte-identical, not merely deep-equal: absent, null, and undefined
    // fields must agree everywhere (SPEC §25.2).
    expect(JSON.stringify(recovered.state)).toBe(JSON.stringify(replayed));
    expect(recovered.state.wantOpen).toBeNull();
  });
});

describe("settleWantFulfillment", () => {
  it("pays exactly when the outcome carries WANT_FULFILLED", async () => {
    const database = await db();
    const before = (await caretakerProfile(database, "payee"))?.coins ?? 0;
    const paid = await settleWantFulfillment(database, "payee", [{ kind: "WANT_FULFILLED", tick: 1, detail: "cuddle" }]);
    expect(paid).toBe(WANT_REWARD_COINS);
    const none = await settleWantFulfillment(database, "payee", [{ kind: "SLEPT", tick: 1 }]);
    expect(none).toBe(0);
    const after = (await caretakerProfile(database, "payee"))?.coins ?? 0;
    expect(after - before).toBe(WANT_REWARD_COINS);
  });
});

describe("windowIsScheduledAwake", () => {
  // Written against the schedule rather than against a list of window indices
  // computed by hand for one bedtime. The indices moved when the night did,
  // and the arithmetic that produced them was only ever in a comment.
  const schedule = scheduleFor(GENESIS_MS, 0, 4 * TICKS_PER_DAY, TZ);
  const fullyAwake = (windowIndex: number): boolean => {
    const start = windowIndex * WANT_WINDOW_TICKS;
    const end = windowEndTick(windowIndex);
    if (phaseAt(schedule, start) !== "WAKE") return false;
    return !schedule.boundaries.some((boundary) => boundary.tick > start && boundary.tick < end);
  };

  it("accepts exactly the windows that sit wholly inside waking hours", () => {
    // Two pet-days of windows is enough to cover a bedtime, a night and a
    // dawn however the schedule is tuned.
    const windows = Math.ceil((2 * TICKS_PER_DAY) / WANT_WINDOW_TICKS);
    for (let index = 0; index < windows; index++) {
      expect(windowIsScheduledAwake(GENESIS_MS, index, TZ), `window ${index}`).toBe(fullyAwake(index));
    }
  });

  it("finds both answers in that span, so the case above is not vacuous", () => {
    const windows = Math.ceil((2 * TICKS_PER_DAY) / WANT_WINDOW_TICKS);
    const verdicts = Array.from({ length: windows }, (_, index) => windowIsScheduledAwake(GENESIS_MS, index, TZ));
    expect(verdicts).toContain(true);
    expect(verdicts).toContain(false);
  });

  it("refuses a window that straddles bedtime, not only one inside the night", () => {
    const bedtime = schedule.boundaries.find((boundary) => boundary.phase === "SLEEP");
    expect(bedtime).toBeDefined();
    // A want must not open on a span the pet sleeps through the end of, so
    // the interesting case is the window bedtime falls *inside*.
    const index = Math.floor(bedtime!.tick / WANT_WINDOW_TICKS);
    expect(bedtime!.tick).toBeGreaterThan(index * WANT_WINDOW_TICKS);
    expect(bedtime!.tick).toBeLessThan(windowEndTick(index));
    expect(windowIsScheduledAwake(GENESIS_MS, index, TZ)).toBe(false);
  });
});
