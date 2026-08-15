// The two coordination primitives (SPEC §3.3, §3.4):
//
// withWriteLock — serializes the read→validate→append→reduce→publish critical
// section across every process, including the rolling-deploy overlap where
// two pods briefly coexist. Held for milliseconds; waiters spin with backoff.
//
// Lease — tick leadership. One holder, renewed on an interval, expiring on
// its own if the holder dies. Losing the lease is harmless by design: the
// next leader projects forward from absolute time and no drift is possible.

import type Redis from "ioredis";
import { randomUUID } from "node:crypto";

const RELEASE_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
end
return 0
`;

const RENEW_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("pexpire", KEYS[1], ARGV[2])
end
return 0
`;

export class LockTimeoutError extends Error {
  constructor(name: string, waitedMs: number) {
    super(`could not acquire ${name} within ${waitedMs}ms`);
  }
}

export const withLock = async <T>(
  redis: Redis,
  lockKey: string,
  fn: () => Promise<T>,
  { ttlMs = 5000, waitMs = 10_000 }: { ttlMs?: number; waitMs?: number } = {},
): Promise<T> => {
  const token = randomUUID();
  const deadline = Date.now() + waitMs;
  for (;;) {
    const acquired = await redis.set(lockKey, token, "PX", ttlMs, "NX");
    if (acquired === "OK") break;
    if (Date.now() >= deadline) throw new LockTimeoutError(lockKey, waitMs);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  try {
    return await fn();
  } finally {
    await redis.eval(RELEASE_SCRIPT, 1, lockKey, token);
  }
};

export class Lease {
  private readonly holder = randomUUID();

  constructor(
    private readonly redis: Redis,
    private readonly leaseKey: string,
    private readonly ttlMs: number,
  ) {}

  /** True if this instance now holds (or already held) the lease. */
  async acquire(): Promise<boolean> {
    const result = await this.redis.set(this.leaseKey, this.holder, "PX", this.ttlMs, "NX");
    if (result === "OK") return true;
    return (await this.redis.get(this.leaseKey)) === this.holder;
  }

  /** True if the lease is still ours and was extended. */
  async renew(): Promise<boolean> {
    return (await this.redis.eval(RENEW_SCRIPT, 1, this.leaseKey, this.holder, this.ttlMs)) === 1;
  }

  async release(): Promise<void> {
    await this.redis.eval(RELEASE_SCRIPT, 1, this.leaseKey, this.holder);
  }
}
