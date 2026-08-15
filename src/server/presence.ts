// Who is watching right now (SPEC §2.11): a sorted set of caretakerId →
// lastSeen, pruned by age on read. Broadcasts are throttled through a Redis
// guard key so a join wave publishes at most one presence message per 2s
// across all pods.

import type Redis from "ioredis";

const PRESENCE_TTL_MS = 45_000; // gone after three missed 15s heartbeats
const BROADCAST_GUARD_MS = 2000;

export const touchPresence = async (redis: Redis, presenceKey: string, caretakerId: string): Promise<void> => {
  await redis.zadd(presenceKey, String(Date.now()), caretakerId);
};

export const dropPresence = async (redis: Redis, presenceKey: string, caretakerId: string): Promise<void> => {
  await redis.zrem(presenceKey, caretakerId);
};

export const listPresence = async (redis: Redis, presenceKey: string): Promise<string[]> => {
  const cutoff = Date.now() - PRESENCE_TTL_MS;
  await redis.zremrangebyscore(presenceKey, "-inf", String(cutoff));
  return redis.zrange(presenceKey, "0", "-1");
};

/** True if this caller won the 2s broadcast window and should publish. */
export const shouldBroadcastPresence = async (redis: Redis, guardKey: string): Promise<boolean> => {
  const result = await redis.set(guardKey, "1", "PX", BROADCAST_GUARD_MS, "NX");
  return result === "OK";
};
