// Token buckets in Redis (SPEC §8.2). These protect the server and pace the
// crowd — the pet is protected by the game rules themselves (SPEC §2.4).
// Atomic via Lua: refill by elapsed time, take one token, report retry-after.

import type Redis from "ioredis";
import { env } from "./env";

// KEYS[1] bucket key; ARGV: capacity, refillPerSecond, nowMs
// Returns { allowed (1|0), retryAfterSeconds }
const BUCKET_SCRIPT = `
local capacity = tonumber(ARGV[1])
local refill = tonumber(ARGV[2])
local now = tonumber(ARGV[3])
local data = redis.call("hmget", KEYS[1], "tokens", "at")
local tokens = tonumber(data[1])
local at = tonumber(data[2])
if tokens == nil then
  tokens = capacity
  at = now
end
tokens = math.min(capacity, tokens + (now - at) / 1000 * refill)
local allowed = 0
local retry = 0
if tokens >= 1 then
  tokens = tokens - 1
  allowed = 1
else
  retry = math.ceil((1 - tokens) / refill)
end
redis.call("hset", KEYS[1], "tokens", tokens, "at", now)
redis.call("pexpire", KEYS[1], math.ceil(capacity / refill * 2000))
return { allowed, retry }
`;

export type RateLimitResult = { allowed: true } | { allowed: false; retryAfterSeconds: number };

export const takeToken = async (
  redis: Redis,
  bucketKey: string,
  capacity: number,
  refillPerSecond: number,
  nowMs = Date.now(),
): Promise<RateLimitResult> => {
  const [allowed, retry] = (await redis.eval(BUCKET_SCRIPT, 1, bucketKey, capacity, refillPerSecond, nowMs)) as [
    number,
    number,
  ];
  return allowed === 1 ? { allowed: true } : { allowed: false, retryAfterSeconds: retry };
};

/** One bucket's shape: how many it holds, and how fast it fills back up. */
export type TokenBucketLimit = { readonly capacity: number; readonly refillPerSecond: number };

/**
 * A per-minute budget as a bucket: it holds a full minute's worth and refills
 * at exactly that rate, so the burst allowance and the sustained rate are the
 * same number and cannot drift apart when either is retuned.
 */
const perMinute = (budget: number): TokenBucketLimit => ({ capacity: budget, refillPerSecond: budget / 60 });

/**
 * SPEC §8.2: 60 requests/min per IP, 30 actions/min per caretaker.
 *
 * Read through `env()` rather than frozen as constants for the reason
 * `MAX_STREAMS_PER_IP` is: the e2e suite drives the whole application from
 * 127.0.0.1, so one address carries traffic that in production would be
 * spread across every visitor. The defaults are the spec's numbers.
 */
export const limits = (): { perIp: TokenBucketLimit; perCaretaker: TokenBucketLimit } => ({
  perIp: perMinute(env().RATE_LIMIT_PER_IP),
  perCaretaker: perMinute(env().RATE_LIMIT_PER_CARETAKER),
});
