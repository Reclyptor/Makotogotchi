// The picture on the wall (SPEC §13.2, §22.3): Natsumi and her mouse.
//
// The rest of the room's decor is a handful of rectangles, which is all a plant
// or a lamp needs. A portrait is not — the whole point of it is that there is
// something to look at — so this one piece of decor is a real drawing, put
// through a pixel filter by scripts/art/portrait.ts and landed here as a grid of
// palette letters. `.` is the drawing's own paper, not transparency: the
// picture is an opaque rectangle, and the frame that holds it belongs to the
// room, not to the art.
//
// Its palette is the drawing's and not the theme's. Everything else in the room
// repaints when the walls do (§22.5); a painting hanging on those walls does
// not.

import type { SceneContext } from "../engine/digest";
import { lay, makeCanvas } from "../engine/offscreen";
import { PORTRAIT_PALETTE, PORTRAIT_PIXELS } from "./portrait.generated";

export const PORTRAIT_WIDTH = PORTRAIT_PIXELS[0]!.length;
export const PORTRAIT_HEIGHT = PORTRAIT_PIXELS.length;

/**
 * The grid as RGBA, built once when the module loads.
 *
 * A ragged row or a letter with no colour would mean the generated file and the
 * script that writes it have come apart, and painting a hole and carrying on
 * would ship a picture with a hole in it. It throws here instead, where
 * `portrait.test.ts` reads it on every run, so a bad generation fails on the
 * bench rather than on a wall.
 */
const compile = (): Uint8ClampedArray => {
  const buffer = new Uint8ClampedArray(PORTRAIT_WIDTH * PORTRAIT_HEIGHT * 4);
  PORTRAIT_PIXELS.forEach((row, y) => {
    if (row.length !== PORTRAIT_WIDTH) {
      throw new Error(`portrait row ${y} is ${row.length} pixels wide, expected ${PORTRAIT_WIDTH}`);
    }
    for (let x = 0; x < PORTRAIT_WIDTH; x++) {
      const letter = row[x]!;
      const colour = PORTRAIT_PALETTE[letter];
      if (!colour) throw new Error(`portrait uses '${letter}' at ${x},${y}, which is not in the palette`);
      const offset = (y * PORTRAIT_WIDTH + x) * 4;
      buffer[offset] = colour[0];
      buffer[offset + 1] = colour[1];
      buffer[offset + 2] = colour[2];
      buffer[offset + 3] = 255;
    }
  });
  return buffer;
};

const RGBA = compile();

/**
 * The picture, held on a canvas of its own so a frame costs one blit.
 *
 * The room paints twice a frame — once into the digest and again onto the
 * canvas only if the hash moved (engine/digest.ts) — so the alternative is
 * folding the several hundred rectangles this decomposes into through both
 * passes forever, for art that cannot change. One `drawImage` says the same
 * thing.
 */
export class Portrait {
  private canvas: HTMLCanvasElement | null = null;

  /** Draws the picture with its top-left corner at `x, y`. */
  render(ctx: SceneContext, x: number, y: number): void {
    this.canvas ??= this.toCanvas();
    if (this.canvas) {
      ctx.drawImage(this.canvas, x, y);
      return;
    }
    // Nothing to cache onto — no document under test, or a browser that has
    // stopped handing back 2D contexts. The picture still has to land.
    lay(ctx, RGBA, PORTRAIT_WIDTH, PORTRAIT_HEIGHT, x, y);
  }

  private toCanvas(): HTMLCanvasElement | null {
    const canvas = makeCanvas(PORTRAIT_WIDTH, PORTRAIT_HEIGHT);
    const target = canvas?.getContext("2d");
    if (!canvas || !target) return null;
    lay(target, RGBA, PORTRAIT_WIDTH, PORTRAIT_HEIGHT);
    return canvas;
  }
}
