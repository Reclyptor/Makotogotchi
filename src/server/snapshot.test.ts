// Room cache coherence across the fleet (SPEC §7.2, §16.4).
//
// The defect this pins only appears with more than one replica, which is
// exactly why it survived so long: the writer dropped its own cached room
// and every other pod kept serving the old one until its TTL ran out — while
// the broadcast saying the room had changed was already reaching those pods'
// clients. The cache was contradicting a message the browser had in hand.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { primeRoomCache, invalidateRoomCache, snapshotPayload } from "./snapshot";
import { closeDb, db } from "./db/client";
import { closeRedis } from "./redis/client";
import { roomState } from "./shop";
import { startTestInfra, type TestInfra } from "./testsetup";
import { hatchedState, testCtx, TEST_GENERATION } from "@/sim/testkit";
import type { RoomView } from "./shop";

let infra: TestInfra;

beforeAll(async () => {
  infra = startTestInfra();
}, 120_000);

afterAll(async () => {
  await closeDb();
  await closeRedis();
  infra.stop();
});

const ANOTHER_PODS_ROOM: RoomView = {
  decor: ["kotatsu", "mountain"],
  activeCosmetic: "crown",
  cosmetics: ["crown"],
  activeTheme: "cabin",
  themes: ["cozy", "cabin"],
  ballots: [{ forDay: 20_700, tickets: { mountain: 6 } }],
  ancestors: [{ ordinal: 3, name: "Mochi" }],
};

describe("the room cache", () => {
  it("serves what the broadcast carried, without going back to Mongo", async () => {
    // Prime with a room that is deliberately NOT what the database holds:
    // if the payload came from a read rather than from the broadcast, this
    // is the assertion that notices.
    const stored = await roomState(await db());
    expect(stored.decor).not.toEqual(ANOTHER_PODS_ROOM.decor);

    primeRoomCache(ANOTHER_PODS_ROOM);
    const payload = await snapshotPayload(hatchedState(testCtx()), TEST_GENERATION);

    expect(payload.room).toEqual(ANOTHER_PODS_ROOM);
  });

  it("falls back to the database once the cache is dropped", async () => {
    primeRoomCache(ANOTHER_PODS_ROOM);
    invalidateRoomCache();

    const payload = await snapshotPayload(hatchedState(testCtx()), TEST_GENERATION);
    const stored = await roomState(await db());

    expect(payload.room.decor).toEqual(stored.decor);
    expect(payload.room.decor).not.toEqual(ANOTHER_PODS_ROOM.decor);
  });
});
