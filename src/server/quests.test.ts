// The quest's server half against real Mongo (SPEC §16.4, §21.7): progress
// really is derived from the day's events, and settlement really does pay
// each contributor exactly once no matter how many leaders try.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, db } from "./db/client";
import { closeRedis } from "./redis/client";
import { appendEvent } from "./db/repository";
import { caretakerProfile } from "./social";
import { questDay, questMarkers, questView, settleQuest } from "./quests";
import { startTestInfra, type TestInfra } from "./testsetup";
import { genesis } from "@/sim/genesis";
import { questFor, QUEST_REWARD_COINS, type QuestId } from "@/sim/quests";
import { TICKS_PER_HOUR } from "@/sim/tuning";
import type { Generation, PetState } from "@/sim/model";

const TIME_ZONE = "America/Chicago";
// 2026-01-05 07:00 America/Chicago — tick 0 lands on a Monday at wake time.
const GENESIS_MS = Date.UTC(2026, 0, 5, 13);
const NOON = 5 * TICKS_PER_HOUR;

let infra: TestInfra;
let seq = 0;

/** The first seed whose day-0 goal is the one this test wants to exercise. */
const generationFor = (id: string, questId: QuestId): Generation => {
  let seed = 1;
  while (questFor(seed, 0).id !== questId) seed += 1;
  return { id, ordinal: 1, seed, genesisEpochMs: GENESIS_MS, name: "Makoto" };
};

/** A living pet at a given tick, meters full. */
const stateAt = (generation: Generation, tick: number): PetState => ({ ...genesis(generation), tick, bornAtTick: 0 });

const care = async (
  generation: Generation,
  tick: number,
  caretakerId: string,
  action: "FEED" | "PLAY",
  minigameScore?: number,
): Promise<void> => {
  seq += 1;
  await appendEvent(
    await db(),
    { type: "CARE", generationId: generation.id, seq, tick, action, caretakerId },
    { applied: 1000, ...(minigameScore !== undefined ? { minigameScore } : {}) },
  );
};

beforeAll(async () => {
  infra = startTestInfra();
}, 120_000);

afterAll(async () => {
  await closeDb();
  await closeRedis();
  infra.stop();
});

describe("quest progress", () => {
  it("counts only today's events, and only this generation's", async () => {
    const generation = generationFor("gen-feast", "feast-day");
    const stranger = { ...generation, id: "gen-other" };
    const day = questDay(generation, GENESIS_MS + 60_000, TIME_ZONE);

    for (let index = 0; index < 4; index++) await care(generation, NOON + index, `ct-${index}`, "FEED");
    await care(generation, day.toTick + 5, "ct-tomorrow", "FEED"); // a different day
    await care(stranger, NOON, "ct-elsewhere", "FEED"); // a different pet

    const view = await questView(await db(), generation, stateAt(generation, NOON + 10), TIME_ZONE, GENESIS_MS + 60_000);
    expect(view.quest.id).toBe("feast-day");
    expect(view.current).toBe(4);
    expect(view.target).toBe(10);
    expect(view.contributors).toEqual(["ct-0", "ct-1", "ct-2", "ct-3"]);
    expect(view.complete).toBe(false);
  });

  it("sums the denormalized minigame scores the PLAY events carry", async () => {
    const generation = generationFor("gen-games", "game-night");
    await care(generation, NOON, "ct-a", "PLAY", 18);
    await care(generation, NOON + 1, "ct-b", "PLAY", 24);

    const view = await questView(await db(), generation, stateAt(generation, NOON + 5), TIME_ZONE, GENESIS_MS + 60_000);
    expect(view.quest.id).toBe("game-night");
    expect(view.current).toBe(42);
    expect(view.complete).toBe(true);
  });
});

describe("quest settlement", () => {
  it("pays every contributor exactly once, however many leaders try", async () => {
    const generation = generationFor("gen-hands", "many-hands");
    const helpers = ["ct-h1", "ct-h2", "ct-h3", "ct-h4"];
    for (const [index, helper] of helpers.entries()) await care(generation, NOON + index, helper, "FEED");

    const state = stateAt(generation, NOON + 10);
    const nowMs = GENESIS_MS + 60_000;
    const database = await db();

    // Four leaders racing the same tick: exactly one of them settles it.
    const settled = await Promise.all(
      Array.from({ length: 4 }, () => settleQuest(database, generation, state, TIME_ZONE, nowMs)),
    );
    expect(settled.filter((entry) => entry !== null)).toHaveLength(1);

    // …and a later tick, from a restarted leader, still settles nothing.
    expect(await settleQuest(database, generation, stateAt(generation, NOON + 900), TIME_ZONE, nowMs)).toBeNull();

    for (const helper of helpers) {
      expect((await caretakerProfile(database, helper))?.coins).toBe(QUEST_REWARD_COINS);
    }
    const marker = await questMarkers(database).findOne({ _id: `${generation.id}:0` });
    expect(marker?.questId).toBe("many-hands");
    expect(marker?.contributors).toEqual(helpers);
  });

  it("settles nothing while the goal is unmet, and nothing for an unhatched egg", async () => {
    const generation = generationFor("gen-unmet", "feast-day");
    await care(generation, NOON, "ct-lonely", "FEED");
    const database = await db();
    expect(await settleQuest(database, generation, stateAt(generation, NOON + 5), TIME_ZONE, GENESIS_MS)).toBeNull();

    const egg = { ...genesis(generation), tick: NOON + 5 };
    expect(await settleQuest(database, generation, egg, TIME_ZONE, GENESIS_MS)).toBeNull();
  });

  it("puts the day boundaries on the pet's calendar and the check before bedtime", () => {
    const generation = generationFor("gen-clock", "feast-day");
    const day = questDay(generation, GENESIS_MS + 60_000, TIME_ZONE);
    expect(day.dayIndex).toBe(0);
    // Genesis is 07:00 local, so 21:00 the same day is fourteen hours in.
    expect(day.eveningTick).toBe(14 * TICKS_PER_HOUR);
    expect(day.toTick - day.fromTick).toBe(24 * TICKS_PER_HOUR);
    expect(day.fromTick).toBeLessThan(0); // local midnight preceded genesis
  });
});
