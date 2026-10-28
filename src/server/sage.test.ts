// The Sage's rewards against real stores (SPEC §2.8, §13.1): the ascension
// payout is paid once to exactly the elder's recent caretakers, the wisdom
// bonus applies only to a Sage, no want opens over the meditation, and a
// Sage's death lays a blessed egg.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, db } from "./db/client";
import { closeRedis, key, redis } from "./redis/client";
import { generations } from "./db/collections";
import { appendEvent, createGeneration, toGeneration } from "./db/repository";
import { PetEngine } from "./engine/engine";
import { Lifecycle } from "./engine/lifecycle";
import { ascensionMarkers, SAGE_ASCENSION_COINS, SAGE_ASCENSION_WINDOW_TICKS, settleAscension } from "./ascension";
import { caretakerProfile, recordContribution, wisdomCoins } from "./social";
import { settleWantFulfillment, windowClearOfMeditation } from "./wants";
import { startTestInfra, type TestInfra } from "./testsetup";
import { genesis } from "@/sim/genesis";
import { meditationStartTickOf, type Generation, type PetState } from "@/sim/model";
import { MEDITATION_TICKS, MOURNING_TICKS, RULES_SINCE, TICKS_PER_DAY } from "@/sim/tuning";
import { WANT_REWARD_COINS, WANT_WINDOW_TICKS, windowIndexAt } from "@/sim/wants";

let infra: TestInfra;
let seq = 0;
const fakeNowMs = 1_760_028_800_000;

const MEDITATION_START = 40 * TICKS_PER_DAY;
const SAGE_START = MEDITATION_START + MEDITATION_TICKS;

const generationNamed = (id: string, ordinal = 1): Generation => ({
  id,
  ordinal,
  seed: 7,
  genesisEpochMs: fakeNowMs,
  name: "Makoto",
});

/** A pet hatched at tick 0 whose ruleset arrived at hatch: it meditates on day 40. */
const ruledState = (generation: Generation, tick: number): PetState => ({
  ...genesis(generation),
  bornAtTick: 0,
  tick,
  rulesVersion: RULES_SINCE.SAGE,
  sageRuleFromTick: 0,
});

const cared = async (generation: Generation, tick: number, caretakerId: string): Promise<void> => {
  seq += 1;
  await appendEvent(
    await db(),
    { type: "CARE", generationId: generation.id, seq, tick, action: "FEED", caretakerId },
    { applied: 1000 },
  );
};

const coinsOf = async (caretakerId: string): Promise<number> => (await caretakerProfile(await db(), caretakerId))?.coins ?? 0;

beforeAll(async () => {
  infra = startTestInfra();
}, 120_000);

afterAll(async () => {
  await closeDb();
  await closeRedis();
  infra.stop();
});

describe("ascension payout", () => {
  it("pays everyone who cared in the fortnight before the meditation, once, across two leaders", async () => {
    const generation = generationNamed("gen-ascend");
    await cared(generation, MEDITATION_START - SAGE_ASCENSION_WINDOW_TICKS - 1, "asc-too-early");
    await cared(generation, MEDITATION_START - SAGE_ASCENSION_WINDOW_TICKS, "asc-first-day");
    await cared(generation, MEDITATION_START - 1, "asc-last-tick");
    await cared(generation, MEDITATION_START - 2, "asc-last-tick");
    await cared(generation, MEDITATION_START + 10, "asc-during");

    const sage = ruledState(generation, SAGE_START + 1);
    const [first, second] = await Promise.all([
      settleAscension(await db(), generation, sage),
      settleAscension(await db(), generation, sage),
    ]);
    const paid = first ?? second;
    expect([first, second].filter((result) => result !== null)).toHaveLength(1);
    expect(paid).toEqual(["asc-first-day", "asc-last-tick"]);
    expect(await settleAscension(await db(), generation, ruledState(generation, SAGE_START + 500))).toBeNull();

    expect(await coinsOf("asc-first-day")).toBe(SAGE_ASCENSION_COINS);
    expect(await coinsOf("asc-last-tick")).toBe(SAGE_ASCENSION_COINS);
    expect(await coinsOf("asc-too-early")).toBe(0);
    expect(await coinsOf("asc-during")).toBe(0);
    expect(await ascensionMarkers(await db()).countDocuments({ generationId: generation.id })).toBe(1);
  });

  it("pays nothing before the Sage rises, or under a ruleset without one", async () => {
    const generation = generationNamed("gen-not-yet");
    await cared(generation, MEDITATION_START - 100, "asc-early-bird");
    expect(await settleAscension(await db(), generation, ruledState(generation, SAGE_START - 1))).toBeNull();
    const old: PetState = { ...genesis(generation), bornAtTick: 0, tick: SAGE_START + 1, rulesVersion: 3 };
    expect(await settleAscension(await db(), generation, old)).toBeNull();
    expect(await coinsOf("asc-early-bird")).toBe(0);
  });
});

