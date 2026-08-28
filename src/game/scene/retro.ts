// Retro mode (SPEC §26.5): the keepsake half of the ancient code. A post-pass
// over the finished frame that makes the room look like it is being watched on
// a CRT — scanlines, a warm phosphor bloom, and a vignette into the corners.
//
// The canvas only. The surrounding UI is not inside the television.
//
// Nothing here uses a CanvasGradient, and that is a hard constraint rather
// than a preference: `DigestContext` stringifies every non-string `fillStyle`
// to the literal "object-fill" (engine/digest.ts), so two different gradients
// hash identically. A gradient whose appearance changed would therefore never
// move the hash, never trigger a repaint, and freeze on screen. Flat rects
// have no such failure mode.
//
// Cost is a hundred or so fillRects on a 200px-tall canvas. The loop runs at
// 15fps and the digest skips most frames outright, and because these calls are
// identical every frame they fold a constant into the hash and cause no *extra*
// repaints. If profiling ever disagrees the overlay becomes one cached
// offscreen blit — `putImageData` is not the way to do it, since it replaces
// pixels rather than compositing over them.

import type { SceneContext } from "../engine/digest";
import { ROOM_HEIGHT, ROOM_WIDTH } from "./backdrop";

const SCANLINE_ALPHA = 0.08;
const BLOOM_ALPHA = 0.045;
const BLOOM_COLOR = "#ffd9a0";
/** Vignette bands, outermost first: each ring darkens the one inside it. */
const VIGNETTE_BANDS = [
  { inset: 0, alpha: 0.16 },
  { inset: 3, alpha: 0.1 },
  { inset: 7, alpha: 0.06 },
  { inset: 12, alpha: 0.035 },
];

export const renderRetro = (ctx: SceneContext): void => {
  // Scanlines: one dark row every other row, the whole width.
  ctx.globalAlpha = SCANLINE_ALPHA;
  ctx.fillStyle = "#000000";
  for (let y = 0; y < ROOM_HEIGHT; y += 2) ctx.fillRect(0, y, ROOM_WIDTH, 1);

  // Phosphor: a warm haze over everything, as if the glass were glowing.
  ctx.globalAlpha = BLOOM_ALPHA;
  ctx.fillStyle = BLOOM_COLOR;
  ctx.fillRect(0, 0, ROOM_WIDTH, ROOM_HEIGHT);

  // Vignette, as nested frames rather than a radial gradient.
  ctx.fillStyle = "#000000";
  for (const band of VIGNETTE_BANDS) {
    ctx.globalAlpha = band.alpha;
    const { inset } = band;
    const width = ROOM_WIDTH - inset * 2;
    const height = ROOM_HEIGHT - inset * 2;
    ctx.fillRect(inset, inset, width, 1);
    ctx.fillRect(inset, ROOM_HEIGHT - inset - 1, width, 1);
    ctx.fillRect(inset, inset, 1, height);
    ctx.fillRect(ROOM_WIDTH - inset - 1, inset, 1, height);
  }

  ctx.globalAlpha = 1;
};
