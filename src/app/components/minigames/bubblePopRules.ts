// Bubble Bath Pop's rules (SPEC §13.3.3), with no canvas in them: where a
// bubble starts, where it is at any age, and which one a tap pops. The
// component runs the loop and draws; the randomness is injected so every
// rule here can be tested.
//
// The first version spawned every bubble in the left 60% of the board and
// drifted it right, so the tub's other half sat empty while the crowded half
// was hard to hit. Now a bubble's whole path is chosen to stay on the board,
// from the left wall to the right.

import type { FrameName } from "@/game/atlas.generated";
import { GAME_H, GAME_W } from "./engine";
import type { Rng } from "./types";

const TAP_SLOP = 6; // extra px of forgiveness around a bubble's radius
// Every bubble is at least this big a target, in CSS px across, measured at
// the 288px canvas a 360px phone gets (the usual touch guideline is 44).
// Before this the 10px bubble was ~24px across at that size.
const TAP_TARGET_CSS = 42;
const REFERENCE_CANVAS_CSS = 288;
// The target as a reach (a radius), in game px.
export const MIN_TAP_REACH = (TAP_TARGET_CSS / 2) * (GAME_W / REFERENCE_CANVAS_CSS);
const SWAY_AMP = 6;
const MAX_DRIFT = 18; // px/s sideways, either way
// Keeps the sprite just clear of the walls so float rounding can never
// push an edge-hugging bubble a hair out.
const EDGE_MARGIN = 1;

// Small bubbles ride the updraft a touch faster than big ones.
export const TIERS: readonly { frame: FrameName; size: number; extraVy: number }[] = [
  { frame: "bubble1", size: 10, extraVy: 7 },
  { frame: "bubble2", size: 16, extraVy: 3 },
  { frame: "bubble3", size: 22, extraVy: 0 },
];

/** A bubble's trajectory: everything needed to place it at any age. */
export type Bubble = {
  frame: FrameName;
  size: number;
  originX: number;
  startY: number;
  vx: number;
  vy: number;
  swayFreq: number;
  swayPhase: number;
};

export type Position = { x: number; y: number };

/** Seconds to rise from `startY` until a bubble of `size` is wholly off the top. */
const riseSeconds = (startY: number, size: number, vy: number): number => (startY + size) / -vy;

/** How long a bubble takes to rise until it is wholly off the top. */
export const lifetimeMs = (bubble: Bubble): number => riseSeconds(bubble.startY, bubble.size, bubble.vy) * 1000;

/**
 * A new bubble at the bottom of the tub. Its horizontal path is a straight
 * drift plus a sway. Both ends of the drift sit at least the sprite's
 * half-width plus `SWAY_AMP` from the walls, so the sprite stays on the
 * board for its whole rise however the sway lands.
 */
export const spawnBubble = (rng: Rng): Bubble => {
  const tier = TIERS[Math.floor(rng() * TIERS.length)]!;
  const startY = GAME_H - 8 - rng() * 6;
  const vy = -(28 + rng() * 10 + tier.extraVy);
  const riseS = riseSeconds(startY, tier.size, vy);

  const min = tier.size / 2 + SWAY_AMP + EDGE_MARGIN;
  const max = GAME_W - min;
  const originX = min + rng() * (max - min);

  // Pick where the drift ends, within what MAX_DRIFT can cover and the walls
  // allow. A line between two on-board points is on the board throughout.
  const reach = MAX_DRIFT * riseS;
  const lo = Math.max(min, originX - reach);
  const hi = Math.min(max, originX + reach);
  const endX = lo + rng() * (hi - lo);

  return {
    frame: tier.frame,
    size: tier.size,
    originX,
    startY,
    vx: (endX - originX) / riseS,
    vy,
    swayFreq: 2 + rng() * 2,
    swayPhase: rng() * Math.PI * 2,
  };
};

/** Where the bubble's centre is `ageMs` after it spawned. */
export const bubbleAt = (bubble: Bubble, ageMs: number): Position => {
  const age = ageMs / 1000;
  return {
    x: bubble.originX + bubble.vx * age + Math.sin(age * bubble.swayFreq + bubble.swayPhase) * SWAY_AMP,
    y: bubble.startY + bubble.vy * age,
  };
};

/**
 * How far from its centre a tap still counts as a hit. With today's tiers
 * the minimum dominates every one of them, so size no longer affects reach.
 */
export const tapReach = (size: number): number => Math.max(size / 2 + TAP_SLOP, MIN_TAP_REACH);

/**
 * The bubble a tap pops: the nearest one whose reach covers the tap, or -1.
 * Reaches overlap now, so the first bubble found is not necessarily the one
 * the player meant. A tie goes to the later one, which is drawn on top.
 */
export const pickBubble = (bubbles: readonly (Position & { size: number })[], tapX: number, tapY: number): number => {
  let best = -1;
  let bestDistance = Infinity;
  bubbles.forEach((bubble, index) => {
    const distance = Math.hypot(bubble.x - tapX, bubble.y - tapY);
    if (distance <= tapReach(bubble.size) && distance <= bestDistance) {
      best = index;
      bestDistance = distance;
    }
  });
  return best;
};