describe("wisdom coin bonus", () => {
  it("pays half again for care while the pet is a Sage, and only then", async () => {
    const base = { generationId: "gen-wisdom", action: "FEED" as const, applied: 200_000, tick: 100 };
    const adult = await recordContribution(await db(), { ...base, caretakerId: "wis-adult", stage: "ADULT" });
    const sage = await recordContribution(await db(), { ...base, caretakerId: "wis-sage", stage: "SAGE" });
    expect(adult.coins).toBe(20);
    expect(sage.coins).toBe(30);
    expect(await coinsOf("wis-sage")).toBe(30);
  });

  it("keeps the floor and the nothing-for-nothing rule", async () => {
    const base = { generationId: "gen-wisdom", action: "FEED" as const, tick: 100, stage: "SAGE" as const };
    expect((await recordContribution(await db(), { ...base, caretakerId: "wis-tiny", applied: 1_000 })).coins).toBe(1);
    expect((await recordContribution(await db(), { ...base, caretakerId: "wis-none", applied: 0, changed: false })).coins).toBe(0);
    expect(wisdomCoins(1, "SAGE")).toBe(1);
    expect(wisdomCoins(1, "ELDER")).toBe(1);
  });

  it("pays a granted wish half again", async () => {
    const paid = await settleWantFulfillment(await db(), "wis-wish", [{ kind: "WANT_FULFILLED", tick: 1, detail: "cuddle" }], "SAGE");
    expect(paid).toBe((WANT_REWARD_COINS * 3) / 2);
    expect(await coinsOf("wis-wish")).toBe(paid);
  });
});

describe("wants and the meditation", () => {
  const state = ruledState(generationNamed("gen-wants-sage"), MEDITATION_START);
  const start = meditationStartTickOf(state)!;
  const firstInside = windowIndexAt(start);

  it("opens no window that touches the two days", () => {
    expect(windowClearOfMeditation(state, firstInside - 1)).toBe(start % WANT_WINDOW_TICKS === 0);
    expect(windowClearOfMeditation(state, firstInside)).toBe(false);
    expect(windowClearOfMeditation(state, windowIndexAt(start + MEDITATION_TICKS - 1))).toBe(false);
  });

  it("opens windows again once the Sage has risen, and always for a pet that never meditates", () => {
    expect(windowClearOfMeditation(state, Math.ceil((start + MEDITATION_TICKS) / WANT_WINDOW_TICKS))).toBe(true);
    expect(windowClearOfMeditation(state, windowIndexAt(start) - 2)).toBe(true);
    const old: PetState = { ...genesis(generationNamed("gen-wants-old")), bornAtTick: 0, tick: start };
    expect(windowClearOfMeditation(old, firstInside)).toBe(true);
  });
});

describe("the Sage's blessing", () => {
  const lifecycleFor = async (): Promise<Lifecycle> => {
    const database = await db();
    const engine = new PetEngine({ db: database, redis: redis(), key, timeZone: "America/Chicago", now: () => fakeNowMs });
    return new Lifecycle(database, engine, () => fakeNowMs);
  };

  const successorOf = async (previous: Generation, diedAtTick: number): Promise<Generation> => {
    await createGeneration(await db(), previous);
    const dead: PetState = {
      ...ruledState(previous, diedAtTick + MOURNING_TICKS),
      diedAtTick,
      causeOfDeath: "age",
    };
    const successor = await (await lifecycleFor()).check(previous, dead);
    expect(successor).not.toBeNull();
    return successor!;
  };

  it("lays a blessed egg after a Sage dies, and it survives the round trip through Mongo", async () => {
    const successor = await successorOf(generationNamed("gen-sage-dies", 701), SAGE_START + TICKS_PER_DAY);
    expect(successor.sageBlessed).toBe(true);
    const stored = await generations(await db()).findOne({ _id: successor.id });
    expect(stored?.sageBlessed).toBe(true);
    expect(toGeneration(stored!).sageBlessed).toBe(true);
  });

  it("lays an ordinary egg, with no field at all, after an elder dies", async () => {
    const successor = await successorOf(generationNamed("gen-elder-dies", 801), MEDITATION_START - TICKS_PER_DAY);
    expect(successor).not.toHaveProperty("sageBlessed");
    const stored = await generations(await db()).findOne({ _id: successor.id });
    expect(stored).not.toHaveProperty("sageBlessed");
  });
});
