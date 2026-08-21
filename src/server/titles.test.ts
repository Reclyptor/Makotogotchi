// Contested titles (SPEC §24) against real Mongo: counts increment, claims
// are strict-exceed CAS, ties keep the incumbent, a concurrent first claim
// yields exactly one holder, and a takeover names the TRUE prior holder.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, db } from "./db/client";
import { closeRedis } from "./redis/client";
import { classifyTitles, NIGHT_END_HOUR, settleTitles, titleHolders, takeoverMessages } from "./titles";
import { quirks } from "@/sim/quirks";
import { startTestInfra, type TestInfra } from "./testsetup";

let infra: TestInfra;
const GEN = "gen-titles-test";
const SEED = 0xc0ffee;

beforeAll(async () => {
  infra = startTestInfra();
  await db();
}, 120_000);

afterAll(async () => {
  await closeDb();
  await closeRedis();
  infra.stop();
});

describe("classifyTitles (SPEC §24.1)", () => {
  const base = { seed: SEED, localHour: 12, becameAsleep: false, wantFulfilled: false } as const;

  it("counts any accepted action at night, not just medicine", () => {
    expect(classifyTitles({ ...base, action: "PET", localHour: 0 })).toContain("night-nurse");
    expect(classifyTitles({ ...base, action: "MEDICATE", localHour: NIGHT_END_HOUR - 1 })).toContain("night-nurse");
    expect(classifyTitles({ ...base, action: "PET", localHour: NIGHT_END_HOUR })).not.toContain("night-nurse");
    expect(classifyTitles({ ...base, action: "PET", localHour: 23 })).not.toContain("night-nurse");
  });

  it("credits the chef only for the generation's favorite dish", () => {
    const { favoriteFood, dislikedFood } = quirks(SEED);
    expect(classifyTitles({ ...base, action: "FEED", itemId: favoriteFood })).toContain("chef");
    expect(classifyTitles({ ...base, action: "FEED", itemId: dislikedFood })).not.toContain("chef");
    expect(classifyTitles({ ...base, action: "FEED" })).not.toContain("chef");
  });

  it("credits the sandman only when the lullaby actually worked", () => {
    expect(classifyTitles({ ...base, action: "LULLABY", becameAsleep: true })).toContain("sandman");
    expect(classifyTitles({ ...base, action: "LULLABY" })).not.toContain("sandman");
  });

  it("maps the rest of the roster", () => {
    expect(classifyTitles({ ...base, action: "CLEAN" })).toContain("groundskeeper");
    expect(classifyTitles({ ...base, action: "PET" })).toContain("cuddler");
    expect(classifyTitles({ ...base, action: "PET", wantFulfilled: true })).toContain("wish-granter");
  });
});

describe("settleTitles (SPEC §24.2–24.3)", () => {
  it("first claim and self-raises stay silent; a strict excess takes the title, naming the true loser", async () => {
    const database = await db();

    // Ana pets twice — first claim, then a self-raise: no announcements.
    expect(await settleTitles(database, GEN, "ana", ["cuddler"])).toEqual([]);
    expect(await settleTitles(database, GEN, "ana", ["cuddler"])).toEqual([]);
    expect(await titleHolders(database, GEN)).toEqual([{ titleId: "cuddler", caretakerId: "ana", value: 2 }]);

    // Emilio matches — a tie keeps the incumbent.
    await settleTitles(database, GEN, "emilio", ["cuddler"]);
    expect(await settleTitles(database, GEN, "emilio", ["cuddler"])).toEqual([]);
    expect((await titleHolders(database, GEN))[0]?.caretakerId).toBe("ana");

    // The third pet strictly exceeds: takeover, naming Ana as the loser.
    const takeovers = await settleTitles(database, GEN, "emilio", ["cuddler"]);
    expect(takeovers).toEqual([{ titleId: "cuddler", caretakerId: "emilio", previousId: "ana", value: 3 }]);
    const messages = await takeoverMessages(database, takeovers);
    expect(messages[0]).toMatchObject({ type: "title", titleId: "cuddler", previousName: "Friend ana" });
  });

  it("a concurrent first claim installs exactly one holder and announces nothing", async () => {
    const database = await db();
    const results = await Promise.all([
      settleTitles(database, `${GEN}-race`, "ana", ["groundskeeper"]),
      settleTitles(database, `${GEN}-race`, "emilio", ["groundskeeper"]),
    ]);
    expect(results.flat()).toEqual([]);
    const holders = await titleHolders(database, `${GEN}-race`);
    expect(holders).toHaveLength(1);
    expect(holders[0]?.value).toBe(1);

    // The race loser's count is already 1, so one more action strictly
    // exceeds the holder — a takeover naming the true prior holder.
    const loser = holders[0]?.caretakerId === "ana" ? "emilio" : "ana";
    const takeovers = await settleTitles(database, `${GEN}-race`, loser, ["groundskeeper"]);
    expect(takeovers).toEqual([
      { titleId: "groundskeeper", caretakerId: loser, previousId: holders[0]?.caretakerId, value: 2 },
    ]);
  });

  it("titles are scoped per generation", async () => {
    const database = await db();
    await settleTitles(database, `${GEN}-b`, "ana", ["chef"]);
    const holders = await titleHolders(database, `${GEN}-b`);
    expect(holders).toEqual([{ titleId: "chef", caretakerId: "ana", value: 1 }]);
    expect((await titleHolders(database, GEN)).some((holder) => holder.titleId === "chef")).toBe(false);
  });
});
