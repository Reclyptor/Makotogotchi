// Kept apart from atlas.ts, which loads the sheet, so the art scripts can
// place an overlay exactly as the room does (scripts/art/ancestors.ts).

import type { SpriteFrame } from "../atlas.generated";

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

/**
 * Where an overlay drawn at (x, y) in a frame's head space (SPEC §10.5) lands
 * in that frame's own pixels: its top-left, measured from the frame's. Both
 * are placed as the room places them at full size, which is how the masks
 * are drawn and the only size a Sage is drawn at.
 */
export const overlayOffset = (
  frame: SpriteFrame,
  overlay: SpriteFrame,
  x: number,
  y: number,
): { x: number; y: number } => {
  const under = drawRect(frame, 0, 0, 1);
  const over = drawRect(overlay, x, y, 1);
  return { x: over.dx - under.dx, y: over.dy - under.dy };
};
