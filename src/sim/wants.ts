// Pet wants (SPEC §25): the pet occasionally asks for something — a food it
// craves, a game it feels like playing, a cuddle, a dust bath. Which window
// brings which want is decided by the generation seed alone, so every client,
// the leader, and every replay agree without a round trip.
//
// This module is schedule-free: it never asks what hour it is. Whether a
// drawn want actually opens is the leader's decision (§25.2), because waking
// hours are schedule knowledge the sim deliberately lacks. The reducer never
// calls wantAt either — the logged WANT_OPENED payload is authoritative — so
// retuning these odds, weights, or catalogs never re-folds an old log.

import { draw32, RNG_PURPOSE } from "./rng";
import { FOOD_ITEM_IDS } from "./economy";
import { MINIGAME_IDS } from "./minigames";
import { quirks } from "./quirks";

export const WANT_KINDS = ["crave-food", "play-game", "cuddle", "dust-bath"] as const;
export type WantKind = (typeof WANT_KINDS)[number];

/** A drawn want; `itemId` names the food or game where the kind wants one. */
export type Want = { kind: WantKind; itemId?: string };

/** 540 ticks of 10s — 90-minute windows, ten per pet-day. */
export const WANT_WINDOW_TICKS = 540;

/** One window in three draws a want — about three asked per waking day. */
export const WANT_ODDS_P32 = Math.floor(2 ** 32 / 3);

/** Fulfillment multiplier, applied pre-curve: floor(base × 150 / 100). */
export const WANT_BONUS_PERCENT = 150;

/** Flat need-units (5% of NEED_MAX), subtracted through the [0, max] clamp. */
export const WANT_EXPIRY_JOY_DEBIT = 50_000;

/** Paid to the fulfilling caretaker on the write path (SPEC §25.4). */
export const WANT_REWARD_COINS = 10;

/** One playful push per caretaker per 4h (SPEC §25.6). */
export const WANT_PUSH_THROTTLE_MS = 4 * 60 * 60 * 1000;

type Candidate = { kind: WantKind; weight: number };

const TABLE: readonly Candidate[] = [
  { kind: "crave-food", weight: 3 },
  { kind: "play-game", weight: 2 },
  { kind: "cuddle", weight: 2 },
  { kind: "dust-bath", weight: 2 },
];

export const isWantKind = (value: unknown): value is WantKind =>
  typeof value === "string" && (WANT_KINDS as readonly string[]).includes(value);

export const windowIndexAt = (tick: number): number => Math.floor(tick / WANT_WINDOW_TICKS);

/** The first tick past the window — where the deadline falls. */
export const windowEndTick = (windowIndex: number): number => (windowIndex + 1) * WANT_WINDOW_TICKS;

/** Index into a non-empty catalog; the modulo keeps it in range. */
const pickItem = (options: readonly string[], seed: number, windowIndex: number): string =>
  options[draw32(seed, windowIndex, RNG_PURPOSE.wantItem) % options.length]!;

/** The want this window brings, if any. */
export const wantAt = (seed: number, windowIndex: number): Want | null => {
  if (draw32(seed, windowIndex, RNG_PURPOSE.wantOdds) >= WANT_ODDS_P32) return null;

  const total = TABLE.reduce((sum, candidate) => sum + candidate.weight, 0);
  let remaining = draw32(seed, windowIndex, RNG_PURPOSE.wantPick) % total;
  // The walk always lands inside the table; the last entry is the tail case.
  let chosen = TABLE[TABLE.length - 1]!;
  for (const candidate of TABLE) {
    if (remaining < candidate.weight) {
      chosen = candidate;
      break;
    }
    remaining -= candidate.weight;
  }

  switch (chosen.kind) {
    case "crave-food": {
      // The pet does not crave what it hates. A one-food catalog leaves
      // nothing else to crave, and the craving falls on that food anyway.
      const palatable = FOOD_ITEM_IDS.filter((itemId) => itemId !== quirks(seed).dislikedFood);
      const pool = palatable.length > 0 ? palatable : FOOD_ITEM_IDS;
      return { kind: chosen.kind, itemId: pickItem(pool, seed, windowIndex) };
    }
    case "play-game":
      return { kind: chosen.kind, itemId: pickItem(MINIGAME_IDS, seed, windowIndex) };
    default:
      return { kind: chosen.kind };
  }
};
