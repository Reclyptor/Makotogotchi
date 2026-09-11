// Finds where the ears part on every pet frame, for the hat table in
// src/game/scene/head.ts (SPEC §10.5). Run `npm run head-anchors` after adding
// pet frames; it prints candidate entries to paste, and a contact sheet with
// the crown drawn at each one for a look before committing.
//
// The inner ears are pink in every frame the pet is drawn in. The two pink
// blobs in the top half of a frame are the ears; the anchor is the column
// midway between their centres and the lowest point of the skyline between
// their inner edges — the dip a hat sits in. Frames with no ears (the egg,
// the gravestone, the medicine) get no candidate and wear no hat.

import { readFileSync, writeFileSync } from "node:fs";
import { PNG } from "pngjs";
import { SPRITE_FRAMES, SPRITE_SHEET_URL, type FrameName } from "../src/game/atlas.generated.ts";
import { BASE_CLIPS, IDLE_FLOURISH_CLIPS, ONE_SHOT_CLIPS, WALK_CLIP } from "../src/game/anim/clips.ts";

const SHEET = new URL(`../public${SPRITE_SHEET_URL}`, import.meta.url);
const CONTACT = new URL("./head-anchors-contact.png", import.meta.url);
/** Pink blobs smaller than this are a tongue tip or a stray highlight. */
const MIN_EAR_PIXELS = 12;

const sheet = PNG.sync.read(readFileSync(SHEET));
const at = (x: number, y: number): [number, number, number, number] => {
  const i = (y * sheet.width + x) * 4;
  return [sheet.data[i]!, sheet.data[i + 1]!, sheet.data[i + 2]!, sheet.data[i + 3]!];
};
const isPink = ([r, g, b, a]: [number, number, number, number]): boolean =>
  a > 0 && r > 200 && g > 110 && g < 200 && b > 110 && b < 200 && r - g > 40;

const petFrames = (): FrameName[] => {
  const names = new Set<FrameName>();
  for (const clip of [...Object.values(BASE_CLIPS), ...Object.values(ONE_SHOT_CLIPS), ...IDLE_FLOURISH_CLIPS, WALK_CLIP]) {
    for (const frame of clip.frames) names.add(frame);
  }
  return [...names].sort();
};

type Blob = { x0: number; x1: number; y0: number; y1: number; size: number };
type Candidate = { name: FrameName; x: number; y: number } | { name: FrameName; x: null; y: null };

const earBlobs = (name: FrameName): Blob[] => {
  const f = SPRITE_FRAMES[name];
  const seen = new Set<number>();
  const blobs: Blob[] = [];
  for (let y = 0; y < Math.floor(f.h / 2); y++) {
    for (let x = 0; x < f.w; x++) {
      if (seen.has(y * f.w + x) || !isPink(at(f.x + x, f.y + y))) continue;
      const blob: Blob = { x0: x, x1: x, y0: y, y1: y, size: 0 };
      const stack: [number, number][] = [[x, y]];
      while (stack.length > 0) {
        const [cx, cy] = stack.pop()!;
        if (cx < 0 || cy < 0 || cx >= f.w || cy >= f.h || seen.has(cy * f.w + cx) || !isPink(at(f.x + cx, f.y + cy))) continue;
        seen.add(cy * f.w + cx);
        blob.size += 1;
        blob.x0 = Math.min(blob.x0, cx);
        blob.x1 = Math.max(blob.x1, cx);
        blob.y0 = Math.min(blob.y0, cy);
        blob.y1 = Math.max(blob.y1, cy);
        stack.push([cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]);
      }
      if (blob.size >= MIN_EAR_PIXELS) blobs.push(blob);
    }
  }
  return blobs.sort((p, q) => p.x0 - q.x0);
};

const candidate = (name: FrameName): Candidate => {
  const f = SPRITE_FRAMES[name];
  const blobs = earBlobs(name);
  if (blobs.length < 2) return { name, x: null, y: null };
  const left = blobs[0]!;
  const right = blobs[blobs.length - 1]!;
  let floor = 0;
  for (let x = left.x1 + 1; x < right.x0; x++) {
    let y = 0;
    while (y < f.h && at(f.x + x, f.y + y)[3] === 0) y++;
    floor = Math.max(floor, y);
  }
  const centre = Math.round(((left.x0 + left.x1) / 2 + (right.x0 + right.x1) / 2) / 2);
  // Frame coordinates → the room's head space: columns from the frame's
  // bottom-centre as the atlas snaps it, rows from the frame's bottom edge.
  return { name, x: centre - Math.floor(f.w / 2), y: floor - f.h };
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
  candidates.forEach((c, i) => {
    const f = SPRITE_FRAMES[c.name];
    const ox = (i % COLS) * CELL + Math.floor((CELL - f.w) / 2);
    const oy = Math.floor(i / COLS) * CELL + (CELL - f.h);
    for (let y = 0; y < f.h; y++) {
      for (let x = 0; x < f.w; x++) {
        const [r, g, b, a] = at(f.x + x, f.y + y);
        if (a > 0) put(ox + x, oy + y, r, g, b);
      }
    }
    if (c.x === null) return;
    // The crown as room.ts draws it, so what the sheet shows is what ships.
    const ax = ox + Math.floor(f.w / 2) + c.x;
    const ay = oy + f.h + c.y;
    const gold: [number, number, number] = [232, 199, 106];
    fill(ax - 13, ay - 7, 27, 7, gold);
    fill(ax - 13, ay - 13, 5, 6, gold);
    fill(ax - 2, ay - 13, 5, 6, gold);
    fill(ax + 9, ay - 13, 5, 6, gold);
    fill(ax - 1, ay - 5, 3, 3, [217, 83, 138]);
  });
  writeFileSync(CONTACT, PNG.sync.write(out));
};

const candidates = petFrames().map(candidate);
for (const c of candidates) {
  console.log(c.x === null ? `  ${c.name}: null, // no ears in this frame` : `  ${c.name}: { x: ${c.x}, y: ${c.y} },`);
}
contactSheet(candidates);
console.log(`head-anchors: ${candidates.length} frames → ${CONTACT.pathname}`);
