// Static art, held on a canvas of its own so a frame costs one blit.
//
// Two things in the room are expensive to compose and then never change until
// something invalidates them — the architecture (SPEC §22.2) and the framed
// picture (§22.3). Both want the same two operations, and both have to cope
// with there being no canvas to cache onto: the room composes under Node in
// the tests, and a browser stops handing back 2D contexts once a page holds
// too much canvas. Neither may fail closed — a scene that skips its blit
// shows whatever last landed on the canvas — so `makeCanvas` returning null
// is a routine outcome with a slower path behind it, not an error.

import type { SceneContext } from "./digest";

/** An offscreen canvas, or null where there is no document to make one on. */
export const makeCanvas = (width: number, height: number): HTMLCanvasElement | null => {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
};

/** An RGBA buffer laid straight onto a context — the path with no canvas. */
export const lay = (
  target: SceneContext,
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  dx = 0,
  dy = 0,
): void => {
  const image = target.createImageData(width, height);
  image.data.set(pixels);
  target.putImageData(image, dx, dy);
};
