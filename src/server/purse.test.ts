// The purse actually reaching the channel (SPEC §7.2, §13.1), against real
// Mongo and real Redis (SPEC §16.4).
//
// The thing worth testing is not that a publish function publishes — it is
// that every *writer* of coins and inventory does. A balance that has quietly
// stopped being announced looks exactly like one that is up to date, and the
// only way that shows up is by exercising each writer and listening.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, db } from "./db/client";
import { closeRedis, key, redisSubscriber } from "./redis/client";
import { consumeItem, purchase, refundItem } from "./shop";
import { caretakerProfile, creditCoins, recordContribution } from "./social";
import { startTestInfra, type TestInfra } from "./testsetup";
import type { PurseMessage } from "./engine/messages";

let infra: TestInfra;
const seen: PurseMessage[] = [];

beforeAll(async () => {
  infra = startTestInfra();
  const subscriber = redisSubscriber();
  await subscriber.subscribe(key("events"));
  subscriber.on("message", (channel, payload) => {
    if (channel !== key("events")) return;
    const message = JSON.parse(payload) as { type: string };
    if (message.type === "purse") seen.push(message as PurseMessage);
  });
}, 120_000);

afterAll(async () => {
  await closeDb();
  await closeRedis();
  infra.stop();
});

/**
 * Wait for a purse that looks like this. Delivery is asynchronous and a
 * caretaker may have several announcements in flight — the setup credit and
 * the spend under test, say — so tests wait for the state they mean rather
 * than for "the next message", which is what makes them ordering-proof.
 */
const purseFor = async (
  caretakerId: string,
  matches: (purse: PurseMessage) => boolean = () => true,
): Promise<PurseMessage> => {
  const deadline = Date.now() + 3000;
  for (;;) {
    const hit = seen.filter((message) => message.caretakerId === caretakerId).findLast(matches);
    if (hit) return hit;
    if (Date.now() > deadline) {
      throw new Error(`no matching purse for ${caretakerId}; saw ${JSON.stringify(seen.filter((m) => m.caretakerId === caretakerId))}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
};

const countFor = (caretakerId: string): number => seen.filter((message) => message.caretakerId === caretakerId).length;

describe("every writer announces the purse it just changed", () => {
  it("credits — a bonus, a payout, a refunded overshoot", async () => {
    await creditCoins(await db(), "ct-credit", 250);
    expect(await purseFor("ct-credit")).toMatchObject({ coins: 250, inventory: {} });
  });

  it("earning from care, which is the balance's most common mover", async () => {
    await recordContribution(await db(), {
      caretakerId: "ct-care",
      generationId: "gen-purse",
      action: "FEED",
      applied: 120_000,
      tick: 10,
    });
    const announced = await purseFor("ct-care");
    expect(announced.coins).toBeGreaterThan(0);
  });

  it("spending, and the pack the spend filled", async () => {
    const database = await db();
    await creditCoins(database, "ct-spend", 1000);
    const result = await purchase(database, "ct-spend", "pepper_treat", { installedToys: [] });
    expect(result.ok).toBe(true);
    // 1000 − 60 for the treat, and the treat itself now in the pack.
    expect(await purseFor("ct-spend", (purse) => purse.coins === 940)).toMatchObject({
      coins: 940,
      inventory: { pepper_treat: 1 },
    });
  });

  it("using an item out of the pack, and handing it back when the sim refuses", async () => {
    const database = await db();
    await creditCoins(database, "ct-use", 1000);
    await purchase(database, "ct-use", "pepper_treat", { installedToys: [] });

    expect(await consumeItem(database, "ct-use", "pepper_treat")).toBe(true);
    await purseFor("ct-use", (purse) => purse.inventory.pepper_treat === 0);

    await refundItem(database, "ct-use", "pepper_treat");
    await purseFor("ct-use", (purse) => purse.inventory.pepper_treat === 1);
  });

  it("says nothing when a spend was refused — nothing moved", async () => {
    const database = await db();
    await creditCoins(database, "ct-broke", 10);
    // Wait for the setup's own announcement to land, so what we count after
    // this point is only what the refused purchase did or did not say.
    await purseFor("ct-broke", (purse) => purse.coins === 10);
    const before = countFor("ct-broke");

    const result = await purchase(database, "ct-broke", "super_medicine", { installedToys: [] });
    expect(result).toMatchObject({ ok: false, reason: "INSUFFICIENT_COINS" });
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(countFor("ct-broke")).toBe(before);
  });

  it("announces the balance the database actually holds", async () => {
    const database = await db();
    await creditCoins(database, "ct-truth", 137);
    await creditCoins(database, "ct-truth", 63);
    const announced = await purseFor("ct-truth", (purse) => purse.coins === 200);
    expect(announced.coins).toBe((await caretakerProfile(database, "ct-truth"))?.coins);
    expect(announced.coins).toBe(200);
  });
});
