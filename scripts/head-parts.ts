// Finds the parts of a pet's face in one frame's pixels: the ears, the eyes
// and the mouth. Shared by scripts/head-anchors.ts, which anchors the hat, the
// brows and the beard on them, and scripts/atlas.ts, which packs the mouth as
// a mask so a Sage's beard never covers it (SPEC §21.9). It reads pixels and
// nothing else: the atlas is built from it, so it cannot lean on the atlas.

import type { PNG } from "pngjs";

/** Pink blobs smaller than this are a tongue tip or a stray highlight. */
const MIN_EAR_PIXELS = 12;
/** How far apart a pair of eyes can be, centre to centre, in frame pixels. */
const EYE_SPACING = { min: 25, max: 50 };
/**
 * Rows of fur between the bottom of the eyes and the top of the mouth: at
 * least one art pixel. A mark any nearer is the eye's own corner — the droop
 * of a tired eye, the wings of a happy ^ ^ — not a piece of the mouth.
 */
const MOUTH_GAP = 5;
/** How far below the eyes the mouth can start, in frame pixels: four art pixels. */
const MOUTH_REACH = 22;
/** A mark bigger than this under the eyes is a paw or a prop, not a piece of the mouth. */
const MAX_MOUTH_PIECE = 100;

export type Rgba = [number, number, number, number];
/** One frame's pixels, addressed from its own top-left corner. */
export type Raster = { w: number; h: number; at: (x: number, y: number) => Rgba };
type Rect = { x: number; y: number; w: number; h: number };

export type Blob = { x0: number; x1: number; y0: number; y1: number; size: number };
type Found = Blob & { touched: boolean; cells: number[] };

/** The rectangle `rect` of `png` — a frame on the sheet, or the whole image when none is given. */
export const rasterOf = (png: PNG, rect: Rect = { x: 0, y: 0, w: png.width, h: png.height }): Raster => ({
  w: rect.w,
  h: rect.h,
  at: (x, y) => {
    const i = ((rect.y + y) * png.width + rect.x + x) * 4;
    return [png.data[i]!, png.data[i + 1]!, png.data[i + 2]!, png.data[i + 3]!];
  },
});

export const isPink = ([r, g, b, a]: Rgba): boolean => a > 0 && r > 200 && g > 110 && g < 200 && b > 110 && b < 200 && r - g > 40;
export const isBlack = ([r, g, b, a]: Rgba): boolean => a > 0 && r < 50 && g < 50 && b < 50;

/**
 * Four-connected blobs of `matches` pixels within rows [0, rows), with
 * whether each one reached a transparent pixel or one `walls` says it stops at.
 */
export const blobs = (
  frame: Raster,
  rows: number,
  matches: (pixel: Rgba) => boolean,
  walls: (pixel: Rgba) => boolean = () => false,
): Found[] => {
  const seen = new Set<number>();
  const found: Found[] = [];
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < frame.w; x++) {
      if (seen.has(y * frame.w + x) || !matches(frame.at(x, y))) continue;
      const blob: Found = { x0: x, x1: x, y0: y, y1: y, size: 0, touched: false, cells: [] };
      const stack: [number, number][] = [[x, y]];
      while (stack.length > 0) {
        const [cx, cy] = stack.pop()!;
        if (cx < 0 || cy < 0 || cx >= frame.w || cy >= frame.h) {
          blob.touched = true;
          continue;
        }
        const pixel = frame.at(cx, cy);
        if (pixel[3] === 0 || walls(pixel)) {
          blob.touched = true;
          continue;
        }
        if (seen.has(cy * frame.w + cx) || !matches(pixel)) continue;
        seen.add(cy * frame.w + cx);
        blob.size += 1;
        blob.cells.push(cy * frame.w + cx);
        blob.x0 = Math.min(blob.x0, cx);
        blob.x1 = Math.max(blob.x1, cx);
        blob.y0 = Math.min(blob.y0, cy);
        blob.y1 = Math.max(blob.y1, cy);
        stack.push([cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]);
      }
      found.push(blob);
    }
  }
  return found;
};

