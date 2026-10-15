// Finds where the head is on every pet frame, for the table in
// src/game/scene/head.ts (SPEC §10.5). Run `npm run head-anchors` after adding
// pet frames; it prints candidate entries to paste, and a contact sheet with
// the crown and an elder's brow tufts drawn on every frame for a look before
// committing.
//
// Three things are read off the art:
//
//   • The hat anchor. The inner ears are pink in every frame the pet is drawn
//     in; the two pink blobs in the top half of a frame are the ears, and the
//     anchor is the column midway between their centres and the lowest point
//     of the skyline between their inner edges — the dip a hat sits in.
//   • The brows. The eyes are the topmost pair of black shapes enclosed by
//     fur — not the outline, which touches the outside, and not the inner-ear
//     contours, which touch pink — level with each other and an eye-spacing
//     apart. The tufts' brow bars sit one art pixel above them, and their fur
//     never rises above the head outline.
//   • A nightcap. When the skyline at the anchor column is a vivid colour the
//     pet itself never is, the art already wears a hat, and a cosmetic drawn
//     there would land on top of it.
//
// Frames with no ears (the egg, the gravestone, the medicine) get no
// candidate and wear nothing; a frame whose eyes are hidden prints a comment
// asking for its brows by hand.

import { readFileSync, writeFileSync } from "node:fs";
import { PNG } from "pngjs";
import { SPRITE_FRAMES, SPRITE_SHEET_URL, type FrameName } from "../src/game/atlas.generated.ts";
import { BASE_CLIPS, IDLE_FLOURISH_CLIPS, ONE_SHOT_CLIPS, WALK_CLIP } from "../src/game/anim/clips.ts";

const SHEET = new URL(`../public${SPRITE_SHEET_URL}`, import.meta.url);
const CONTACT = new URL("./head-anchors-contact.png", import.meta.url);
/** Pink blobs smaller than this are a tongue tip or a stray highlight. */
const MIN_EAR_PIXELS = 12;
/** How far apart a pair of eyes can be, centre to centre, in frame pixels. */
const EYE_SPACING = { min: 25, max: 50 };
/** Rows between the bottom of the brow bars and the top of the eyes: one art pixel. */
const BROW_GAP = 5;
const BROWS = SPRITE_FRAMES.elderBrows;

type Rgba = [number, number, number, number];

const sheet = PNG.sync.read(readFileSync(SHEET));
const at = (x: number, y: number): Rgba => {
  const i = (y * sheet.width + x) * 4;
  return [sheet.data[i]!, sheet.data[i + 1]!, sheet.data[i + 2]!, sheet.data[i + 3]!];
};
const isPink = ([r, g, b, a]: Rgba): boolean => a > 0 && r > 200 && g > 110 && g < 200 && b > 110 && b < 200 && r - g > 40;
const isBlack = ([r, g, b, a]: Rgba): boolean => a > 0 && r < 50 && g < 50 && b < 50;
/**
 * A vivid colour the pet never is — its outline, fur and inner ears are all
 * grey or pink. The muted blue-greys of the dust bath's cloud and the sick
 * pet's ice pack sit well under the line; the nightcap's navy and cyan sit
 * well over it.
 */
const isWorn = (pixel: Rgba): boolean => {
  const [r, g, b] = pixel;
  return !isPink(pixel) && Math.max(r, g, b) - Math.min(r, g, b) > 60;
};

const petFrames = (): FrameName[] => {
  const names = new Set<FrameName>();
  for (const clip of [...Object.values(BASE_CLIPS), ...Object.values(ONE_SHOT_CLIPS), ...IDLE_FLOURISH_CLIPS, WALK_CLIP]) {
    for (const frame of clip.frames) names.add(frame);
  }
  return [...names].sort();
};

type Blob = { x0: number; x1: number; y0: number; y1: number; size: number };
type Point = { x: number; y: number };
type Candidate = { name: FrameName; hat: (Point & { nightcap: boolean }) | null; brows: Point | null };

/**
 * Four-connected blobs of `matches` pixels within rows [0, rows), with
 * whether each one reached a transparent pixel or one `walls` says it stops at.
 */
