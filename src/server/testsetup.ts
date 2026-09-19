// Per-file isolation on the run's shared infrastructure (SPEC §16.4).
//
// The containers themselves are started once for the whole run by
// `testinfra.global.ts` — see there for why. What a test file needs from this
// module is a corner of them nobody else is writing to, and it gets that for
// free: the app already reads its database name and its Redis key prefix from
// the environment, so handing each file its own is the whole of the isolation.
//
// Real stores, no mocks — the tests exercise the same drivers, the same index
// behavior, and the same locking semantics as production.
// (mongodb-memory-server is not used: its downloaded binaries cannot run on
// NixOS, and docker is available both locally and in CI.)

import { randomUUID } from "node:crypto";
import { inject } from "vitest";
import { resetEnvCache } from "./env";
import { resetIndexCache } from "./db/collections";
import { key, redis } from "./redis/client";

export type TestInfra = {
  mongoUri: string;
  redisUrl: string;
  /**
   * Drop everything this file wrote to Redis, leaving every other file's keys
   * alone. This is what `flushall` used to be: correct while a file owned a
   * whole server, and a way to delete other suites' state the moment one is
   * shared. Tests that simulate "the hot state was lost" want exactly this —
   * their own keys gone, which is also the more precise statement of intent.
   */
  clearRedis: () => Promise<void>;
  stop: () => void;
};

export type TestInfraOptions = {
  /**
   * Retained for the callers that pass `false`. It is now only a statement of
   * intent: both servers are already running, and a Redis-only suite costs
   * nothing by having a Mongo database it never queries.
   */
  mongo?: boolean;
};

export const startTestInfra = (_options: TestInfraOptions = {}): TestInfra => {
  const mongoUri = inject("mongoUri");
  const redisUrl = inject("redisUrl");
  // One token per call, and each file calls once, so no two files can collide
  // in either store.
  const token = randomUUID().slice(0, 8);

  process.env.MONGODB_URI = mongoUri;
  process.env.MONGODB_DB = `makotogotchi-test-${token}`;
  process.env.REDIS_URL = redisUrl;
  process.env.REDIS_PREFIX = `mgc-test-${token}:`;
  process.env.CARETAKER_SECRET = "test-secret-test-secret-test-secret!";
  resetEnvCache();
  resetIndexCache();

  const clearRedis = async (): Promise<void> => {
    const prefix = key("");
    let cursor = "0";
    do {
      const [next, found] = await redis().scan(cursor, "MATCH", `${prefix}*`, "COUNT", 500);
      if (found.length > 0) await redis().del(...found);
      cursor = next;
    } while (cursor !== "0");
  };

  return {
    mongoUri,
    redisUrl,
    clearRedis,
    // The containers outlive every file now, so a file's teardown has nothing
    // to stop. Kept so the twenty suites that call it need no edit.
    stop: () => {},
  };
};
