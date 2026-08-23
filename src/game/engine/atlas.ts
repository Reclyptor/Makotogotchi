// Sprite atlas: loads the sheet and blits named frames with pixel-snapped
// positions (SPEC §10.3). Loading retries with backoff — a single dropped
// image request (flaky mobile network, tab restored mid-fetch) must degrade
// to a late pet, never a permanently empty room.

import type { SceneContext } from "./digest";
import { SPRITE_FRAMES, type FrameName, type SpriteFrame } from "../atlas.generated";

const LOAD_ATTEMPTS = 4;
const RETRY_BASE_MS = 600;

const loadOnce = (src: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`failed to load spritesheet: ${src}`));
    // Retries re-request the SAME URL (SPEC §10.2): the sheet is
    // content-hashed and served immutable, so a cache-busting query would
    // pin a year-long browser and edge entry per attempt to sidestep a
    // poisoned cache the hashing already makes impossible — the only way
    // the bytes can be wrong is a transfer that failed outright.
    image.src = src;
  });

/** Load the sheet with backoff; null only after every attempt failed. */
export const loadSpriteSheet = async (src: string): Promise<HTMLImageElement | null> => {
  for (let attempt = 1; attempt <= LOAD_ATTEMPTS; attempt++) {
    try {
      return await loadOnce(src);
    } catch {
      if (attempt < LOAD_ATTEMPTS) {
        await new Promise((resolve) => setTimeout(resolve, RETRY_BASE_MS * attempt));
      }
    }
  }
  console.error(`spritesheet failed to load after ${LOAD_ATTEMPTS} attempts: ${src}`);
  return null;
};

/**
 * Where a frame lands on the canvas: bottom-center anchored at (x, y),
 * scaled, and snapped to whole pixels so the art never lands half a pixel
 * off and blurs. Pure, so the life-stage scaling is directly testable.
 */
export const drawRect = (
  frame: SpriteFrame,
  x: number,
  y: number,
  scale: number,
): { dx: number; dy: number; dw: number; dh: number } => {
  const dw = Math.round(frame.w * scale);
  const dh = Math.round(frame.h * scale);
  return { dx: Math.round(x - dw / 2), dy: Math.round(y - dh), dw, dh };
};

export class Atlas {
  private image: HTMLImageElement | null = null;

  async load(src: string): Promise<void> {
    this.image = await loadSpriteSheet(src);
  }

  get ready(): boolean {
    return this.image !== null;
  }

  frame(name: FrameName): { w: number; h: number } {
    return SPRITE_FRAMES[name];
  }

  /** Draw a frame with its bottom-center anchored at (x, y), snapped. */
  draw(ctx: SceneContext, name: FrameName, x: number, y: number, scale = 1): void {
    if (!this.image) return;
    const frame = SPRITE_FRAMES[name];
    const { dx, dy, dw, dh } = drawRect(frame, x, y, scale);
    ctx.drawImage(this.image, frame.x, frame.y, frame.w, frame.h, dx, dy, dw, dh);
  }
}
