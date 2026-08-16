import { describe, expect, it } from "vitest";
import { MINIGAMES, plausibleRun } from "./minigames";

describe("minigame envelopes", () => {
  it("accepts an honest middling run in every game", () => {
    for (const game of Object.values(MINIGAMES)) {
      const elapsedMs = Math.min(20_000, game.maxDurationMs - 1000);
      const score = Math.min(game.maxScore, Math.floor(((elapsedMs / 1000) * game.maxScorePerSecond) / 2));
      const inputs = Math.ceil(score * game.inputsPerPoint) + 5;
      expect(plausibleRun(game, elapsedMs, score, inputs)).toBe(true);
    }
  });

  it("rejects impossible score rates, ceilings, idle runs, and absurd durations", () => {
    for (const game of Object.values(MINIGAMES)) {
      // Faster than the game can be played.
      expect(plausibleRun(game, 2000, Math.ceil(2 * game.maxScorePerSecond) + 1, 1000)).toBe(false);
      // Above the absolute ceiling even over the full duration.
      expect(plausibleRun(game, game.maxDurationMs, game.maxScore + 1, 2000)).toBe(false);
      // Scoring without touching anything.
      if (game.inputsPerPoint >= 1) {
        expect(plausibleRun(game, game.maxDurationMs, Math.min(10, game.maxScore), 0)).toBe(false);
      }
      // Longer than the game exists.
      expect(plausibleRun(game, game.maxDurationMs + 1000, 1, 10)).toBe(false);
      // Sub-second flicker.
      expect(plausibleRun(game, 500, 0, 0)).toBe(false);
    }
  });

  it("keeps performance inside the 50–150 economy band and coins sane", () => {
    for (const game of Object.values(MINIGAMES)) {
      for (const score of [0, 1, Math.floor(game.maxScore / 2), game.maxScore]) {
        const performance = game.performance(score);
        expect(performance).toBeGreaterThanOrEqual(50);
        expect(performance).toBeLessThanOrEqual(150);
        expect(game.coins(score)).toBeGreaterThanOrEqual(0);
        expect(Number.isInteger(game.coins(score))).toBe(true);
      }
      // A strong run should reach the joy ceiling — that is the fun contract.
      expect(game.performance(game.maxScore)).toBe(150);
    }
  });
});
