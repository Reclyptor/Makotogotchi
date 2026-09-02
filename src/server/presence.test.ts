// Presence against real Redis (SPEC §16.4). The bug this pins was a refresh
// showing "0 watching": presence was keyed by caretaker, so the outgoing
// stream's cancel evicted the incoming stream that had already replaced it.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeRedis, key, redis } from "./redis/client";
import { dropPresence, listPresence, PresenceBroadcaster, shouldBroadcastPresence, touchPresence } from "./presence";
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

// The throttle's timing is tested against a stub window rather than the real
// 2s Redis guard: the guard itself is covered above, and a unit that waits
// two real windows per case is a unit nobody runs.
describe("the presence broadcast throttle", () => {
  const WINDOW = 40;
  const settle = (windows = 2): Promise<void> => new Promise((resolve) => setTimeout(resolve, WINDOW * windows + 20));

  /** `SET guard PX WINDOW NX`: claiming holds the window for its full term. */
  const stubWindow = () => {
    let heldUntil = 0;
    return async (): Promise<boolean> => {
      if (Date.now() < heldUntil) return false;
      heldUntil = Date.now() + WINDOW;
      return true;
    };
  };

  it("publishes the first request immediately", async () => {
    let published = 0;
    const broadcaster = new PresenceBroadcaster(stubWindow(), async () => void published++, WINDOW);
    await broadcaster.request();
    expect(published).toBe(1);
    broadcaster.cancel();
  });

  it("takes a handed-over payload for the leading publish and reads fresh for the trailing one", async () => {
    // A connecting stream has already assembled the presence view for its own
    // hello, so it offers that instead of paying for an identical second one.
    // The trailing publish must NOT reuse it: it fires a window later
    // precisely because something has changed since, which makes the view it
    // was offered the one thing it must not send.
    const seen: (string | undefined)[] = [];
    const broadcaster = new PresenceBroadcaster<string>(
      stubWindow(),
      async (precomputed) => void seen.push(precomputed),
      WINDOW,
    );

    await broadcaster.request("the joining stream's own view");
    expect(seen).toEqual(["the joining stream's own view"]);

    // A second join inside the same window loses and arms the trailing one.
    await broadcaster.request("a view that is stale by the time it fires");
    await settle();

    expect(seen).toHaveLength(2);
    expect(seen[1]).toBeUndefined(); // read fresh, not the payload it was handed
    broadcaster.cancel();
  });

  it("publishes once more after the window closes, however many were dropped", async () => {
    let published = 0;
    const broadcaster = new PresenceBroadcaster(stubWindow(), async () => void published++, WINDOW);
    await broadcaster.request(); // leading — the room's first join
    expect(published).toBe(1);
    // A burst of joins and leaves, all inside the same window.
    await broadcaster.request();
    await broadcaster.request();
    await broadcaster.request();
    expect(published).toBe(1);

    await settle();
    // Exactly one trailing publish: the burst folded into a single message,
    // and the last state of the window still reached every screen.
    expect(published).toBe(2);
    broadcaster.cancel();
  });

  it("goes quiet once the last change has been published", async () => {
    let published = 0;
    const broadcaster = new PresenceBroadcaster(stubWindow(), async () => void published++, WINDOW);
    await broadcaster.request();
    await broadcaster.request();
    await settle();
    expect(published).toBe(2);
    // Nothing further happened, so nothing further is published.
    await settle(3);
    expect(published).toBe(2);
    broadcaster.cancel();
  });

  it("keeps trying instead of giving up while another pod holds the window", async () => {
    let free = false;
    let published = 0;
    const broadcaster = new PresenceBroadcaster(
      async () => free,
      async () => void published++,
      WINDOW,
    );
    await broadcaster.request();
    expect(published).toBe(0);
    await settle();
    expect(published).toBe(0);
    // The moment the window frees up, the change everyone is missing lands.
    free = true;
    await settle(2);
    expect(published).toBe(1);
    broadcaster.cancel();
  });
});
