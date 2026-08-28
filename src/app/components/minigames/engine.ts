// Shared minigame plumbing: the rAF loop and sprite blitting helpers every
// game canvas uses. Games stay pure render-and-input; the Shell owns the
// server protocol.

import { SPRITE_FRAMES, type FrameName } from "@/game/atlas.generated";
import { MINIGAME_COUNTDOWN_MS } from "@/sim/minigames";

export const GAME_W = 260;
export const GAME_H = 120;

export type GameLoop = {
  /** Stop the loop. */
  stop: () => void;
  /** False until the pre-roll expires; input handlers gate on it. */
  armed: () => boolean;
};

/** Fixed-clamp rAF loop; dt arrives in ms, ≤50.
 *
 * Every run opens with the shared pre-roll (SPEC §13.3.1). The step runs from
 * the very first frame, so the board paints its opening position immediately,
 * but dt stays 0 until the count expires — which freezes every clock, spawner,
 * and animation a game derives from it without any game knowing. Games gate
 * their input handlers on `armed()` so a frozen board cannot be played. */
export const startGameLoop = (step: (dtMs: number, nowMs: number) => void): GameLoop => {
  let raf = 0;
  let last = performance.now();
  const armAtMs = last + MINIGAME_COUNTDOWN_MS;
  let running = true;
  const armed = (): boolean => performance.now() >= armAtMs;
  const frame = (now: number): void => {
    if (!running) return;
    step(now >= armAtMs ? Math.min(50, now - last) : 0, now);
    last = now;
    if (running) raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);
  return {
    stop: () => {
      running = false;
      cancelAnimationFrame(raf);
    },
    armed,
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

/** Blit a frame upside down: an overturned bowl is the same sprite, flipped. */
export const drawFrameFlipped = (
  ctx: CanvasRenderingContext2D,
  sheet: HTMLImageElement,
  name: FrameName,
  x: number,
  y: number,
  w: number,
  h: number,
): void => {
  const frame = SPRITE_FRAMES[name];
  ctx.save();
  ctx.translate(Math.round(x), Math.round(y) + h);
  ctx.scale(1, -1);
  ctx.drawImage(sheet, frame.x, frame.y, frame.w, frame.h, 0, 0, w, h);
  ctx.restore();
};

/**
 * Blit a frame centred on a point, scaled so its longer side fits `box` and
 * its proportions survive — how loose objects fly.
 *
 * The squarer sprites (bubbles, the wheel) can be blitted into a square
 * safely, but the meal frames run from 82×38 to 55×66, and forcing those into
 * one they do not have turns a fish into an unrecognisable smear at 20px.
 */
export const drawFrameFitted = (
  ctx: CanvasRenderingContext2D,
  sheet: HTMLImageElement,
  name: FrameName,
  centerX: number,
  centerY: number,
  box: number,
): void => {
  const frame = SPRITE_FRAMES[name];
  const scale = box / Math.max(frame.w, frame.h);
  const width = frame.w * scale;
  const height = frame.h * scale;
  drawFrame(ctx, sheet, name, centerX - width / 2, centerY - height / 2, width, height);
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