const blobs = (
  name: FrameName,
  rows: number,
  matches: (pixel: Rgba) => boolean,
  walls: (pixel: Rgba) => boolean = () => false,
): (Blob & { touched: boolean })[] => {
  const f = SPRITE_FRAMES[name];
  const seen = new Set<number>();
  const found: (Blob & { touched: boolean })[] = [];
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < f.w; x++) {
      if (seen.has(y * f.w + x) || !matches(at(f.x + x, f.y + y))) continue;
      const blob = { x0: x, x1: x, y0: y, y1: y, size: 0, touched: false };
      const stack: [number, number][] = [[x, y]];
      while (stack.length > 0) {
        const [cx, cy] = stack.pop()!;
        if (cx < 0 || cy < 0 || cx >= f.w || cy >= f.h) {
          blob.touched = true;
          continue;
        }
        const pixel = at(f.x + cx, f.y + cy);
        if (pixel[3] === 0 || walls(pixel)) {
          blob.touched = true;
          continue;
        }
        if (seen.has(cy * f.w + cx) || !matches(pixel)) continue;
        seen.add(cy * f.w + cx);
        blob.size += 1;
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

const centreOf = (blob: Blob): number => (blob.x0 + blob.x1) / 2;

/** The topmost pair of eyes below the ear dip, in frame pixels, or null where they are hidden. */
const eyes = (name: FrameName, dipRow: number): [Blob, Blob] | null => {
  const f = SPRITE_FRAMES[name];
  const enclosed = blobs(name, f.h, isBlack, isPink)
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

const candidate = (name: FrameName): Candidate => {
  const f = SPRITE_FRAMES[name];
  const ears = blobs(name, Math.floor(f.h / 2), isPink)
    .filter((blob) => blob.size >= MIN_EAR_PIXELS)
    .sort((p, q) => p.x0 - q.x0);
  if (ears.length < 2) return { name, hat: null, brows: null };
  const left = ears[0]!;
  const right = ears[ears.length - 1]!;
  let floor = 0;
  for (let x = left.x1 + 1; x < right.x0; x++) {
    let y = 0;
    while (y < f.h && at(f.x + x, f.y + y)[3] === 0) y++;
    floor = Math.max(floor, y);
  }
  const centre = Math.round((centreOf(left) + centreOf(right)) / 2);
  let crown = 0;
  while (crown < f.h && at(f.x + centre, f.y + crown)[3] === 0) crown++;
  const nightcap = isWorn(at(f.x + centre, f.y + crown));
  // Frame coordinates → the room's head space: columns from the frame's
  // bottom-centre as the atlas snaps it, rows from the frame's bottom edge.
  const toHeadSpace = (x: number, y: number): Point => ({ x: Math.round(x) - Math.floor(f.w / 2), y: y - f.h });
  const pair = eyes(name, floor);
  return {
    name,
    hat: { ...toHeadSpace(centre, floor), nightcap },
    // Raised eyes would lift the tufts' fur over the skull, which is the
    // second pair of ears this table exists to prevent: the fur's top row
    // never rises above the head outline.
    brows: pair && toHeadSpace((centreOf(pair[0]) + centreOf(pair[1])) / 2, Math.max(pair[0].y0 - BROW_GAP, floor + BROWS.h)),
  };
};

const contactSheet = (candidates: Candidate[]): void => {
  const CELL = 160;
  const COLS = 8;
  const out = new PNG({ width: CELL * COLS, height: CELL * Math.ceil(candidates.length / COLS) });
  out.data.fill(0);
  const put = (x: number, y: number, r: number, g: number, b: number): void => {
    if (x < 0 || y < 0 || x >= out.width || y >= out.height) return;
    const i = (y * out.width + x) * 4;
    out.data[i] = r;
    out.data[i + 1] = g;
    out.data[i + 2] = b;
    out.data[i + 3] = 255;
  };
  const fill = (x: number, y: number, w: number, h: number, color: [number, number, number]): void => {
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) put(xx, yy, ...color);
  };
  const blit = (sx: number, sy: number, w: number, h: number, ox: number, oy: number): void => {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const [r, g, b, a] = at(sx + x, sy + y);
        if (a > 0) put(ox + x, oy + y, r, g, b);
      }
    }
  };
  candidates.forEach((c, i) => {
    const f = SPRITE_FRAMES[c.name];
    const ox = (i % COLS) * CELL + Math.floor((CELL - f.w) / 2);
    const oy = Math.floor(i / COLS) * CELL + (CELL - f.h);
    blit(f.x, f.y, f.w, f.h, ox, oy);
    const footX = ox + Math.floor(f.w / 2);
    const footY = oy + f.h;
    // The tufts as the atlas draws them: bottom-centre on the brow point.
    if (c.brows) blit(BROWS.x, BROWS.y, BROWS.w, BROWS.h, footX + c.brows.x - BROWS.w / 2, footY + c.brows.y - BROWS.h);
    if (!c.hat || c.hat.nightcap) return;
    // The crown as room.ts draws it, so what the sheet shows is what ships.
    const ax = footX + c.hat.x;
    const ay = footY + c.hat.y;
    const gold: [number, number, number] = [232, 199, 106];
    fill(ax - 13, ay - 7, 27, 7, gold);
    fill(ax - 13, ay - 13, 5, 6, gold);
    fill(ax - 2, ay - 13, 5, 6, gold);
    fill(ax + 9, ay - 13, 5, 6, gold);
    fill(ax - 1, ay - 5, 3, 3, [217, 83, 138]);
  });
  writeFileSync(CONTACT, PNG.sync.write(out));
};

const entry = ({ name, hat, brows }: Candidate): string => {
  if (!hat) return `  ${name}: null, // no ears in this frame`;
  const point = (p: Point): string => `{ x: ${p.x}, y: ${p.y} }`;
  const browsText = brows ? point(brows) : "null /* eyes hidden: set by hand */";
  return `  ${name}: { x: ${hat.x}, y: ${hat.y}, brows: ${browsText}${hat.nightcap ? ", nightcap: true" : ""} },`;
};

const candidates = petFrames().map(candidate);
for (const c of candidates) console.log(entry(c));
contactSheet(candidates);
console.log(`head-anchors: ${candidates.length} frames → ${CONTACT.pathname}`);
