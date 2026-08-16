// Sprite atlas: loads the sheet and blits named frames with pixel-snapped
// positions (SPEC §10.3). Loading retries with backoff — a single dropped
// image request (flaky mobile network, tab restored mid-fetch) must degrade
// to a late pet, never a permanently empty room.

import { SPRITE_FRAMES, type FrameName } from "../atlas.generated";

const LOAD_ATTEMPTS = 4;
const RETRY_BASE_MS = 600;

export class Atlas {
  private image: HTMLImageElement | null = null;

  async load(src: string): Promise<void> {
    for (let attempt = 1; attempt <= LOAD_ATTEMPTS; attempt++) {
      try {
        this.image = await this.loadOnce(src, attempt);
        return;
      } catch {
        if (attempt === LOAD_ATTEMPTS) {
          console.error(`spritesheet failed to load after ${LOAD_ATTEMPTS} attempts: ${src}`);
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, RETRY_BASE_MS * attempt));
      }
    }
  }

  private loadOnce(src: string, attempt: number): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error(`failed to load spritesheet: ${src}`));
      // A cache-busting query on retries sidesteps a poisoned cache entry.
      image.src = attempt === 1 ? src : `${src}?retry=${attempt}`;
    });
  }

  get ready(): boolean {
    return this.image !== null;
  }

  frame(name: FrameName): { w: number; h: number } {
    return SPRITE_FRAMES[name];
  }

  /** Draw a frame with its bottom-center anchored at (x, y), snapped. */
  draw(ctx: CanvasRenderingContext2D, name: FrameName, x: number, y: number): void {
    if (!this.image) return;
    const frame = SPRITE_FRAMES[name];
    const dx = Math.round(x - frame.w / 2);
    const dy = Math.round(y - frame.h);
    ctx.drawImage(this.image, frame.x, frame.y, frame.w, frame.h, dx, dy, frame.w, frame.h);
  }
}
