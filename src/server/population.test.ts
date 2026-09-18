// The care multiplier counts people, not cookies, and weighs each of them by
// how much of the week they were actually here (SPEC §23.1): a caretaker who
// acted in the window counts only if they carry a nickname, because a
// nickname is unique and set once per person while cookies come one per
// device — and they count for the days they turned up, not for the whole
// week on the strength of one visit. Against real Mongo, since the figure is
// two collections joined and an aggregation.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, db } from "./db/client";
import { closeRedis } from "./redis/client";
import { activeCaretakers } from "./population";
import { recordContribution, setNickname } from "./social";
import { startTestInfra, type TestInfra } from "./testsetup";
import { BUDGET_WINDOW_DAYS, TICKS_PER_DAY } from "@/sim/tuning";

let infra: TestInfra;

beforeAll(async () => {
  infra = startTestInfra();
}, 120_000);

afterAll(async () => {
  await closeDb();
  await closeRedis();
  infra.stop();
});

const GENERATION = "gen-population";
const TODAY = 40 * TICKS_PER_DAY + 100;

const cared = async (caretakerId: string, tick: number): Promise<void> => {
  await recordContribution(await db(), { caretakerId, generationId: GENERATION, action: "FEED", applied: 10_000, tick });
};

describe("the active population", () => {
  it("counts the named caretakers who cared this week, and nobody else", async () => {
    const database = await db();
    await setNickname(database, "pop-ana", "PopAna");
    await setNickname(database, "pop-bo", "PopBo");
    await setNickname(database, "pop-idle", "PopIdle"); // named, never acted
    await cared("pop-ana", TODAY);
    await cared("pop-bo", TODAY - 3 * TICKS_PER_DAY);
    for (const cookie of ["pop-phone", "pop-laptop", "pop-incognito"]) await cared(cookie, TODAY); // acted, unnamed
    // Two people, one day each: two sevenths of a caretaker's week.
    expect(await activeCaretakers(database, TODAY)).toEqual({
      named: 2,
      presencePermille: Math.round((2 * 1000) / BUDGET_WINDOW_DAYS),
    });
  });

  it("ages a named caretaker out with the window", async () => {
    const database = await db();
    // Bo cared three days ago; four days on, that day falls off the seven-day
    // window and only Ana's is left.
    expect(await activeCaretakers(database, TODAY + 4 * TICKS_PER_DAY)).toMatchObject({ named: 1 });
    expect(await activeCaretakers(database, TODAY + BUDGET_WINDOW_DAYS * TICKS_PER_DAY)).toEqual({
      named: 0,
      presencePermille: 0,
    });
  });

  it("weighs a caretaker by the days they turned up, not by having turned up", async () => {
    const database = await db();
    // Far enough past the cases above that their week has long since aged out
    // — these files share one database.
    const day = (offset: number): number => TODAY + (60 + offset) * TICKS_PER_DAY;
    await setNickname(database, "pop-daily", "PopDaily");
    await setNickname(database, "pop-once", "PopOnce");
    // One regular here every day of the window, one visitor here for one of
    // them. The head count says two; the difficulty says one and a seventh.
    for (let offset = 0; offset < BUDGET_WINDOW_DAYS; offset++) await cared("pop-daily", day(offset));
    await cared("pop-once", day(0));

    const measured = await activeCaretakers(database, day(BUDGET_WINDOW_DAYS - 1));
    expect(measured.named).toBe(2);
    expect(measured.presencePermille).toBe(Math.round(((BUDGET_WINDOW_DAYS + 1) * 1000) / BUDGET_WINDOW_DAYS));
  });

  it("counts a day once however many times it was cared for, or in how many generations", async () => {
    const database = await db();
    const database2 = database;
    await setNickname(database, "pop-busy", "PopBusy");
    const tick = TODAY + 100 * TICKS_PER_DAY;
    for (let action = 0; action < 5; action++) await cared("pop-busy", tick);
    // A generation ending mid-day writes a second contribution row for the
    // same day; presence must not read that as two days of turning up.
    await recordContribution(await db(), {
      caretakerId: "pop-busy",
      generationId: "gen-population-next",
      action: "FEED",
      applied: 10_000,
      tick,
    });

    const measured = await activeCaretakers(database2, tick);
    expect(measured.named).toBe(1);
    expect(measured.presencePermille).toBe(Math.round(1000 / BUDGET_WINDOW_DAYS));
  });

  it("reaches a whole caretaker only for someone who was here all week", async () => {
    const database = await db();
    const base = TODAY + 140 * TICKS_PER_DAY;
    await setNickname(database, "pop-full", "PopFull");
    for (let offset = 0; offset < BUDGET_WINDOW_DAYS; offset++) {
      await cared("pop-full", base + offset * TICKS_PER_DAY);
    }
    expect(await activeCaretakers(database, base + (BUDGET_WINDOW_DAYS - 1) * TICKS_PER_DAY)).toEqual({
      named: 1,
      presencePermille: 1000,
    });
  });
});
