// Farewells (SPEC §2.10) are the one free-text field in the game, so the
// first half of this file is an attack list: every line here must be refused
// whole, never trimmed into acceptability. The second half runs the write
// path against real Mongo and Redis: one line per caretaker, replaced on a
// repeat, refused for a generation that is not sealed, announced on the bus.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, db } from "./db/client";
import { closeRedis, key, redisSubscriber } from "./redis/client";
import { generations, type GenerationDoc } from "./db/collections";
import { cleanFarewell, leaveFarewell, listFarewells, type FarewellView } from "./farewells";
import { setNickname } from "./social";
import { startTestInfra, type TestInfra } from "./testsetup";

const cp = (...codePoints: number[]): string => String.fromCodePoint(...codePoints);

describe("the farewell alphabet", () => {
  it("accepts a plain goodbye in any script", () => {
    expect(cleanFarewell("Sleep well, Makoto!")).toEqual({ ok: true, text: "Sleep well, Makoto!" });
    expect(cleanFarewell("Merci mon ami (2 semaines)")).toEqual({ ok: true, text: "Merci mon ami (2 semaines)" });
    expect(cleanFarewell("がんばったね")).toEqual({ ok: true, text: "がんばったね" });
    expect(cleanFarewell("  spaced   out  ")).toEqual({ ok: true, text: "spaced out" });
    expect(cleanFarewell("line\nbreak\tand" + cp(0xa0) + "nbsp")).toEqual({ ok: true, text: "line break and nbsp" });
  });

  it("refuses markup, scripts and everything that could become one", () => {
    const attacks = [
      "<script>alert(1)</script>",
      '"><img src=x onerror=alert(1)>',
      "javascript:alert(1)",
      "<b>bold</b>",
      "a & b",
      "back`tick`",
      "{{template}}",
      "${injection}",
      "path/../traversal",
      "semi;colon",
      // Fullwidth angle brackets fold to ASCII under NFKC, and are then refused as ASCII.
      cp(0xff1c) + "script" + cp(0xff1e),
    ];
    for (const attack of attacks) expect(cleanFarewell(attack), attack).toEqual({ ok: false, reason: "INVALID" });
  });

  it("refuses invisible and direction-changing characters rather than stripping them", () => {
    // Zero-width space, right-to-left override, zero-width joiner, a bidi
    // isolate, a bell, and a byte-order mark.
    const sneaky = ["Bye" + cp(0x200b) + "bye", cp(0x202e) + "bye", "bye" + cp(0x200d), "bye" + cp(0x2066), "bye" + cp(0x07), "bye" + cp(0xfeff)];
    for (const line of sneaky) expect(cleanFarewell(line), JSON.stringify(line)).toEqual({ ok: false, reason: "INVALID" });
  });

  it("holds the length, and refuses emoji", () => {
    expect(cleanFarewell("a")).toEqual({ ok: false, reason: "INVALID" });
    expect(cleanFarewell("ab").ok).toBe(true);
    expect(cleanFarewell("x".repeat(80)).ok).toBe(true);
    expect(cleanFarewell("x".repeat(81))).toEqual({ ok: false, reason: "INVALID" });
    expect(cleanFarewell("bye " + cp(0x1fa77))).toEqual({ ok: false, reason: "INVALID" });
  });

  it("screens the nickname blocklist word by word, save the pet's name", () => {
    expect(cleanFarewell("the admin was here")).toEqual({ ok: false, reason: "BLOCKED" });
    expect(cleanFarewell("Goodbye Makoto")).toEqual({ ok: true, text: "Goodbye Makoto" });
    expect(cleanFarewell("administer nothing").ok).toBe(true);
  });
});

describe("leaving a farewell", () => {
  let infra: TestInfra;
  const announced: FarewellView[][] = [];

  beforeAll(async () => {
    infra = startTestInfra();
    const subscriber = redisSubscriber();
    await subscriber.subscribe(key("events"));
    subscriber.on("message", (channel, payload) => {
      if (channel !== key("events")) return;
      const message = JSON.parse(payload) as { type: string; farewells?: FarewellView[] };
      if (message.type === "farewell" && message.farewells) announced.push(message.farewells);
    });
  }, 120_000);

  afterAll(async () => {
    await closeDb();
    await closeRedis();
    infra.stop();
  });

  const sealed = (id: string, ordinal: number, died: boolean): GenerationDoc => ({
    _id: id,
    ordinal,
    seed: 1,
    genesisEpochMs: 0,
    name: "Makoto",
    hatchedAtTick: 0,
    died: died ? { tick: 100, at: new Date(0), cause: "age" } : null,
    memorial: died ? { sealedAt: new Date(0), ranking: [], titles: [] } : null,
  });

  it("keeps one line per caretaker, the latest, with the name frozen in", async () => {
    const database = await db();
    await generations(database).insertOne(sealed("gen-farewell", 901, true));
    await setNickname(database, "ct-ana", "Ana");
    try {
      expect(await leaveFarewell(database, "gen-farewell", "ct-ana", "Sleep well")).toMatchObject({ ok: true });
      expect(await leaveFarewell(database, "gen-farewell", "ct-bo", "Best of pets")).toMatchObject({ ok: true });
      expect(await leaveFarewell(database, "gen-farewell", "ct-ana", "Sleep well, old friend")).toMatchObject({ ok: true });
      const lines = await listFarewells(database, "gen-farewell");
      expect(lines.map((line) => [line.name, line.text])).toEqual([
        ["Friend ct-b", "Best of pets"],
        ["Ana", "Sleep well, old friend"],
      ]);
      // Every landing announced the whole list.
      for (let attempt = 0; attempt < 50 && announced.length < 3; attempt++) await new Promise((r) => setTimeout(r, 20));
      expect(announced.length).toBeGreaterThanOrEqual(3);
      expect(announced[announced.length - 1]!.map((line) => line.text)).toEqual(["Best of pets", "Sleep well, old friend"]);
    } finally {
      await generations(database).deleteOne({ _id: "gen-farewell" });
    }
  });

  it("refuses a line that fails the alphabet, and a generation that is not sealed", async () => {
    const database = await db();
    await generations(database).insertOne(sealed("gen-alive", 902, false));
    try {
      expect(await leaveFarewell(database, "gen-alive", "ct-ana", "<script>")).toEqual({ ok: false, reason: "INVALID" });
      expect(await leaveFarewell(database, "gen-alive", "ct-ana", "Sleep well")).toEqual({ ok: false, reason: "NOT_MOURNING" });
      expect(await leaveFarewell(database, "gen-missing", "ct-ana", "Sleep well")).toEqual({ ok: false, reason: "NOT_MOURNING" });
    } finally {
      await generations(database).deleteOne({ _id: "gen-alive" });
    }
  });
});
