// The stream's background work against real Mongo and Redis (SPEC §16.4). A
// store outage mid-stream used to reject the ping's and the cancel's
// fire-and-forget tasks with nothing handling them, which Node treats as fatal
// (2026-10-28, during a Mongo restart). Each must log and leave the stream up.

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { closeDb, db } from "@/server/db/client";
import { closeRedis, key, redis } from "@/server/redis/client";
import { PetEngine } from "@/server/engine/engine";
import { CARETAKER_COOKIE, cookieFor } from "@/server/identity";
import { startTestInfra, type TestInfra } from "@/server/testsetup";
import type { Generation } from "@/sim/model";

const live = vi.hoisted(() => ({ engine: null as unknown, generation: null as unknown, down: false }));
vi.mock("@/server/runtime", () => ({
  runtime: async () => ({
    engine: live.engine,
    generation: async () => {
      if (live.down) throw new Error("mongo down");
      return live.generation;
    },
  }),
}));
// The slot calls go to Redis; failing them here stands in for Redis going away
// without taking down the store the rest of the test reads through.
vi.mock("@/server/streamcap", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/server/streamcap")>();
  const outage = (): Promise<never> => Promise.reject(new Error("redis down"));
  return {
    ...original,
    touchStreamSlot: (...args: Parameters<typeof original.touchStreamSlot>) =>
      live.down ? outage() : original.touchStreamSlot(...args),
    releaseStreamSlot: (...args: Parameters<typeof original.releaseStreamSlot>) =>
      live.down ? outage() : original.releaseStreamSlot(...args),
  };
});

import { GET } from "./route";

const PING_MS = 15_000;

let infra: TestInfra;
let generation: Generation;

const openStream = async (): Promise<ReadableStreamDefaultReader<Uint8Array>> => {
  const request = new NextRequest("http://localhost/api/stream", {
    headers: { cookie: `${CARETAKER_COOKIE}=${cookieFor("watcher")}`, "x-forwarded-for": "203.0.113.9" },
  });
  const response = await GET(request);
  expect(response.status).toBe(200);
  return response.body!.getReader();
};

/** Reads until the stream has sent something containing `marker`. */
const readUntil = async (reader: ReadableStreamDefaultReader<Uint8Array>, marker: string): Promise<void> => {
  const decoder = new TextDecoder();
  let seen = "";
  while (!seen.includes(marker)) {
    const { value, done } = await reader.read();
    if (done) throw new Error(`stream ended before ${marker}`);
    seen += decoder.decode(value);
  }
};

const settle = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

/** Lets real store round trips run until `ready` holds; only intervals are faked. */
const until = async (ready: () => boolean): Promise<void> => {
  const deadline = Date.now() + 3_000;
  while (!ready()) {
    if (Date.now() > deadline) throw new Error("timed out waiting");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
};

const failures = (log: { mock: { calls: unknown[][] } }, line: string): number =>
  log.mock.calls.filter(([logged]) => logged === line).length;

beforeAll(async () => {
  infra = startTestInfra();
  const engine = new PetEngine({ db: await db(), redis: redis(), key, timeZone: "America/Chicago" });
  generation = await engine.ensureGeneration();
  live.engine = engine;
  live.generation = generation;
}, 120_000);

afterAll(async () => {
  await closeDb();
  await closeRedis();
  infra.stop();
});

describe("GET /api/stream during a store outage", () => {
  it("logs the ping's and the cancel's failures, keeps pinging, and leaves nothing unhandled", async () => {
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    try {
      const reader = await openStream();
      await readUntil(reader, "event: hello");
      // The heartbeat is armed only after the hello, the subscription and the
      // join broadcast.
      await until(() => vi.getTimerCount() > 0);

      live.down = true;
      for (const ping of [1, 2]) {
        // A free broadcast window, so the heartbeat's broadcast reaches the
        // generation rather than folding into a trailing publish.
        await redis().del(key("presence-guard"));
        vi.advanceTimersByTime(PING_MS);
        await readUntil(reader, ": ping");
        await until(() => failures(log, "presence heartbeat failed") === ping);
        expect(failures(log, "stream slot refresh failed")).toBe(ping);
      }

      await redis().del(key("presence-guard"));
      await reader.cancel();
      await until(() => failures(log, "presence leave failed") === 1);
      expect(failures(log, "stream slot release failed")).toBe(1);
      // Rejections are reported a turn after they go unhandled.
      await settle();
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      live.down = false;
      vi.useRealTimers();
      log.mockRestore();
      process.off("unhandledRejection", unhandled);
    }
  });
});
