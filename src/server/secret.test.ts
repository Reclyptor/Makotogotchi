// The ancient code's global guard against real Redis (SPEC §16.4, §26.2).
// What matters here is that the room, not the caretaker, is what gets
// throttled: a crowd all entering the code at once must still produce one
// spectacle.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeRedis, key, redis } from "./redis/client";
import { SPECTACLE_GUARD_SECONDS, shouldBroadcastSpectacle } from "./secret";
import { startTestInfra, type TestInfra } from "./testsetup";

let infra: TestInfra;
const GUARD = () => key("konami:guard-test");

beforeAll(async () => {
  infra = startTestInfra();
  await redis().del(GUARD());
}, 120_000);

afterAll(async () => {
  await closeRedis();
  infra.stop();
});

describe("the spectacle guard", () => {
  it("lets exactly one caller through, however many race for it", async () => {
    await redis().del(GUARD());
    const winners = await Promise.all(Array.from({ length: 8 }, () => shouldBroadcastSpectacle(redis(), GUARD())));
    expect(winners.filter(Boolean)).toHaveLength(1);
  });

  it("keeps refusing for the rest of the window", async () => {
    await redis().del(GUARD());
    expect(await shouldBroadcastSpectacle(redis(), GUARD())).toBe(true);
    expect(await shouldBroadcastSpectacle(redis(), GUARD())).toBe(false);
    expect(await shouldBroadcastSpectacle(redis(), GUARD())).toBe(false);
  });

  it("holds the window for its full term rather than a heartbeat", async () => {
    // The claim is what sets the TTL; a guard that forgot it would let the
    // next caretaker through seconds later instead of minutes.
    await redis().del(GUARD());
    expect(await shouldBroadcastSpectacle(redis(), GUARD())).toBe(true);
    const ttl = await redis().ttl(GUARD());
    expect(ttl).toBeGreaterThan(SPECTACLE_GUARD_SECONDS - 10);
    expect(ttl).toBeLessThanOrEqual(SPECTACLE_GUARD_SECONDS);
  });

  it("does not extend the window when a later caller loses it", async () => {
    // A losing SET must not refresh the TTL, or a steady trickle of attempts
    // would hold the room silent indefinitely.
    await redis().del(GUARD());
    await shouldBroadcastSpectacle(redis(), GUARD());
    await redis().expire(GUARD(), 5);
    expect(await shouldBroadcastSpectacle(redis(), GUARD())).toBe(false);
    expect(await redis().ttl(GUARD())).toBeLessThanOrEqual(5);
  });

  it("frees the room once the window lapses", async () => {
    await redis().del(GUARD());
    expect(await shouldBroadcastSpectacle(redis(), GUARD())).toBe(true);
    await redis().del(GUARD()); // stand-in for the TTL expiring
    expect(await shouldBroadcastSpectacle(redis(), GUARD())).toBe(true);
  });
});
