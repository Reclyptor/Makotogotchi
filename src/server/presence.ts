// Who is watching right now (SPEC §2.11): a sorted set of open stream →
// lastSeen, pruned by age on read. Broadcasts are throttled through a Redis
// guard key so a join wave publishes at most one presence message per 2s
// across all pods.
//
// Membership is keyed by *connection*, not by caretaker. One caretaker holds
// two streams more often than not — a refresh overlaps the incoming
// EventSource with the outgoing one's cancel, and a second tab is ordinary —
// and against a caretaker-keyed set whichever stream closes first evicts a
// caretaker who is still sitting there watching.

import type Redis from "ioredis";

const PRESENCE_TTL_MS = 45_000; // gone after three missed 15s heartbeats
const BROADCAST_GUARD_MS = 2000;

const member = (caretakerId: string, connectionId: string): string => `${caretakerId}|${connectionId}`;

/** Members written before presence was connection-keyed carry no separator. */
const caretakerOf = (entry: string): string => {
  const separator = entry.indexOf("|");
  return separator === -1 ? entry : entry.slice(0, separator);
};

export const touchPresence = async (
  redis: Redis,
  presenceKey: string,
  caretakerId: string,
  connectionId: string,
): Promise<void> => {
  await redis.zadd(presenceKey, String(Date.now()), member(caretakerId, connectionId));
};

export const dropPresence = async (
  redis: Redis,
  presenceKey: string,
  caretakerId: string,
  connectionId: string,
): Promise<void> => {
  await redis.zrem(presenceKey, member(caretakerId, connectionId));
};

/**
 * The caretakers watching, one entry each however many streams they hold.
 * Ordered oldest-seen first, which is the order the sorted set already keeps.
 */
export const listPresence = async (redis: Redis, presenceKey: string): Promise<string[]> => {
  const cutoff = Date.now() - PRESENCE_TTL_MS;
  await redis.zremrangebyscore(presenceKey, "-inf", String(cutoff));
  const members = await redis.zrange(presenceKey, "0", "-1");
  return [...new Set(members.map(caretakerOf))];
};

/** True if this caller won the 2s broadcast window and should publish. */
export const shouldBroadcastPresence = async (redis: Redis, guardKey: string): Promise<boolean> => {
  const result = await redis.set(guardKey, "1", "PX", BROADCAST_GUARD_MS, "NX");
  return result === "OK";
};
