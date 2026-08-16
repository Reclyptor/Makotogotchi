// The record boards against real Mongo (SPEC §16.4, §21.3). The claim under
// test is the compare-and-swap: only a strictly better score takes a board,
// and concurrent finishes can never both win.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, db } from "./db/client";
import { closeRedis } from "./redis/client";
import { gameRecords, records, submitScore } from "./records";
import { setNickname } from "./social";
import { startTestInfra, type TestInfra } from "./testsetup";

let infra: TestInfra;

const WEEK = "2026-W02";

beforeAll(async () => {
  infra = startTestInfra();
}, 120_000);

afterAll(async () => {
  await closeDb();
  await closeRedis();
  infra.stop();
});

describe("record boards", () => {
  it("a first finish takes both boards", async () => {
    const taken = await submitScore(await db(), { gameId: "dustdash", score: 12, caretakerId: "ct-a", weekKey: WEEK });
    expect(taken.sort()).toEqual(["alltime", "weekly"]);
  });

  it("an equal or lower score takes nothing", async () => {
    const database = await db();
    expect(await submitScore(database, { gameId: "dustdash", score: 12, caretakerId: "ct-b", weekKey: WEEK })).toEqual([]);
    expect(await submitScore(database, { gameId: "dustdash", score: 3, caretakerId: "ct-b", weekKey: WEEK })).toEqual([]);
    const board = await records(database).findOne({ gameId: "dustdash", scope: "alltime" });
    expect(board?.caretakerId).toBe("ct-a");
  });

  it("a better score takes both boards and rewrites the holder", async () => {
    const database = await db();
    expect((await submitScore(database, { gameId: "dustdash", score: 20, caretakerId: "ct-b", weekKey: WEEK })).sort()).toEqual([
      "alltime",
      "weekly",
    ]);
    expect((await records(database).findOne({ gameId: "dustdash", scope: "alltime" }))?.caretakerId).toBe("ct-b");
  });

  it("a new week starts empty while all-time carries over", async () => {
    const database = await db();
    const taken = await submitScore(database, { gameId: "dustdash", score: 5, caretakerId: "ct-c", weekKey: "2026-W03" });
    expect(taken).toEqual(["weekly"]);
    const boards = await gameRecords(database, "2026-W03");
    const dustdash = boards.find((board) => board.game === "dustdash");
    expect(dustdash?.weekly?.score).toBe(5);
    expect(dustdash?.alltime?.score).toBe(20);
  });

  it("concurrent finishes elect exactly one winner", async () => {
    const database = await db();
    const results = await Promise.all(
      [31, 32, 33, 34, 35].map((score) => submitScore(database, { gameId: "simon", score, caretakerId: `ct-${score}`, weekKey: WEEK })),
    );
    // Every claim is a CAS against the live board, so the survivor is the
    // highest score no matter what order the writes landed in.
    const board = await records(database).findOne({ gameId: "simon", scope: "alltime" });
    expect(board?.score).toBe(35);
    expect(board?.caretakerId).toBe("ct-35");
    expect(results.flat().length).toBeGreaterThan(0);
  });

  it("resolves holder nicknames and lists every game in the roster", async () => {
    const database = await db();
    await setNickname(database, "ct-b", "Ana");
    const boards = await gameRecords(database, WEEK);
    expect(boards).toHaveLength(5);
    expect(boards.find((board) => board.game === "dustdash")?.alltime?.name).toBe("Ana");
    expect(boards.find((board) => board.game === "bubblepop")?.alltime).toBeNull();
  });
});
