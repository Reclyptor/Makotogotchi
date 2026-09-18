// The minigame roster (SPEC §13.3). Pure data + arithmetic, shared by the
// server (plausibility envelopes, reward curves) and the client (titles,
// rotation). Each game reports a raw integer score; the envelope bounds what
// a legitimate client can produce, and the curves translate score into the
// PLAY performance multiplier and the coin payout.

export const MINIGAME_IDS = [
  "dustdash",
  "snackcatch",
  "bubblepop",
  "simon",
  "wheelsprint",
  "shuffle",
  "natsumi",
  "coffeerun",
  "sausageparty",
  "sausaged",
] as const;
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
  /** How long this game's server-side session may live. A bound on the room's
   *  single run slot, never a verdict on the result — see `plausibleRun`. */
  sessionLifetimeMs: number;
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
    sessionLifetimeMs: 45_000,
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
    sessionLifetimeMs: 40_000,
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
    sessionLifetimeMs: 40_000,
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
    // Rounds grow, so late rounds are slow — the session is generous and the
    // score-rate cap is what bounds farming.
    sessionLifetimeMs: 120_000,
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
    sessionLifetimeMs: 45_000,
    maxScorePerSecond: 2,
    maxScore: 60,
    inputsPerPoint: 1,
    performance: (score) => clampPerformance(50 + score * 4),
    coins: (score) => Math.round(score * 0.6),
  },
  shuffle: {
    id: "shuffle",
    title: "Makoto Shuffle",
    emoji: "🥣",
    // A round is a peek, a run of swaps, and a pick, and the swaps multiply as
    // the rounds climb, so a perfect twelve rounds is the roster's longest run
    // by some way: the session has to outlast one comfortably, and the rate cap
    // is what bounds farming, exactly as in Simon.
    sessionLifetimeMs: 120_000,
    maxScorePerSecond: 0.4,
    maxScore: 12,
    inputsPerPoint: 1,
    performance: (score) => clampPerformance(50 + score * 9),
    coins: (score) => score * 2,
  },
  natsumi: {
    id: "natsumi",
    title: "Natsumi's Watch",
    emoji: "👀",
    // Crossing the desk takes two seconds of clear running, and being caught
    // costs every inch of it, so points come slowly by design.
    sessionLifetimeMs: 50_000,
    maxScorePerSecond: 0.5,
    maxScore: 10,
    inputsPerPoint: 1,
    performance: (score) => clampPerformance(50 + score * 10),
    coins: (score) => score * 3,
  },
  coffeerun: {
    id: "coffeerun",
    title: "Coffee Run",
    emoji: "☕",
    sessionLifetimeMs: 45_000,
    // Her shortest round trip is 5.5s and the pot caps at five cups, so a
    // flawless thirty seconds is about 27 — the envelope has to sit above
    // what perfect play produces, not at it.
    maxScorePerSecond: 1.2,
    maxScore: 32,
    // A single hold can bank five cups at once, so the input floor is well
    // under one per point — as with Snack Catch, it is anti-idle, not anti-fun.
    inputsPerPoint: 0.25,
    performance: (score) => clampPerformance(50 + score * 5),
    coins: (score) => score,
  },
  sausageparty: {
    id: "sausageparty",
    title: "Sausage Party",
    emoji: "🥳",
    sessionLifetimeMs: 50_000,
    // The tray reloads between dishes, which is what paces the game: about
    // one serve a second flat out, over a 35s run.
    maxScorePerSecond: 1.4,
    maxScore: 42,
    inputsPerPoint: 1,
    performance: (score) => clampPerformance(50 + score * 4),
    coins: (score) => Math.round(score * 0.6),
  },
  sausaged: {
    id: "sausaged",
    title: "Don't Get Sausaged",
    emoji: "🌭",
    // One miss ends it, so a long run is a good run: the session is generous
    // and the rate cap is what bounds farming.
    sessionLifetimeMs: 90_000,
    // Twenty-five rounds is the run's own ceiling, so the payout is bounded
    // by maxScore no matter how fast it is played — which lets the rate cap
    // sit well above a hot streak instead of rejecting one.
    maxScorePerSecond: 2,
    maxScore: 25,
    inputsPerPoint: 1,
    performance: (score) => clampPerformance(50 + score * 4),
    coins: (score) => Math.round(score * 1.5),
  },
};

export const isMinigameId = (value: unknown): value is MinigameId =>
  typeof value === "string" && (MINIGAME_IDS as readonly string[]).includes(value);

/** The envelope check the server applies at finish (SPEC §13.3). `elapsedMs`
 *  is wall time since `start`, which opens with the pre-roll nobody can play
 *  through — the count comes off first, so every ceiling below still bounds
 *  play time and only play time.
 *
 *  A *long* run is deliberately not judged. Length is not a cheat signal: the
 *  rate ceiling divides by play time, so every extra second lowers the score a
 *  run may claim, and `maxScore` caps the total regardless. Only the client's
 *  clock is bounded (each game's own hard stop), and it undercounts wall time
 *  by design — a frame-delta clamp, and a throttled `requestAnimationFrame` in
 *  a backgrounded tab, both stop it while the wall clock runs on. Judging
 *  duration therefore rejected exactly the honest runs that lasted longest:
 *  the perfect ones. */
export const plausibleRun = (game: MinigameDef, elapsedMs: number, score: number, inputs: number): boolean => {
  const playMs = elapsedMs - MINIGAME_COUNTDOWN_MS;
  return (
    playMs >= 1_000 &&
    score <= game.maxScore &&
    score <= Math.ceil((playMs / 1000) * game.maxScorePerSecond) &&
    inputs >= Math.ceil(score * game.inputsPerPoint)
  );
};
