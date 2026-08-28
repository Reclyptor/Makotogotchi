// The ancient code's room-wide throttle (SPEC §26.2).
//
// Global rather than per-caretaker on purpose: throttling per caretaker still
// lets ten people chain ten spectacles back to back, which is the actual
// failure mode. The feed is the app's shared memory (SPEC §2.11) and the
// client holds only its last 120 lines, so a chain of these evicts genuine
// care history.
//
// Named and separated from the route for the same reason `shouldBroadcast-
// Presence` is: a guard is a claim about concurrency, and it deserves a test
// that races real callers at it rather than an assertion in a comment.

import type Redis from "ioredis";

/** One spectacle per five minutes, for the whole room. */
export const SPECTACLE_GUARD_SECONDS = 300;

/** True if this caller claimed the window and should publish to everyone. */
export const shouldBroadcastSpectacle = async (redis: Redis, guardKey: string): Promise<boolean> => {
  const result = await redis.set(guardKey, "1", "EX", SPECTACLE_GUARD_SECONDS, "NX");
  return result === "OK";
};
