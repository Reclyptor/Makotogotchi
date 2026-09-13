// The care multiplier counts people, not cookies (SPEC §23.1): a caretaker
// who acted in the window counts only if they carry a nickname, because a
// nickname is unique and set once per person while cookies come one per
// device. Against real Mongo, since the count is two collections joined.

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
    expect(await activeCaretakers(database, TODAY)).toBe(2);
  });

  it("ages a named caretaker out with the window", async () => {
    const database = await db();
    // Bo cared three days ago; four days on, that day falls off the seven-day
    // window and only Ana's is left.
    expect(await activeCaretakers(database, TODAY + 4 * TICKS_PER_DAY)).toBe(1);
    expect(await activeCaretakers(database, TODAY + BUDGET_WINDOW_DAYS * TICKS_PER_DAY)).toBe(0);
  });
});
