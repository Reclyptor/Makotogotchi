import { describe, expect, it } from "vitest";
import { MINIGAMES, MINIGAME_COUNTDOWN_MS, plausibleRun } from "./minigames";

// The server measures wall time from `start`, which opens with the pre-roll
// (SPEC §13.3.1). These cases are written in play time — how long the player
// actually had the controls — and wall() puts the count back on top.
const wall = (playMs: number): number => playMs + MINIGAME_COUNTDOWN_MS;

describe("minigame envelopes", () => {
  it("accepts an honest middling run in every game", () => {
    for (const game of Object.values(MINIGAMES)) {
      const playMs = Math.min(20_000, game.sessionLifetimeMs - 1000);
      const score = Math.min(game.maxScore, Math.floor(((playMs / 1000) * game.maxScorePerSecond) / 2));
      const inputs = Math.ceil(score * game.inputsPerPoint) + 5;
      expect(plausibleRun(game, wall(playMs), score, inputs)).toBe(true);
    }
  });

  it("rejects impossible score rates, ceilings, and idle runs", () => {
    for (const game of Object.values(MINIGAMES)) {
      // Faster than the game can be played.
      expect(plausibleRun(game, wall(2000), Math.ceil(2 * game.maxScorePerSecond) + 1, 1000)).toBe(false);
      // Above the absolute ceiling even over the full duration.
      expect(plausibleRun(game, wall(game.sessionLifetimeMs), game.maxScore + 1, 2000)).toBe(false);
      // Scoring without touching anything.
      if (game.inputsPerPoint >= 1) {
        expect(plausibleRun(game, wall(game.sessionLifetimeMs), Math.min(10, game.maxScore), 0)).toBe(false);
      }
      // Sub-second flicker.
      expect(plausibleRun(game, wall(500), 0, 0)).toBe(false);
    }
  });

  // A perfect run is the longest run a game can produce, and the client clock
  // that stops it undercounts the wall clock the server measures. Judging
  // length therefore rejected the best honest runs and nothing else — the rate
  // ceiling and the score ceiling are what actually bound a result.
  it("accepts a slow run on its merits, however long it took", () => {
    for (const game of Object.values(MINIGAMES)) {
      const dawdled = game.sessionLifetimeMs * 4;
      const inputs = Math.ceil(game.maxScore * game.inputsPerPoint) + 5;
      expect(plausibleRun(game, wall(dawdled), game.maxScore, inputs)).toBe(true);
      // Still bounded by the ceiling, no matter how much time is claimed.
      expect(plausibleRun(game, wall(dawdled), game.maxScore + 1, inputs)).toBe(false);
    }
  });

  it("never lets the pre-roll be spent as play time", () => {
    for (const game of Object.values(MINIGAMES)) {
      // All countdown and no game is not a run, however it is reported.
      expect(plausibleRun(game, MINIGAME_COUNTDOWN_MS, 0, 0)).toBe(false);
      expect(plausibleRun(game, MINIGAME_COUNTDOWN_MS + 500, 1, 10)).toBe(false);
      // And the rate ceiling is measured after the count: a score that only
      // fits inside the wall clock is still too fast for the time played.
      const playMs = 4000;
      const beyondRate = Math.ceil((playMs / 1000) * game.maxScorePerSecond) + 1;
      if (beyondRate <= game.maxScore) {
        expect(plausibleRun(game, wall(playMs), beyondRate, 2000)).toBe(false);
        // The same score over the same wall clock, minus the pre-roll's worth
        // of scoring, is exactly what an honest player of that run produces.
        expect(plausibleRun(game, wall(playMs), beyondRate - 1, 2000)).toBe(true);
      }
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
