// Retro mode's post-pass (SPEC §26.5).

import { describe, expect, it } from "vitest";
import { renderRetro } from "./retro";
import { ROOM_HEIGHT, ROOM_WIDTH } from "./backdrop";
import { DigestContext } from "../engine/digest";

const hashOf = (draw: (ctx: DigestContext) => void): number => {
  const digest = new DigestContext();
  digest.reset();
  draw(digest);
  return digest.value;
};

/** Every fillStyle the pass sets, in order, with the alpha in force. */
const paints = (): { style: string; alpha: number }[] => {
  const seen: { style: string; alpha: number }[] = [];
  const ctx = {
    imageSmoothingEnabled: false,
    globalAlpha: 1,
    fillStyle: "" as string | CanvasGradient | CanvasPattern,
    font: "",
    textAlign: "start" as CanvasTextAlign,
    save: () => {},
    restore: () => {},
    setTransform: () => {},
    translate: () => {},
    scale: () => {},
    beginPath: () => {},
    rect: () => {},
    clip: () => {},
    fillRect: () => {
      seen.push({ style: String(ctx.fillStyle), alpha: ctx.globalAlpha });
    },
    fillText: () => {},
    drawImage: () => {},
    createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }) as ImageData,
    putImageData: () => {},
  };
  renderRetro(ctx);
  return seen;
};

describe("retro mode (SPEC §26.5)", () => {
  it("draws the same thing every time, so it never forces a repaint by itself", () => {
    expect(hashOf(renderRetro)).toBe(hashOf(renderRetro));
  });

  it("changes the frame — a television you cannot see is not one", () => {
    const bare = hashOf(() => {});
    expect(hashOf(renderRetro)).not.toBe(bare);
  });

  it("lays a scanline over every other row of the canvas", () => {
    const scanlines = paints().filter((paint) => paint.style === "#000000" && paint.alpha === 0.08);
    expect(scanlines).toHaveLength(Math.ceil(ROOM_HEIGHT / 2));
  });

  it("never uses a gradient, which the digest cannot tell apart", () => {
    // engine/digest.ts folds any non-string fillStyle in as the literal
    // "object-fill", so two different gradients hash identically. One whose
    // appearance changed would never repaint and would freeze on screen.
    for (const paint of paints()) {
      expect(paint.style).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it("leaves the context's alpha as it found it", () => {
    // The pass runs last in the frame, but `layer()` only restores the save
    // stack — a leaked globalAlpha would tint the next frame's backdrop.
    const digest = new DigestContext();
    digest.reset();
    digest.globalAlpha = 1;
    renderRetro(digest);
    expect(digest.globalAlpha).toBe(1);
  });

  it("keeps every mark inside the canvas", () => {
    const bounds: { x: number; y: number; w: number; h: number }[] = [];
    const ctx = {
      imageSmoothingEnabled: false,
      globalAlpha: 1,
      fillStyle: "" as string | CanvasGradient | CanvasPattern,
      font: "",
      textAlign: "start" as CanvasTextAlign,
      save: () => {},
      restore: () => {},
      setTransform: () => {},
      translate: () => {},
      scale: () => {},
      beginPath: () => {},
      rect: () => {},
      clip: () => {},
      fillRect: (x: number, y: number, w: number, h: number) => void bounds.push({ x, y, w, h }),
      fillText: () => {},
      drawImage: () => {},
      createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }) as ImageData,
      putImageData: () => {},
    };
    renderRetro(ctx);
    for (const rect of bounds) {
      expect(rect.x).toBeGreaterThanOrEqual(0);
      expect(rect.y).toBeGreaterThanOrEqual(0);
      expect(rect.x + rect.w).toBeLessThanOrEqual(ROOM_WIDTH);
      expect(rect.y + rect.h).toBeLessThanOrEqual(ROOM_HEIGHT);
    }
  });
});
