// The per-IP SSE connection cap, held in Redis (SPEC §8.3).
//
// It lives here rather than in a Map on the route because a per-process cap
// gets *weaker the more the game scales*: with N replicas behind a load
// balancer, one address holds N × MAX_STREAMS_PER_IP streams, because each
// pod only ever sees its own share of them. An abuse guard that relaxes as
// the fleet grows is backwards.
//
// The shape is presence's, for presence's reason: a sorted set of open
// connection → last heartbeat, pruned by age on read. A plain INCR/DECR
// counter cannot survive a pod dying mid-stream — its decrements never run
// and the address is locked out until someone clears the key by hand. Here a
// lost connection simply stops being refreshed and ages out.

import type Redis from "ioredis";

/** Gone after three missed heartbeats, matching presence's own window. */
const SLOT_TTL_MS = 45_000;

// KEYS[1] the IP's set; ARGV: nowMs, cutoffMs, limit, connectionId, ttlMs
// Prune, count, and claim in one round trip — two streams opening at once
// would otherwise both read a count below the limit and both be admitted.
const CLAIM_SCRIPT = `
redis.call("zremrangebyscore", KEYS[1], "-inf", ARGV[2])
local held = redis.call("zcard", KEYS[1])
if held >= tonumber(ARGV[3]) then
  return 0
end
redis.call("zadd", KEYS[1], ARGV[1], ARGV[4])
redis.call("pexpire", KEYS[1], ARGV[5])
return 1
`;

/**
 * Claim a slot for this connection, or refuse it. Prunes dead entries first,
 * so an address is never held out by streams whose pod is long gone.
 */
export const claimStreamSlot = async (
  redis: Redis,
  capKey: string,
  connectionId: string,
  limit: number,
  nowMs = Date.now(),
): Promise<boolean> => {
  const claimed = await redis.eval(
    CLAIM_SCRIPT,
    1,
    capKey,
    String(nowMs),
    String(nowMs - SLOT_TTL_MS),
    String(limit),
    connectionId,
    String(SLOT_TTL_MS * 2),
  );
  return claimed === 1;
};

/** Keep a live stream's slot from ageing out; rides the existing heartbeat. */
export const touchStreamSlot = async (
  redis: Redis,
  capKey: string,
  connectionId: string,
  nowMs = Date.now(),
): Promise<void> => {
  await redis.zadd(capKey, String(nowMs), connectionId);
  await redis.pexpire(capKey, SLOT_TTL_MS * 2);
};

/** Give the slot back the moment the stream closes, rather than waiting for
 *  it to age out — a refresh should not cost the next connection its place. */
export const releaseStreamSlot = async (redis: Redis, capKey: string, connectionId: string): Promise<void> => {
  await redis.zrem(capKey, connectionId);
};

/** How many streams the address is currently holding, dead ones pruned. */
export const streamsHeld = async (redis: Redis, capKey: string, nowMs = Date.now()): Promise<number> => {
  await redis.zremrangebyscore(capKey, "-inf", String(nowMs - SLOT_TTL_MS));
  return redis.zcard(capKey);
};
