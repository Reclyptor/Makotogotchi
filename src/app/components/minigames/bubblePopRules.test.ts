import { describe, expect, it } from "vitest";
import {
  bubbleAt,
  lifetimeMs,
  MIN_TAP_REACH,
  pickBubble,
  spawnBubble,
  tapReach,
  TIERS,
  type Bubble,
  type Position,
} from "./bubblePopRules";
import { GAME_H, GAME_W } from "./engine";
import { seeded } from "./testkit";

const SAMPLE_MS = 40;

/** The bubble's centre at every sample from spawn until it is wholly off the top. */
const flight = (bubble: Bubble): Position[] => {
  const path: Position[] = [];
  const end = lifetimeMs(bubble);
  for (let ageMs = 0; ageMs < end; ageMs += SAMPLE_MS) path.push(bubbleAt(bubble, ageMs));
  path.push(bubbleAt(bubble, end));
  return path;
};

// One assertion per bubble on the extremes of its path, not two per sample:
// the property sweep checks thousands of flights, and half a million
// `expect` calls outran the default test timeout on CI.
const expectOnBoard = (bubble: Bubble): void => {
  const xs = flight(bubble).map(({ x }) => x);
  expect(Math.min(...xs) - bubble.size / 2).toBeGreaterThanOrEqual(0);
  expect(Math.max(...xs) + bubble.size / 2).toBeLessThanOrEqual(GAME_W);
};

describe("spawning", () => {
  it("keeps the whole sprite inside the board for the bubble's entire life", () => {
    for (let seed = 1; seed <= 3000; seed++) expectOnBoard(spawnBubble(seeded(seed)));
  });

  it("keeps it there when every roll lands on the same extreme", () => {
    for (const roll of [0, 0.5, 0.999999999]) expectOnBoard(spawnBubble(() => roll));
  });

  it("keeps it there when the rolls alternate between the extremes", () => {
    for (const [first, second] of [[0, 0.999999999], [0.999999999, 0]] as const) {
      let call = 0;
      expectOnBoard(spawnBubble(() => (call++ % 2 === 0 ? first : second)));
    }
  });

  it("rises from the bottom of the tub and leaves off the top", () => {
    for (let seed = 1; seed <= 500; seed++) {
      const bubble = spawnBubble(seeded(seed));
      const { y } = bubbleAt(bubble, 0);
      expect(y).toBeGreaterThan(GAME_H - 16);
      expect(y).toBeLessThan(GAME_H);
      expect(bubbleAt(bubble, lifetimeMs(bubble)).y).toBeCloseTo(-bubble.size, 6);
    }
  });

  it("fills every third of the board, so a drift back into one corner fails", () => {
    const thirds = [0, 0, 0];
    for (let seed = 1; seed <= 3000; seed++) {
      for (const { x } of flight(spawnBubble(seeded(seed)))) {
        thirds[Math.min(2, Math.floor((x / GAME_W) * 3))]! += 1;
      }
    }
    const total = thirds.reduce((sum, count) => sum + count, 0);
    for (const count of thirds) expect(count / total).toBeGreaterThan(0.2);
  });

  it("drifts both ways", () => {
    const drifts = Array.from({ length: 500 }, (_, seed) => spawnBubble(seeded(seed + 1)).vx);
    expect(drifts.some((vx) => vx < -1)).toBe(true);
    expect(drifts.some((vx) => vx > 1)).toBe(true);
  });
});

describe("tapping", () => {
  const at = (x: number, y: number, size = 16) => ({ x, y, size });

  it("gives even the smallest bubble at least the minimum reach", () => {
    for (const tier of TIERS) expect(tapReach(tier.size)).toBeGreaterThanOrEqual(MIN_TAP_REACH);
  });

  it("makes the smallest bubble a touch-sized target at the 288px reference canvas", () => {
    const smallest = Math.min(...TIERS.map((tier) => tier.size));
    const targetCss = 2 * tapReach(smallest) * (288 / GAME_W);
    expect(targetCss).toBeGreaterThanOrEqual(40);
    expect(targetCss).toBeLessThanOrEqual(44);
  });

  it("pops a bubble from as far off as its reach and no further", () => {
    const smallest = Math.min(...TIERS.map((tier) => tier.size));
    const bubbles = [at(0, 60, smallest)];
    expect(pickBubble(bubbles, MIN_TAP_REACH, 60)).toBe(0);
    expect(pickBubble(bubbles, MIN_TAP_REACH + 0.5, 60)).toBe(-1);
  });

  it("returns -1 on a miss and on an empty tub", () => {
    expect(pickBubble([at(40, 40), at(200, 80)], 120, 20)).toBe(-1);
    expect(pickBubble([], 120, 20)).toBe(-1);
  });

  it("pops the nearest bubble when several are in reach, whatever their order", () => {
    const near = at(100, 60);
    const far = at(112, 60);
    expect(pickBubble([near, far], 103, 60)).toBe(0);
    expect(pickBubble([far, near], 103, 60)).toBe(1);
  });

  it("gives a tie to the bubble drawn on top", () => {
    expect(pickBubble([at(90, 60), at(110, 60)], 100, 60)).toBe(1);
  });

  it("measures nearness to the centre, not to the edge of the sprite", () => {
    const big = at(100, 60, 22);
    const small = at(104, 60, 10);
    expect(pickBubble([small, big], 102.5, 60)).toBe(0);
    expect(pickBubble([small, big], 101.5, 60)).toBe(1);
  });
});
