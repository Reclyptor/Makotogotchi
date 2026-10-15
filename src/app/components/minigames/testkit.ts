// Shared fixtures for the minigame rules tests: seeded randomness, so every
// run walks the same thousands of games.

import type { Rng } from "./types";

/** mulberry32 — small, seedable, good enough to walk a game's rules thousands of times. */
export const seeded = (seed: number): Rng => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};
