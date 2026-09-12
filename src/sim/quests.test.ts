import { describe, expect, it } from "vitest";
import {
  questFor,
  questHands,
  questProgress,
  questTarget,
  QUESTS,
  QUEST_IDS,
  type QuestFacts,
} from "./quests";

const SEED = 0xc0ffee;

const facts = (overrides: Partial<QuestFacts> = {}): QuestFacts => ({
  feeds: 0,
  caretakers: 0,
  minigameScore: 0,
  lowestMeterPercent: 0,
  eveningReached: false,
  population: undefined,
  ...overrides,
});

/** A baseline room: two caretakers, which is exactly what a quiet day asks. */
const quietDay = (overrides: Partial<QuestFacts> = {}): QuestFacts =>
  facts({ caretakers: 2, population: 2, ...overrides });

describe("the daily communal quest (SPEC §21.7)", () => {
  it("picks the same goal for the same day on every client", () => {
    for (let day = 0; day < 50; day++) {
      expect(questFor(SEED, day)).toEqual(questFor(SEED, day));
    }
  });

  it("reaches every quest in the table over a season", () => {
    const seen = new Set(Array.from({ length: 200 }, (_, day) => questFor(SEED, day).id));
    expect([...seen].sort()).toEqual([...QUEST_IDS].sort());
  });

  it("counts meals for feast day", () => {
    expect(questProgress(QUESTS["feast-day"], quietDay({ feeds: 9 }))).toEqual({
      current: 9,
      target: 10,
      hands: 2,
      handsTarget: 2,
      complete: false,
    });
    expect(questProgress(QUESTS["feast-day"], quietDay({ feeds: 10 })).complete).toBe(true);
  });

  it("counts distinct caretakers for many hands", () => {
    expect(questProgress(QUESTS["many-hands"], facts({ caretakers: 1 })).complete).toBe(false);
    expect(questProgress(QUESTS["many-hands"], facts({ caretakers: 2 })).complete).toBe(true);
  });

  it("sums minigame scores for game night", () => {
    expect(questProgress(QUESTS["game-night"], quietDay({ minigameScore: 26 }))).toEqual({
      current: 26,
      target: 40,
      hands: 2,
      handsTarget: 2,
      complete: false,
    });
    expect(questProgress(QUESTS["game-night"], quietDay({ minigameScore: 41 })).complete).toBe(true);
  });

  it("holds full bellies open until the evening check", () => {
    const met = quietDay({ lowestMeterPercent: 88 });
    expect(questProgress(QUESTS["full-bellies"], met)).toEqual({
      current: 88,
      target: 70,
      hands: 2,
      handsTarget: 2,
      complete: false,
    });
    expect(questProgress(QUESTS["full-bellies"], { ...met, eveningReached: true }).complete).toBe(true);
    // Evening arrives, but the room let a meter slip.
    expect(
      questProgress(QUESTS["full-bellies"], quietDay({ lowestMeterPercent: 69, eveningReached: true })).complete,
    ).toBe(false);
  });
});

describe("the bar the room's size sets (SPEC §21.7)", () => {
  it("grows the count quests by the §23 care multiplier", () => {
    expect(questTarget(QUESTS["feast-day"], 2)).toBe(10);
    expect(questTarget(QUESTS["feast-day"], 4)).toBe(17);
    expect(questTarget(QUESTS["feast-day"], 13)).toBe(40);
    expect(questTarget(QUESTS["game-night"], 2)).toBe(40);
    expect(questTarget(QUESTS["game-night"], 4)).toBe(67);
    expect(questTarget(QUESTS["game-night"], 13)).toBe(160);
  });

  it("leaves the meter percentage alone — there is nothing to multiply", () => {
    for (const population of [2, 4, 9, 30]) expect(questTarget(QUESTS["full-bellies"], population)).toBe(70);
  });

  it("asks half the room for hands, between two and five", () => {
    const hands = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 12].map(questHands);
    expect(hands).toEqual([2, 2, 2, 2, 2, 3, 3, 4, 4, 5, 5]);
  });

  it("reads an unrecorded population as the baseline, so quiet rooms keep today's numbers", () => {
    expect(questTarget(QUESTS["feast-day"], undefined)).toBe(10);
    expect(questTarget(QUESTS["game-night"], undefined)).toBe(40);
    expect(questHands(undefined)).toBe(2);
    expect(questHands(Number.NaN)).toBe(2);
  });

  it("makes many hands the bar and the requirement at once", () => {
    for (const population of [2, 6, 9, 20]) {
      const status = questProgress(QUESTS["many-hands"], facts({ caretakers: 1, population }));
      expect(status.target).toBe(questHands(population));
      expect(status.target).toBe(status.handsTarget);
    }
  });
});

describe("a goal one caretaker could finish alone", () => {
  it("stays unfinished however hard they grind", () => {
    const alone = facts({ caretakers: 1, feeds: 50, minigameScore: 500, population: 9 });
    expect(questProgress(QUESTS["feast-day"], alone)).toMatchObject({ hands: 1, handsTarget: 5, complete: false });
    expect(questProgress(QUESTS["game-night"], alone).complete).toBe(false);
    expect(
      questProgress(QUESTS["full-bellies"], { ...alone, lowestMeterPercent: 100, eveningReached: true }).complete,
    ).toBe(false);
  });

  it("finishes the moment the room turns up", () => {
    const room = facts({ caretakers: 5, feeds: 40, minigameScore: 160, population: 13 });
    expect(questProgress(QUESTS["feast-day"], room)).toEqual({
      current: 40,
      target: 40,
      hands: 5,
      handsTarget: 5,
      complete: true,
    });
    expect(questProgress(QUESTS["game-night"], room).complete).toBe(true);
  });
});
