import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, db } from "./db/client";
import { closeRedis } from "./redis/client";
import { caretakerProfile, leaderboard, recordContribution, setNickname } from "./social";
import { startTestInfra, type TestInfra } from "./testsetup";
import { TICKS_PER_DAY } from "@/sim/tuning";

let infra: TestInfra;

beforeAll(async () => {
  infra = startTestInfra();
}, 120_000);

afterAll(async () => {
  await closeDb();
  await closeRedis();
  infra.stop();
});

describe("nicknames (SPEC §8.5)", () => {
  it("accepts a valid name and normalizes it", async () => {
    const result = await setNickname(await db(), "ct-1", "  Emilio  ");
    expect(result).toEqual({ ok: true, nickname: "Emilio" });
    expect((await caretakerProfile(await db(), "ct-1"))?.nickname).toBe("Emilio");
  });

  it("rejects invalid, blocked, and duplicate names", async () => {
    expect(await setNickname(await db(), "ct-2", "x")).toMatchObject({ ok: false, reason: "INVALID" });
    expect(await setNickname(await db(), "ct-2", "a<script>b")).toMatchObject({ ok: false, reason: "INVALID" });
    expect(await setNickname(await db(), "ct-2", "admin")).toMatchObject({ ok: false, reason: "BLOCKED" });
    // Case-insensitive uniqueness.
    expect(await setNickname(await db(), "ct-2", "EMILIO")).toMatchObject({ ok: false, reason: "TAKEN" });
  });

  it("limits changes to once per day", async () => {
    expect(await setNickname(await db(), "ct-1", "Emilio2")).toMatchObject({ ok: false, reason: "TOO_SOON" });
  });
});

describe("contributions and streaks (SPEC §2.11)", () => {
  it("scores by applied magnitude, accumulates streaks by consecutive pet-days", async () => {
    const database = await db();
    const base = { caretakerId: "ct-streak", generationId: "gen-x", action: "FEED" as const };

    const day1 = await recordContribution(database, { ...base, applied: 200_000, tick: 100 });
    expect(day1.score).toBe(200); // applied × weight 10 / 10_000
    expect(day1.streakDays).toBe(1);

    // Same day: streak unchanged.
    const day1b = await recordContribution(database, { ...base, applied: 100_000, tick: 200 });
    expect(day1b.streakDays).toBe(1);

    // Next pet-day: streak grows.
    const day2 = await recordContribution(database, { ...base, applied: 100_000, tick: TICKS_PER_DAY + 100 });
    expect(day2.streakDays).toBe(2);

    // A skipped day resets to 1.
    const day4 = await recordContribution(database, { ...base, applied: 100_000, tick: 3 * TICKS_PER_DAY + 100 });
    expect(day4.streakDays).toBe(1);

    const profile = await caretakerProfile(database, "ct-streak");
    expect(profile?.score).toBe(day1.score + day1b.score + day2.score + day4.score);
    expect(profile?.actionCounts.FEED).toBe(4);
    expect(profile?.coins).toBeGreaterThan(0);
  });

  it("windows the leaderboard correctly", async () => {
    const database = await db();
    const nowTick = 3 * TICKS_PER_DAY + 500;
    // ct-streak acted on days 0, 1, 3 of gen-x; "today" is day 3.
    const today = await leaderboard(database, "today", { generationId: "gen-x", nowTick });
    const all = await leaderboard(database, "all", { generationId: "gen-x", nowTick });
    const generation = await leaderboard(database, "generation", { generationId: "gen-x", nowTick });

    expect(today.find((row) => row.caretakerId === "ct-streak")?.score).toBe(100);
    expect(generation.find((row) => row.caretakerId === "ct-streak")?.score).toBe(500);
    expect(all[0]!.name).toBeTruthy();
  });
});
