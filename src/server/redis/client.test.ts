// The connections must survive Redis going away (SPEC §6.2).
//
// This needs no container — the point is the failure path, so it points at a
// port nothing is listening on. Without the `error` listener these
// assertions would not merely fail: EventEmitter would rethrow the event as
// an uncaught exception and take the worker down, which is exactly what it
// used to do to a production pod over a blip ioredis was already retrying.

import { afterAll, describe, expect, it } from "vitest";
import { redis, redisSubscriber } from "./client";
import { resetEnvCache } from "../env";

process.env.MONGODB_URI = "mongodb://127.0.0.1:1";
process.env.MONGODB_DB = "makotogotchi-test";
process.env.REDIS_URL = "redis://127.0.0.1:1"; // closed by definition
process.env.CARETAKER_SECRET = "test-secret-test-secret-test-secret!";
resetEnvCache();

afterAll(() => {
  // disconnect, not quit: quit speaks to a server that was never there.
  redis().disconnect();
  redisSubscriber().disconnect();
});

describe.each([
  ["command", redis],
  ["subscriber", redisSubscriber],
])("the %s connection", (_role, open) => {
  it("registers an error listener before anything can fail", () => {
    // The invariant Node enforces: an `error` event with zero listeners is
    // rethrown. One listener is the entire difference between a logged blip
    // and a dead process.
    expect(open().listenerCount("error")).toBeGreaterThan(0);
  });

  it("actually emits that error when Redis is unreachable", async () => {
    await expect(new Promise((_resolve, reject) => open().once("error", reject))).rejects.toThrow();
  });
});
