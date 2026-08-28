// The minigame roster (SPEC §13.3). Pure data + arithmetic, shared by the
// server (plausibility envelopes, reward curves) and the client (titles,
// rotation). Each game reports a raw integer score; the envelope bounds what
// a legitimate client can produce, and the curves translate score into the
// PLAY performance multiplier and the coin payout.

export const MINIGAME_IDS = ["dustdash", "snackcatch", "bubblepop", "simon", "wheelsprint"] as const;
export type MinigameId = (typeof MINIGAME_IDS)[number];

/** Every run opens with a countdown before the game's clock starts (SPEC
 *  §13.3.1) — long enough to read a board you were handed at random. It lives
 *  here because both ends need the same number: the client paints it, and the
 *  server deducts it from the elapsed wall time so the pre-roll can never be
 *  spent as play time. */
export const MINIGAME_COUNTDOWN_MS = 3_000;

export type MinigameDef = {
  id: MinigameId;
  title: string;
  emoji: string;
  /** A run longer than this is implausible (and bounds the session TTL). */
  maxDurationMs: number;
  /** Hard ceiling on legitimate scoring rate. */
  maxScorePerSecond: number;
  /** Absolute score ceiling for a perfect run. */
  maxScore: number;
  /** Minimum recorded inputs per point — anti-idle, not anti-fun. */
  inputsPerPoint: number;
  /** score → PLAY performance percentage (50 = half joy, 150 = ceiling). */
  performance: (score: number) => number;
  /** score → coins credited. */
  coins: (score: number) => number;
};

const clampPerformance = (value: number): number => Math.max(50, Math.min(150, Math.round(value)));

export const MINIGAMES: Record<MinigameId, MinigameDef> = {
  dustdash: {
    id: "dustdash",
    title: "Dust Dash",
    emoji: "🏃",
    maxDurationMs: 45_000,
    maxScorePerSecond: 2,
    maxScore: 90,
    inputsPerPoint: 1,
    performance: (score) => clampPerformance(50 + score * 4),
    coins: (score) => score,
  },
  snackcatch: {
    id: "snackcatch",
    title: "Snack Catch",
    emoji: "🍙",
    maxDurationMs: 40_000,
    maxScorePerSecond: 1.5,
    maxScore: 40,
    // Catching is positioning, not tapping — a held pointer drag counts few
    // discrete inputs, so the anti-idle bar is low.
    inputsPerPoint: 0.25,
    performance: (score) => clampPerformance(50 + score * 5),
    coins: (score) => Math.round(score * 0.75),
  },
  bubblepop: {
    id: "bubblepop",
    title: "Bubble Bath Pop",
    emoji: "🫧",
    maxDurationMs: 40_000,
    maxScorePerSecond: 3,
    maxScore: 60,
    inputsPerPoint: 1,
    performance: (score) => clampPerformance(50 + score * 4),
    coins: (score) => Math.round(score * 0.5),
  },
  simon: {
    id: "simon",
    title: "Simon Squeaks",
    emoji: "🎵",
    // Rounds grow, so late rounds are slow — the duration cap is generous
    // and the score-rate cap is what bounds farming.
    maxDurationMs: 120_000,
    maxScorePerSecond: 0.5,
    maxScore: 20,
    inputsPerPoint: 1,
    performance: (score) => clampPerformance(50 + score * 13),
    coins: (score) => score * 2,
  },
  wheelsprint: {
    id: "wheelsprint",
    title: "Wheel Sprint",
    emoji: "🎡",
    maxDurationMs: 45_000,
    maxScorePerSecond: 2,
    maxScore: 60,
    inputsPerPoint: 1,
    performance: (score) => clampPerformance(50 + score * 4),
    coins: (score) => Math.round(score * 0.6),
  },
};

export const isMinigameId = (value: unknown): value is MinigameId =>
  typeof value === "string" && (MINIGAME_IDS as readonly string[]).includes(value);

/** The envelope check the server applies at finish (SPEC §13.3). `elapsedMs`
 *  is wall time since `start`, which opens with the pre-roll nobody can play
 *  through — the count comes off first, so every ceiling below still bounds
 *  play time and only play time. */
export const plausibleRun = (game: MinigameDef, elapsedMs: number, score: number, inputs: number): boolean => {
  const playMs = elapsedMs - MINIGAME_COUNTDOWN_MS;
  return (
    playMs >= 1_000 &&
    playMs <= game.maxDurationMs &&
    score <= game.maxScore &&
    score <= Math.ceil((playMs / 1000) * game.maxScorePerSecond) &&
    inputs >= Math.ceil(score * game.inputsPerPoint)
  );
};
