import { describe, expect, it } from "vitest";
import { isWantKind, WANT_KINDS, WANT_WINDOW_TICKS, wantAt, windowEndTick, windowIndexAt } from "./wants";
import { quirks } from "./quirks";
import { FOOD_ITEM_IDS } from "./economy";
import { MINIGAME_IDS } from "./minigames";

const SEED = 0xc0ffee;
const SPAN = 4000; // windows swept — 400 pet-days

const sweep = (seed = SEED): NonNullable<ReturnType<typeof wantAt>>[] =>
  Array.from({ length: SPAN }, (_, windowIndex) => wantAt(seed, windowIndex)).filter((want) => want !== null);

describe("pet wants (SPEC §25.1)", () => {
  it("draws the same want for the same seed and window on every client", () => {
    for (let windowIndex = 0; windowIndex < 2000; windowIndex++) {
      expect(wantAt(SEED, windowIndex)).toEqual(wantAt(SEED, windowIndex));
    }
  });

  it("draws roughly one window in three", () => {
    const count = sweep().length;
    expect(count).toBeGreaterThan(SPAN * 0.28);
    expect(count).toBeLessThan(SPAN * 0.39);
  });

  it("weights the table: cravings really do come up most often", () => {
    const wants = sweep();
    const count = (kind: string): number => wants.filter((want) => want.kind === kind).length;
    for (const kind of WANT_KINDS) expect(count(kind)).toBeGreaterThan(0);
    expect(count("crave-food")).toBeGreaterThan(count("play-game"));
    expect(count("crave-food")).toBeGreaterThan(count("cuddle"));
    expect(count("crave-food")).toBeGreaterThan(count("dust-bath"));
  });

  it("never craves the generation's disliked food", () => {
    for (const seed of [SEED, 1337, 42]) {
      const { dislikedFood } = quirks(seed);
      for (const want of sweep(seed)) {
        if (want.kind !== "crave-food") continue;
        expect(FOOD_ITEM_IDS).toContain(want.itemId);
        expect(want.itemId).not.toBe(dislikedFood);
      }
    }
  });

  it("names an item exactly when the kind wants one", () => {
    for (const want of sweep()) {
      if (want.kind === "play-game") {
        expect(MINIGAME_IDS).toContain(want.itemId);
      } else if (want.kind === "cuddle" || want.kind === "dust-bath") {
        // The key must be absent, not undefined — the payload is built by
        // conditional spread so it serializes identically everywhere.
        expect("itemId" in want).toBe(false);
      }
    }
  });

  it("indexes windows by floor division and ends them one past the span", () => {
    expect(windowIndexAt(0)).toBe(0);
    expect(windowIndexAt(WANT_WINDOW_TICKS - 1)).toBe(0);
    expect(windowIndexAt(WANT_WINDOW_TICKS)).toBe(1);
    expect(windowEndTick(0)).toBe(WANT_WINDOW_TICKS);
    expect(windowEndTick(3)).toBe(4 * WANT_WINDOW_TICKS);
  });

  it("recognizes its own kinds and nothing else", () => {
    for (const kind of WANT_KINDS) expect(isWantKind(kind)).toBe(true);
    expect(isWantKind("AMBIENT")).toBe(false);
    expect(isWantKind(undefined)).toBe(false);
  });
});
