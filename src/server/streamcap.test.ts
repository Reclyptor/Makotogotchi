// The per-IP stream cap against real Redis (SPEC §8.3, §16.4). The defect
// this pins is a scaling one rather than a crash: the cap used to be a Map
// in each process, so an address could hold the limit again for every
// replica behind the load balancer — a guard that got weaker the more the
// game grew.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeRedis, key, redis } from "./redis/client";
import { claimStreamSlot, releaseStreamSlot, streamsHeld, touchStreamSlot } from "./streamcap";
import { startTestInfra, type TestInfra } from "./testsetup";

let infra: TestInfra;
const CAP = () => key("streams:203.0.113.7");
const SLOT_TTL_MS = 45_000;

beforeAll(async () => {
  infra = startTestInfra();
}, 120_000);

afterAll(async () => {
  await closeRedis();
  infra.stop();
});

describe("the per-IP stream cap", () => {
  it("admits up to the limit and refuses the next one", async () => {
    await redis().del(CAP());
    for (let index = 0; index < 3; index++) {
      expect(await claimStreamSlot(redis(), CAP(), `conn-${index}`, 3)).toBe(true);
    }
    expect(await claimStreamSlot(redis(), CAP(), "conn-over", 3)).toBe(false);
    expect(await streamsHeld(redis(), CAP())).toBe(3);
  });

  it("counts one address across every pod, not once per pod", async () => {
    // The whole point: these calls stand in for three different replicas
    // handling the same address. A per-process Map would have admitted all
    // of them because each pod would have started counting from zero.
    await redis().del(CAP());
    const fromPods = await Promise.all([
      claimStreamSlot(redis(), CAP(), "pod-a-conn", 2),
      claimStreamSlot(redis(), CAP(), "pod-b-conn", 2),
      claimStreamSlot(redis(), CAP(), "pod-c-conn", 2),
    ]);
    expect(fromPods.filter(Boolean)).toHaveLength(2);
    expect(await streamsHeld(redis(), CAP())).toBe(2);
  });

  it("gives the slot back when a stream closes", async () => {
    await redis().del(CAP());
    await claimStreamSlot(redis(), CAP(), "conn-a", 1);
    expect(await claimStreamSlot(redis(), CAP(), "conn-b", 1)).toBe(false);
    await releaseStreamSlot(redis(), CAP(), "conn-a");
    expect(await claimStreamSlot(redis(), CAP(), "conn-b", 1)).toBe(true);
  });

  it("lets a dead pod's streams age out rather than locking the address forever", async () => {
    // A pod killed mid-stream never runs its release. With a plain
    // INCR/DECR counter that address would be capped out permanently; here
    // the entries simply stop being refreshed.
    await redis().del(CAP());
    const longAgo = Date.now() - SLOT_TTL_MS - 1000;
    await claimStreamSlot(redis(), CAP(), "orphan-1", 2, longAgo);
    await claimStreamSlot(redis(), CAP(), "orphan-2", 2, longAgo);
    expect(await claimStreamSlot(redis(), CAP(), "orphan-3", 2, longAgo)).toBe(false);

    // A fresh connection prunes them on its way in.
    expect(await claimStreamSlot(redis(), CAP(), "live", 2)).toBe(true);
    expect(await streamsHeld(redis(), CAP())).toBe(1);
  });

  it("keeps a live stream counted for as long as it heartbeats", async () => {
    // Without the heartbeat a long-lived stream would age out of the set and
    // quietly hand its address a free extra connection.
    await redis().del(CAP());
    await claimStreamSlot(redis(), CAP(), "long-lived", 1, Date.now() - SLOT_TTL_MS + 500);
    await touchStreamSlot(redis(), CAP(), "long-lived");
    expect(await claimStreamSlot(redis(), CAP(), "newcomer", 1)).toBe(false);
    expect(await streamsHeld(redis(), CAP())).toBe(1);
  });

  it("does not double-count a reconnecting stream that reuses its id", async () => {
    await redis().del(CAP());
    await claimStreamSlot(redis(), CAP(), "same-conn", 2);
    await claimStreamSlot(redis(), CAP(), "same-conn", 2);
    expect(await streamsHeld(redis(), CAP())).toBe(1);
  });
});
