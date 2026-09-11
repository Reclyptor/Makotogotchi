// Co-op purchases against real Mongo (SPEC §16.4, §21.8). The arithmetic is
// pure and tested directly; the pool is tested for the two things that would
// cost people real coins — an overshoot that is not refunded, and an item
// that gets placed twice.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, db } from "./db/client";
import { closeRedis } from "./redis/client";
import { clampContribution, contribute, FAMILY_WALL_SLOTS, fundingOverflow, fundingState, GRAND_ITEMS, roomState } from "./shop";
import { generations, type GenerationDoc } from "./db/collections";
import { caretakerProfile, creditCoins } from "./social";
import { startTestInfra, type TestInfra } from "./testsetup";

let infra: TestInfra;

beforeAll(async () => {
  infra = startTestInfra();
}, 120_000);

afterAll(async () => {
  await closeDb();
  await closeRedis();
  infra.stop();
});

describe("contribution arithmetic", () => {
  it("never lands more than the giver has or the pool needs", () => {
    expect(clampContribution({ offered: 50, pooled: 0, price: 500, balance: 500 })).toBe(50);
    expect(clampContribution({ offered: 50, pooled: 0, price: 500, balance: 12 })).toBe(12); // broke
    expect(clampContribution({ offered: 50, pooled: 480, price: 500, balance: 500 })).toBe(20); // nearly there
    expect(clampContribution({ offered: 50, pooled: 500, price: 500, balance: 500 })).toBe(0); // done
    expect(clampContribution({ offered: -10, pooled: 0, price: 500, balance: 500 })).toBe(0); // no taking
  });

  it("reports exactly the overshoot, and nothing when there is none", () => {
    expect(fundingOverflow(500, 500)).toBe(0);
    expect(fundingOverflow(460, 500)).toBe(0);
    expect(fundingOverflow(530, 500)).toBe(30);
  });
});

describe("funding a grand item", () => {
  const price = GRAND_ITEMS.window_seat.price;

  it("pools two caretakers' coins and places the item exactly once", async () => {
    const database = await db();
    await creditCoins(database, "ct-rich", price);
    await creditCoins(database, "ct-poor", 60);

    const first = await contribute(database, "ct-poor", "window_seat", 50);
    expect(first).toMatchObject({ ok: true, spent: 50, pooled: 50, funded: false });

    // "all" tops the pool up to the price, never past it.
    const second = await contribute(database, "ct-rich", "window_seat", "all");
    expect(second).toMatchObject({ ok: true, spent: price - 50, pooled: price, funded: true });
    if (second.ok) {
      expect(second.top[0]).toEqual({ caretakerId: "ct-rich", amount: price - 50 });
      expect(second.top[1]).toEqual({ caretakerId: "ct-poor", amount: 50 });
    }

    // The item is communal decor, the rich giver kept their change, and a
    // late contribution finds the pool closed.
    expect((await roomState(database)).decor).toContain("window_seat");
    expect((await caretakerProfile(database, "ct-rich"))?.coins).toBe(50);
    expect(await contribute(database, "ct-rich", "window_seat", 10)).toMatchObject({ ok: false, reason: "ALREADY_FUNDED" });
  });

  it("refuses the broke and refuses items that are not fundable", async () => {
    const database = await db();
    expect(await contribute(database, "ct-nobody", "aquarium", 50)).toMatchObject({ ok: false, reason: "INSUFFICIENT_COINS" });
    expect(await contribute(database, "ct-nobody", "plant", 10)).toMatchObject({ ok: false, reason: "UNKNOWN_ITEM" });
  });

  it("refunds every coin that overshoots the price, even under a race", async () => {
    const database = await db();
    const aquarium = GRAND_ITEMS.aquarium.price;
    const givers = ["ct-r1", "ct-r2", "ct-r3"];
    for (const giver of givers) await creditCoins(database, giver, aquarium);

    // Everyone offers everything at once: the pool takes the price, and the
    // rest goes home.
    await Promise.all(givers.map((giver) => contribute(database, giver, "aquarium", "all")));

    const pool = (await fundingState(database)).find((entry) => entry.itemId === "aquarium");
    expect(pool?.funded).toBe(true);
    expect(pool?.pooled).toBe(aquarium);

    let spent = 0;
    for (const giver of givers) spent += aquarium - ((await caretakerProfile(database, giver))?.coins ?? 0);
    expect(spent).toBe(aquarium);
    expect((await roomState(database)).decor).toContain("aquarium");
  });
});

// The family wall (SPEC §22.10) reads the sealed generations with the room:
// newest first, only the dead, only as many as the wall has slots.
describe("the room's ancestors", () => {
  const generation = (ordinal: number, name: string | null, died: boolean): GenerationDoc => ({
    _id: `gen-wall-${ordinal}`,
    ordinal,
    seed: ordinal,
    genesisEpochMs: 0,
    name,
    hatchedAtTick: 0,
    died: died ? { tick: 100, at: new Date(0), cause: "age" } : null,
    memorial: died ? { sealedAt: new Date(0), ranking: [], titles: [] } : null,
  });

  it("hangs the dead newest first, names the unnamed, and stops at the wall's slots", async () => {
    const database = await db();
    const docs = [
      ...Array.from({ length: FAMILY_WALL_SLOTS + 2 }, (_, i) => generation(100 + i, i === 3 ? null : `Gen${100 + i}`, true)),
      generation(200, "Alive", false),
    ];
    await generations(database).insertMany(docs);
    try {
      const { ancestors } = await roomState(database);
      expect(ancestors).toHaveLength(FAMILY_WALL_SLOTS);
      expect(ancestors[0]).toEqual({ ordinal: 100 + FAMILY_WALL_SLOTS + 1, name: `Gen${100 + FAMILY_WALL_SLOTS + 1}` });
      expect(ancestors.map((a) => a.ordinal)).toEqual([...ancestors.map((a) => a.ordinal)].sort((a, b) => b - a));
      expect(ancestors.some((a) => a.name === "Alive")).toBe(false);
      expect(ancestors.find((a) => a.ordinal === 103)?.name).toBe("Unnamed");
    } finally {
      await generations(database).deleteMany({ _id: { $in: docs.map((doc) => doc._id) } });
    }
  });
});
