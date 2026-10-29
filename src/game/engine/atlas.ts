// Sprite atlas: loads the sheet and blits named frames with pixel-snapped
// positions (SPEC §10.3). Loading retries with backoff — a single dropped
// image request (flaky mobile network, tab restored mid-fetch) must degrade
// to a late pet, never a permanently empty room.

import type { SceneContext } from "./digest";
import { SPRITE_FRAMES, SPRITE_MASKS, SPRITE_MOUTHS, type FrameName } from "../atlas.generated";
import { GARMENT_REGIONS } from "../scene/garment.generated";
import { layer } from "./layer";
import { makeCanvas } from "./offscreen";
import { drawRect, overlayOffset } from "./placement";

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
 * Every frame with something in front of the head — a prop, or a mouth — or a
 * garment whose edge the beard keeps to, in the order their slots sit on a strip. The prop frames come first, so a slot
 * never moves when a mouth is found on another frame.
 */
const MASKED = [
  ...new Set([...Object.keys(SPRITE_MASKS), ...Object.keys(SPRITE_MOUTHS), ...Object.keys(GARMENT_REGIONS)]),
] as FrameName[];

/**
 * One overlay, clipped once per masked frame: slot i holds it as it shows on
 * MASKED[i], composed at the anchor recorded beside it.
 */
type Strip = { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; composedAt: Map<FrameName, string> };

/** Something painted in a frame's own pixels to cut out of an overlay, on top of the frame's masks. */
export type OverlayClip = {
  /** Names what the clip is, so an overlay is recomposed when it changes. */
  key: string;
  paint: (target: SceneContext) => void;
};

export class Atlas {
  private image: HTMLImageElement | null = null;
  private readonly strips = new Map<FrameName, Strip | null>();
  private readonly painted = new Map<string, HTMLCanvasElement | null>();

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

  /**
   * Draw an overlay at full size as `draw` does, behind whatever `under`'s
   * mask says stands in front of the head there — the cup, the controller,
   * the quilt — and behind the frame's own mouth (SPEC §21.9). A frame with
   * neither has nothing in front, and gets the plain draw.
   *
   * The clipped overlay is composed once per frame into its slot of one
   * offscreen strip and blitted from there, so a paint allocates nothing and
   * the slot's source rectangle names the frame to the digest the way a
   * sheet rectangle does (engine/digest.ts). Slots sit on the strip's top
   * row, which no sheet rectangle does — the packer starts below a gutter.
   */
  drawOver(ctx: SceneContext, name: FrameName, x: number, y: number, under: FrameName, clip?: OverlayClip): void {
    const image = this.image;
    if (!image) return;
    const masks = [SPRITE_MASKS[under], SPRITE_MOUTHS[under]].flatMap((mask) => mask ?? []);
    const strip = masks.length > 0 || clip ? this.strip(name) : null;
    // No document to compose on (the tests), or a browser out of contexts:
    // the overlay still has to land, over the prop rather than not at all.
    if (!strip) {
      this.draw(ctx, name, x, y);
      return;
    }
    const overlay = SPRITE_FRAMES[name];
    const slot = MASKED.indexOf(under) * overlay.w;
    const at = `${x},${y},${clip?.key ?? ""}`;
    if (strip.composedAt.get(under) !== at) {
      const offset = overlayOffset(SPRITE_FRAMES[under], overlay, x, y);
      const target = strip.ctx;
      layer(target, () => {
        target.beginPath();
        target.rect(slot, 0, overlay.w, overlay.h);
        target.clip();
        target.clearRect(slot, 0, overlay.w, overlay.h);
        target.drawImage(image, overlay.x, overlay.y, overlay.w, overlay.h, slot, 0, overlay.w, overlay.h);
        // The masks are in the frame's own pixels; the slot is the overlay's.
        target.globalCompositeOperation = "destination-out";
        for (const mask of masks) {
          target.drawImage(image, mask.x, mask.y, mask.w, mask.h, slot - offset.x, -offset.y, mask.w, mask.h);
        }
        if (clip) {
          target.translate(slot - offset.x, -offset.y);
          clip.paint(target);
        }
      });
      strip.composedAt.set(under, at);
    }
    const { dx, dy, dw, dh } = drawRect(overlay, x, y, 1);
    ctx.drawImage(strip.canvas, slot, 0, overlay.w, overlay.h, dx, dy, dw, dh);
  }

  /**
   * Draw something painted in a frame's own pixels — a worn garment, which is
   * derived from the pose rather than a sprite of its own — behind the same
   * masks `drawOver` honours. `extent` is the canvas it needs in the frame's
   * pixels (a tail hangs past the frame, so its left edge may be negative),
   * and `paint` draws in them with the frame's top-left at the origin.
   *
   * Painted and clipped once per (key, frame), then blitted from a canvas of
   * its own, so a paint allocates nothing. The frame, not the overlay, is what
   * changes the digest's picture of the room (engine/digest.ts), so a pose
   * change is seen by the sprite it draws beside this.
   */
  drawPainted(
    ctx: SceneContext,
    key: string,
    under: FrameName,
    extent: { x: number; y: number; w: number; h: number },
    paint: (target: SceneContext) => void,
  ): void {
    const image = this.image;
    if (!image) return;
    const frame = drawRect(SPRITE_FRAMES[under], 0, 0, 1);
    const id = `${key}:${under}`;
    if (!this.painted.has(id)) this.painted.set(id, this.compose(image, under, extent, paint));
    const canvas = this.painted.get(id);
    if (canvas) {
      ctx.drawImage(canvas, frame.dx + extent.x, frame.dy + extent.y);
      return;
    }
    // No document to compose on (the tests), or a browser out of contexts:
    // the garment still has to land, over the prop rather than not at all.
    layer(ctx, () => {
      ctx.translate(frame.dx, frame.dy);
      paint(ctx);
    });
  }

  private compose(
    image: HTMLImageElement,
    under: FrameName,
    extent: { x: number; y: number; w: number; h: number },
    paint: (target: SceneContext) => void,
  ): HTMLCanvasElement | null {
    const canvas = makeCanvas(extent.w, extent.h);
    const target = canvas?.getContext("2d");
    if (!canvas || !target) return null;
    layer(target, () => {
      target.translate(-extent.x, -extent.y);
      paint(target);
      target.setTransform(1, 0, 0, 1, 0, 0);
      target.globalCompositeOperation = "destination-out";
      for (const mask of [SPRITE_MASKS[under], SPRITE_MOUTHS[under]]) {
        if (mask) target.drawImage(image, mask.x, mask.y, mask.w, mask.h, -extent.x, -extent.y, mask.w, mask.h);
      }
    });
    return canvas;
  }

  private strip(name: FrameName): Strip | null {
    if (!this.strips.has(name)) {
      const overlay = SPRITE_FRAMES[name];
      const canvas = makeCanvas(overlay.w * MASKED.length, overlay.h);
      const ctx = canvas?.getContext("2d");
      this.strips.set(name, canvas && ctx ? { canvas, ctx, composedAt: new Map() } : null);
    }
    return this.strips.get(name)!;
  }
}
