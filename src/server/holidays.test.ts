// A holiday against real Mongo (SPEC §22.11). The vote that would buy coins'
// worth of nothing is turned away, and a ticket that predates the rule is
// paid back — exactly what was spent, and only once.

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { daysFromCivil } from "@/sim/clock";
import { VENUE_TICKET_COINS } from "@/sim/atmosphere";
import { ballots } from "./ballot";
import { closeDb, db } from "./db/client";
import { holidayRefundMarkers, settleHolidayRefund } from "./holidays";
import { closeRedis } from "./redis/client";
import { voteForTomorrow } from "./shop";
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

afterEach(() => {
  vi.useRealTimers();
});

const OCT_30 = daysFromCivil(2026, 10, 30);
const OCT_31 = daysFromCivil(2026, 10, 31);
/** 2026-10-30T12:00-05:00, the pet's day before Halloween. */
const OCT_30_NOON = 1_793_379_600_000;

const coinsOf = async (id: string): Promise<number> => (await caretakerProfile(await db(), id))?.coins ?? 0;

describe("voting on the eve of a holiday", () => {
  it("turns the vote away and charges nothing", async () => {
    const database = await db();
    await creditCoins(database, "ct-eve", 100);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(OCT_30_NOON);

    const result = await voteForTomorrow(database, "ct-eve", "meadow", 3);

    expect(result).toEqual({ ok: false, reason: "HOLIDAY", holidayId: "halloween" });
    expect(await coinsOf("ct-eve")).toBe(100);
    expect(await ballots(database).findOne({ _id: OCT_31 })).toBeNull();
  });

  it("still takes a vote for an ordinary day", async () => {
    const database = await db();
    await creditCoins(database, "ct-ordinary", 100);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(OCT_30_NOON - 5 * 86_400_000);

    const result = await voteForTomorrow(database, "ct-ordinary", "meadow", 3);

    expect(result).toMatchObject({ ok: true, spent: 3 * VENUE_TICKET_COINS });
  });
});

describe("the holiday refund", () => {
  const seedBallot = async (forDay: number, spent: Record<string, number>): Promise<void> => {
    await ballots(await db()).insertOne({ _id: forDay, tickets: { meadow: 5 }, spent, createdAt: new Date() });
  };

  it("pays each caretaker exactly what they spent, once, across two leaders", async () => {
    const database = await db();
    await seedBallot(OCT_31, { "refund-a": 30, "refund-b": 10 });

    const [first, second] = await Promise.all([settleHolidayRefund(database, OCT_31), settleHolidayRefund(database, OCT_31)]);

    expect([first, second].filter((result) => result !== null)).toHaveLength(1);
    expect(first ?? second).toEqual(["refund-a", "refund-b"]);
    expect(await coinsOf("refund-a")).toBe(30);
    expect(await coinsOf("refund-b")).toBe(10);

    expect(await settleHolidayRefund(database, OCT_31)).toBeNull();
    expect(await coinsOf("refund-a")).toBe(30);
    expect(await holidayRefundMarkers(database).countDocuments({ _id: `holiday-refund:${OCT_31}` })).toBe(1);
  });

  it("pays nothing on an ordinary day, and claims nothing", async () => {
    const database = await db();
    await seedBallot(OCT_30, { "refund-ordinary": 20 });

    expect(await settleHolidayRefund(database, OCT_30)).toBeNull();

    expect(await coinsOf("refund-ordinary")).toBe(0);
    expect(await holidayRefundMarkers(database).countDocuments({ _id: `holiday-refund:${OCT_30}` })).toBe(0);
  });
});
