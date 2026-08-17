// Presence against real Redis (SPEC §16.4). The bug this pins was a refresh
// showing "0 watching": presence was keyed by caretaker, so the outgoing
// stream's cancel evicted the incoming stream that had already replaced it.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeRedis, key, redis } from "./redis/client";
import { dropPresence, listPresence, shouldBroadcastPresence, touchPresence } from "./presence";
import { startTestInfra, type TestInfra } from "./testsetup";

let infra: TestInfra;
const PRESENCE = () => key("presence");

beforeAll(async () => {
  infra = startTestInfra();
  await redis().del(PRESENCE());
}, 120_000);

afterAll(async () => {
  await closeRedis();
  infra.stop();
});

describe("presence", () => {
  it("counts a caretaker once however many streams they hold", async () => {
    await redis().del(PRESENCE());
    await touchPresence(redis(), PRESENCE(), "ct-a", "conn-1");
    await touchPresence(redis(), PRESENCE(), "ct-a", "conn-2");
    await touchPresence(redis(), PRESENCE(), "ct-b", "conn-3");
    expect(await listPresence(redis(), PRESENCE())).toEqual(["ct-a", "ct-b"]);
  });

  it("survives a refresh: the new stream outlives the old one's cancel", async () => {
    await redis().del(PRESENCE());
    // The tab being replaced.
    await touchPresence(redis(), PRESENCE(), "ct-a", "old");
    expect(await listPresence(redis(), PRESENCE())).toEqual(["ct-a"]);
    // The reload connects before the browser tears the old EventSource down,
    // so the drop lands *after* the replacement has registered.
    await touchPresence(redis(), PRESENCE(), "ct-a", "new");
    await dropPresence(redis(), PRESENCE(), "ct-a", "old");
    expect(await listPresence(redis(), PRESENCE())).toEqual(["ct-a"]);
  });

  it("forgets a caretaker once their last stream closes", async () => {
    await redis().del(PRESENCE());
    await touchPresence(redis(), PRESENCE(), "ct-a", "conn-1");
    await touchPresence(redis(), PRESENCE(), "ct-a", "conn-2");
    await dropPresence(redis(), PRESENCE(), "ct-a", "conn-1");
    expect(await listPresence(redis(), PRESENCE())).toEqual(["ct-a"]);
    await dropPresence(redis(), PRESENCE(), "ct-a", "conn-2");
    expect(await listPresence(redis(), PRESENCE())).toEqual([]);
  });

  it("prunes streams that stopped heartbeating", async () => {
    await redis().del(PRESENCE());
    await touchPresence(redis(), PRESENCE(), "ct-live", "conn-1");
    // A stream last seen well past the 45s TTL, written straight to the set.
    await redis().zadd(PRESENCE(), String(Date.now() - 120_000), "ct-gone|conn-2");
    expect(await listPresence(redis(), PRESENCE())).toEqual(["ct-live"]);
  });

  it("lets exactly one caller through the broadcast window", async () => {
    const guard = key("presence-guard-test");
    await redis().del(guard);
    const winners = await Promise.all(Array.from({ length: 5 }, () => shouldBroadcastPresence(redis(), guard)));
    expect(winners.filter(Boolean)).toHaveLength(1);
  });
});
