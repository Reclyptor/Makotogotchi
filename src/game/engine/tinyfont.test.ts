import { describe, expect, it } from "vitest";
import { drawTiny, TINY_PITCH, tinyGlyphs, tinyWidth } from "./tinyfont";
import type { SceneContext } from "./digest";

const recording = () => {
  const dots: [number, number][] = [];
  const ctx = { fillStyle: "", fillRect: (x: number, y: number) => void dots.push([x, y]) };
  return { ctx: ctx as unknown as SceneContext, dots };
};

describe("the plaque font", () => {
  it("measures four pixels a character, minus the trailing gap", () => {
    expect(tinyWidth("")).toBe(0);
    expect(tinyWidth("A")).toBe(3);
    expect(tinyWidth("MAKOTO")).toBe(6 * TINY_PITCH - 1);
  });

  it("folds names to capitals without their accents", () => {
    expect(tinyGlyphs("Émilie")).toEqual([..."EMILIE"]);
    expect(tinyGlyphs("mochi-2")).toEqual([..."MOCHI-2"]);
  });

  it("draws a glyph's pixels where they belong and a box for what it cannot", () => {
    const { ctx, dots } = recording();
    drawTiny(ctx, "I", 10, 20, "#000");
    // An I: the full top and bottom rows, the middle column between.
    expect(dots).toEqual([[10, 20], [11, 20], [12, 20], [11, 21], [11, 22], [11, 23], [10, 24], [11, 24], [12, 24]]);
    const box = recording();
    drawTiny(box.ctx, "字", 0, 0, "#000");
    expect(box.dots).toHaveLength(12);
  });

  it("advances one pitch per character, spaces included", () => {
    const { ctx, dots } = recording();
    drawTiny(ctx, "I I", 0, 0, "#000");
    expect(Math.max(...dots.map(([x]) => x))).toBe(2 * TINY_PITCH + 2);
  });
});
