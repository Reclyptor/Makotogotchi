// The venue ballot against real Mongo (SPEC §22.9). The draw itself is pure
// and tested in src/sim; what is tested here is the half that can cost people
// real coins — a ticket charged for but never seated, a cap that leaks under
// concurrency, and a vote that reaches back and rewrites a day already drawn.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { BALLOT_MAX_EXTRA_TICKETS, VENUE_TICKET_COINS, venueAt } from "@/sim/atmosphere";
import { ballots, ballotsAround, clampTickets, voteForVenue } from "./ballot";
import { closeDb, db } from "./db/client";
import { closeRedis } from "./redis/client";
import { spendCoins } from "./shop";
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

/** A ballot day of its own per test, so no two tests share a row. */
let day = 500_000;
beforeEach(() => {
  day += 10;
});

const richCaretaker = async (id: string, coins: number): Promise<void> => {
  const database = await db();
  await creditCoins(database, id, coins);
};

/** The real charge path, so the concurrency test exercises the atomic
 *  balance filter rather than a stand-in that cannot lose a race. */
const spendFor = (id: string) => async (coins: number): Promise<boolean> => spendCoins(await db(), id, coins);

describe("ticket arithmetic", () => {
  it("never sells more than the cap allows or the purse can pay for", () => {
    expect(clampTickets({ wanted: 5, held: 0, balance: 500 })).toBe(5);
    expect(clampTickets({ wanted: 5, held: 0, balance: 25 })).toBe(2); // 10 coins each
    expect(clampTickets({ wanted: 5, held: BALLOT_MAX_EXTRA_TICKETS - 2, balance: 500 })).toBe(2); // nearly full
    expect(clampTickets({ wanted: 5, held: BALLOT_MAX_EXTRA_TICKETS, balance: 500 })).toBe(0); // full
    expect(clampTickets({ wanted: -3, held: 0, balance: 500 })).toBe(0); // no taking tickets back
  });
});

describe("voting", () => {
  it("buys tomorrow's tickets and leaves today's day alone", async () => {
    const database = await db();
    await richCaretaker("ct-vote-a", 200);

    const today = day - 1;
    await ballots(database).insertOne({ _id: today, tickets: { meadow: 4 }, spent: {}, createdAt: new Date() });
    const before = venueAt(3, today, ["garden", "meadow"], { meadow: 4 });

    const result = await voteForVenue(database, "ct-vote-a", "garden", 3, day, 200, spendFor("ct-vote-a"));
    expect(result).toMatchObject({ ok: true, tickets: 3, spent: 30 });

    // Today's row is untouched, so the scene on screen does not move.
    const rows = await ballotsAround(database, today);
    expect(rows.find((row) => row.forDay === today)?.tickets).toEqual({ meadow: 4 });
    expect(venueAt(3, today, ["garden", "meadow"], { meadow: 4 })).toBe(before);
  });

  it("holds the cap under concurrent votes without charging for what did not fit", async () => {
    const database = await db();
    // Forty single-ticket votes at once against a thirty-ticket ceiling: ten
    // of them must land nothing AND pay nothing. This is the test that would
    // have caught charging before the ticket was claimed.
    const attempts = 40;
    await richCaretaker("ct-vote-b", attempts * VENUE_TICKET_COINS);

    const results = await Promise.all(
      Array.from({ length: attempts }, () =>
        voteForVenue(database, "ct-vote-b", "meadow", 1, day, attempts * VENUE_TICKET_COINS, spendFor("ct-vote-b")),
      ),
    );

    const row = await ballots(database).findOne({ _id: day });
    expect(row?.tickets.meadow).toBe(BALLOT_MAX_EXTRA_TICKETS);
    const landed = results.filter((result) => result.ok).length;
    expect(landed).toBe(BALLOT_MAX_EXTRA_TICKETS);

    // Exactly the seated tickets were paid for — no more, no less.
    const spent = attempts * VENUE_TICKET_COINS - ((await caretakerProfile(database, "ct-vote-b"))?.coins ?? 0);
    expect(spent).toBe(BALLOT_MAX_EXTRA_TICKETS * VENUE_TICKET_COINS);
    expect(row?.spent["ct-vote-b"]).toBe(BALLOT_MAX_EXTRA_TICKETS * VENUE_TICKET_COINS);
  });

  it("refuses a voter who cannot pay and leaves the ballot exactly as it was", async () => {
    const database = await db();
    await richCaretaker("ct-vote-rich", 100);
    await voteForVenue(database, "ct-vote-rich", "garden", 4, day, 100, spendFor("ct-vote-rich"));

    // A balance that has already gone by the time the charge lands.
    const broke = async (): Promise<boolean> => false;
    const result = await voteForVenue(database, "ct-vote-poor", "garden", 5, day, 500, broke);

    expect(result).toEqual({ ok: false, reason: "INSUFFICIENT_COINS" });
    const row = await ballots(database).findOne({ _id: day });
    expect(row?.tickets.garden).toBe(4);
    expect(row?.spent["ct-vote-poor"]).toBeUndefined();
  });

  it("reports a full ballot rather than quietly taking the coins", async () => {
    const database = await db();
    await richCaretaker("ct-vote-c", 1000);
    await voteForVenue(database, "ct-vote-c", "pond", BALLOT_MAX_EXTRA_TICKETS, day, 1000, spendFor("ct-vote-c"));
    const before = (await caretakerProfile(database, "ct-vote-c"))?.coins ?? 0;

    const result = await voteForVenue(database, "ct-vote-c", "pond", 5, day, before, spendFor("ct-vote-c"));

    expect(result).toEqual({ ok: false, reason: "BALLOT_FULL" });
    expect((await caretakerProfile(database, "ct-vote-c"))?.coins).toBe(before);
  });

  it("keeps each day's ballot to itself, so no vote rewrites a day already drawn", async () => {
    const database = await db();
    await richCaretaker("ct-vote-d", 300);
    await voteForVenue(database, "ct-vote-d", "shrine", 2, day, 300, spendFor("ct-vote-d"));
    await voteForVenue(database, "ct-vote-d", "beach", 3, day + 1, 300, spendFor("ct-vote-d"));

    expect((await ballots(database).findOne({ _id: day }))?.tickets).toEqual({ shrine: 2 });
    expect((await ballots(database).findOne({ _id: day + 1 }))?.tickets).toEqual({ beach: 3 });
  });
});

describe("the broadcast window", () => {
  it("carries yesterday, today and tomorrow, and an empty ballot for a silent day", async () => {
    const database = await db();
    await richCaretaker("ct-vote-e", 100);
    await voteForVenue(database, "ct-vote-e", "meadow", 2, day, 100, spendFor("ct-vote-e"));

    const window = await ballotsAround(database, day);
    expect(window.map((entry) => entry.forDay)).toEqual([day - 1, day, day + 1]);
    expect(window.find((entry) => entry.forDay === day)?.tickets).toEqual({ meadow: 2 });
    // A day nobody voted on is an empty ballot, never a missing entry — that
    // is what lets a client past midnight find its own day in the payload.
    expect(window.find((entry) => entry.forDay === day + 1)?.tickets).toEqual({});
  });
});
