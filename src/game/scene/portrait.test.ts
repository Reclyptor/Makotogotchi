// The picture is generated, so what is worth testing is not what it draws but
// that the generated grid and the code that reads it still agree — that is the
// seam a re-run of `npm run art:portrait` can break. Importing the module runs its
// compile step, so a ragged row or an off-palette letter fails this file before
// an assertion is reached; the rest holds the frame the room sizes itself from.

import { describe, expect, it } from "vitest";
import { Portrait, PORTRAIT_HEIGHT, PORTRAIT_WIDTH } from "./portrait";
import { PORTRAIT_PALETTE, PORTRAIT_PIXELS } from "./portrait.generated";
import type { SceneContext } from "../engine/digest";

/** Records the one call the picture is allowed to make in a headless run. */
const layingContext = () => {
  const laid: { width: number; height: number; dx: number; dy: number; data: Uint8ClampedArray }[] = [];
  const ctx = {
    createImageData: (w: number, h: number) =>
      ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }) as ImageData,
    putImageData: (image: ImageData, dx: number, dy: number) => {
      laid.push({ width: image.width, height: image.height, dx, dy, data: image.data });
    },
    drawImage: () => {
      throw new Error("there is no canvas under test to blit from");
    },
  };
  return { ctx: ctx as unknown as SceneContext, laid };
};

const rendered = (x = 0, y = 0) => {
  const { ctx, laid } = layingContext();
  new Portrait().render(ctx, x, y);
  return laid;
};

describe("the framed picture", () => {
  it("is a rectangle the room can size a frame from", () => {
    expect(PORTRAIT_WIDTH).toBe(48);
    expect(PORTRAIT_HEIGHT).toBe(48);
  });

  it("is square, every row the same length", () => {
    expect(PORTRAIT_PIXELS).toHaveLength(PORTRAIT_HEIGHT);
    expect(new Set(PORTRAIT_PIXELS.map((row) => row.length))).toEqual(new Set([PORTRAIT_WIDTH]));
  });

  it("spends every colour the generator gave it", () => {
    // A palette entry no pixel uses means the quantizer and the grid have come
    // apart — the generated file was edited, or written by a different run.
    const used = new Set(PORTRAIT_PIXELS.flatMap((row) => [...row]));
    expect([...used].sort()).toEqual(Object.keys(PORTRAIT_PALETTE).sort());
  });

  it("lays itself down where it is asked to, at its own size", () => {
    const laid = rendered(42, 36);
    expect(laid).toHaveLength(1);
    expect(laid[0]).toMatchObject({ width: PORTRAIT_WIDTH, height: PORTRAIT_HEIGHT, dx: 42, dy: 36 });
  });

  it("is opaque everywhere, so the wall never shows through it", () => {
    const { data } = rendered()[0]!;
    const clear: number[] = [];
    for (let index = 3; index < data.length; index += 4) if (data[index] !== 255) clear.push((index - 3) / 4);
    expect(clear).toEqual([]);
  });

  it("paints the same picture however many times it is rendered", () => {
    const portrait = new Portrait();
    const first = layingContext();
    const second = layingContext();
    portrait.render(first.ctx, 0, 0);
    portrait.render(second.ctx, 0, 0);
    expect([...second.laid[0]!.data]).toEqual([...first.laid[0]!.data]);
  });

  it("kept the drawing's paper as its lightest colour and its ink as its darkest", () => {
    // The filter sorts the palette light to dark; if that ordering ever broke,
    // the grid's letters would still compile but read as a negative.
    const luminance = Object.values(PORTRAIT_PALETTE).map(([r, g, b]) => r + g + b);
    expect(luminance).toEqual([...luminance].sort((a, b) => b - a));
    expect(luminance[0]).toBeGreaterThan(700); // paper, near white
    expect(luminance.at(-1)).toBeLessThan(300); // ink
  });
});
