// Canvas state, stacked and always unstacked (SPEC §10.1).
//
// The loop swallows a throwing frame so one bad frame cannot freeze the scene
// (engine/loop.ts). That makes every bare save()/restore() pair a trap: the
// throw escapes between them, and the context keeps that frame's transform,
// clip and alpha — not for a frame, but for the life of the canvas. Nothing
// clears it afterwards either, because the only full-canvas paint is the
// backdrop blit, and a leaked transform or clip is exactly what stops that
// blit from covering the canvas.
//
// Pairing the two calls in a `finally` removes the trap by construction
// instead of by discipline: the state comes back whether `draw` returns or
// throws, and the throw still reaches the loop's guard.

export const layer = (ctx: CanvasRenderingContext2D, draw: () => void): void => {
  ctx.save();
  try {
    draw();
  } finally {
    ctx.restore();
  }
};
