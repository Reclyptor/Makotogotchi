// Shared minigame plumbing: the rAF loop and sprite blitting helpers every
// game canvas uses. Games stay pure render-and-input; the Shell owns the
// server protocol.

import { SPRITE_FRAMES, type FrameName } from "@/game/atlas.generated";

export const GAME_W = 260;
export const GAME_H = 120;

/** Fixed-clamp rAF loop; returns a stop function. dt arrives in ms, ≤50. */
export const startGameLoop = (step: (dtMs: number, nowMs: number) => void): (() => void) => {
  let raf = 0;
  let last = performance.now();
  let running = true;
  const frame = (now: number): void => {
    if (!running) return;
    step(Math.min(50, now - last), now);
    last = now;
    if (running) raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);
  return () => {
    running = false;
    cancelAnimationFrame(raf);
  };
};

/** Blit a frame at an exact rectangle. */
export const drawFrame = (
  ctx: CanvasRenderingContext2D,
  sheet: HTMLImageElement,
  name: FrameName,
  x: number,
  y: number,
  w: number,
  h: number,
): void => {
  const frame = SPRITE_FRAMES[name];
  ctx.drawImage(sheet, frame.x, frame.y, frame.w, frame.h, Math.round(x), Math.round(y), w, h);
};

/** Blit a frame scaled to a height, bottom-center anchored — how pets stand. */
export const drawFrameAnchored = (
  ctx: CanvasRenderingContext2D,
  sheet: HTMLImageElement,
  name: FrameName,
  centerX: number,
  bottomY: number,
  height: number,
): void => {
  const frame = SPRITE_FRAMES[name];
  const width = Math.round((frame.w / frame.h) * height);
  drawFrame(ctx, sheet, name, centerX - width / 2, bottomY - height, width, height);
};