export const centreOf = (blob: Blob): number => (blob.x0 + blob.x1) / 2;

/**
 * The dip between the ears: the two pink blobs in the top half of a frame are
 * the ears, `centre` is the column midway between their centres and `floor`
 * the lowest point of the skyline between their inner edges — the dip a hat
 * sits in. Null for a frame with no ears (the egg, the gravestone, the medicine).
 */
export const earDip = (frame: Raster): { centre: number; floor: number } | null => {
  const ears = blobs(frame, Math.floor(frame.h / 2), isPink)
    .filter((blob) => blob.size >= MIN_EAR_PIXELS)
    .sort((p, q) => p.x0 - q.x0);
  if (ears.length < 2) return null;
  const left = ears[0]!;
  const right = ears[ears.length - 1]!;
  let floor = 0;
  for (let x = left.x1 + 1; x < right.x0; x++) {
    let y = 0;
    while (y < frame.h && frame.at(x, y)[3] === 0) y++;
    floor = Math.max(floor, y);
  }
  return { centre: Math.round((centreOf(left) + centreOf(right)) / 2), floor };
};

/** The topmost pair of eyes below the ear dip, or null where they are hidden. */
export const eyes = (frame: Raster, dipRow: number): [Blob, Blob] | null => {
  const enclosed = blobs(frame, frame.h, isBlack, isPink)
    .filter((blob) => !blob.touched && blob.y0 > dipRow)
    .sort((p, q) => p.y0 - q.y0 || p.x0 - q.x0);
  for (const left of enclosed) {
    const right = enclosed.find((other) => {
      const spacing = centreOf(other) - centreOf(left);
      return other !== left && other.y0 === left.y0 && spacing >= EYE_SPACING.min && spacing <= EYE_SPACING.max;
    });
    if (right) return [left, right];
  }
  return null;
};

/**
 * The pieces of the mouth: every small enclosed black mark that starts within
 * reach below the eyes and sits strictly inside their outer edges — a paw
 * raised to the face reaches those edges and is not a piece of the mouth.
 */
const mouthPieces = (frame: Raster, [left, right]: [Blob, Blob]): Found[] =>
  blobs(frame, frame.h, isBlack, isPink).filter(
    (blob) =>
      !blob.touched &&
      blob.size <= MAX_MOUTH_PIECE &&
      blob.y0 > left.y1 + MOUTH_GAP &&
      blob.y0 <= left.y1 + MOUTH_REACH &&
      blob.x0 > left.x0 &&
      blob.x1 < right.x1,
  );

const boxOf = (pieces: Blob[]): Blob => ({
  x0: Math.min(...pieces.map((piece) => piece.x0)),
  x1: Math.max(...pieces.map((piece) => piece.x1)),
  y0: Math.min(...pieces.map((piece) => piece.y0)),
  y1: Math.max(...pieces.map((piece) => piece.y1)),
  size: pieces.reduce((total, piece) => total + piece.size, 0),
});

/** The mouth's bounding box, or null where nothing is left showing. */
export const mouth = (frame: Raster, pair: [Blob, Blob]): Blob | null => {
  const pieces = mouthPieces(frame, pair);
  return pieces.length === 0 ? null : boxOf(pieces);
};

/**
 * Every pixel of the frame's mouth, as `y * w + x`: the marks themselves and
 * the pink of a tongue inside them. Null for a frame whose ears, eyes or mouth
 * are hidden, which has no mouth to keep in front of a beard.
 */
export const mouthPixels = (frame: Raster): Set<number> | null => {
  const dip = earDip(frame);
  const pair = dip && eyes(frame, dip.floor);
  const pieces = pair ? mouthPieces(frame, pair) : [];
  if (pieces.length === 0) return null;
  const box = boxOf(pieces);
  const pixels = new Set(pieces.flatMap((piece) => piece.cells));
  for (let y = box.y0; y <= box.y1; y++) {
    for (let x = box.x0; x <= box.x1; x++) {
      if (isPink(frame.at(x, y))) pixels.add(y * frame.w + x);
    }
  }
  return pixels;
};
