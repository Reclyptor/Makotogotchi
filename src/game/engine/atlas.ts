// Sprite atlas: loads the sheet once and blits named frames with
// pixel-snapped positions (SPEC §10.3).

import { SPRITE_FRAMES, type FrameName } from "../atlas.generated";

export class Atlas {
  private image: HTMLImageElement | null = null;

  load(src: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => {
        this.image = image;
        resolve();
      };
      image.onerror = () => reject(new Error(`failed to load spritesheet: ${src}`));
      image.src = src;
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
