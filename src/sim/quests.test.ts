import { describe, expect, it } from "vitest";
import { questFor, questProgress, QUESTS, QUEST_IDS, type QuestFacts } from "./quests";

const SEED = 0xc0ffee;

const facts = (overrides: Partial<QuestFacts> = {}): QuestFacts => ({
  feeds: 0,
  caretakers: 0,
  minigameScore: 0,
  lowestMeterPercent: 0,
  eveningReached: false,
  ...overrides,
});

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
    expect(questProgress(QUESTS["feast-day"], facts({ feeds: 9 }))).toEqual({ current: 9, target: 10, complete: false });
    expect(questProgress(QUESTS["feast-day"], facts({ feeds: 10 })).complete).toBe(true);
  });

  it("counts distinct caretakers for many hands", () => {
    expect(questProgress(QUESTS["many-hands"], facts({ caretakers: 3 })).complete).toBe(false);
    expect(questProgress(QUESTS["many-hands"], facts({ caretakers: 4 })).complete).toBe(true);
  });

  it("sums minigame scores for game night", () => {
    expect(questProgress(QUESTS["game-night"], facts({ minigameScore: 26 }))).toEqual({
      current: 26,
      target: 40,
      complete: false,
    });
    expect(questProgress(QUESTS["game-night"], facts({ minigameScore: 41 })).complete).toBe(true);
  });

  it("holds full bellies open until the evening check", () => {
    const met = facts({ lowestMeterPercent: 88 });
    expect(questProgress(QUESTS["full-bellies"], met)).toEqual({ current: 88, target: 70, complete: false });
    expect(questProgress(QUESTS["full-bellies"], { ...met, eveningReached: true }).complete).toBe(true);
    // Evening arrives, but the room let a meter slip.
    expect(
      questProgress(QUESTS["full-bellies"], facts({ lowestMeterPercent: 69, eveningReached: true })).complete,
    ).toBe(false);
  });
});
