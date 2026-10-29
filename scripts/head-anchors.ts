// Finds where the head is on every pet frame, for the table in
// src/game/scene/head.ts (SPEC §10.5). Run `npm run head-anchors` after adding
// pet frames; it prints candidate entries to paste, and a contact sheet with
// the crown, an elder's brow tufts, a sage's beard and cane drawn on every
// frame for a look before committing.
//
// Three things are read off the art, and one is set by hand:
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
//   • The beard. The mouth is the small enclosed black marks a row of fur
//     under the eyes and between them — the nose dot and the two curls of the
//     smile, or whatever shape the pose pulls it into. A sage's beard hangs
//     from the mouth's top row, centred on it, so the moustache covers the
//     mouth and the beard falls down the chest.
//   • A nightcap. When the skyline at the anchor column is a vivid colour the
//     pet itself never is, the art already wears a hat, and a cosmetic drawn
//     there would land on top of it.
//   • The cane. A sage's cane stands in the near paw — the hanging arm at the
//     flank of the side view, the right paw of the front view — with its knob
//     resting on top of the paw and its shaft coming out underneath, down to
//     the floor beside the feet. The paw is not found: CANE_GRIPS below says,
//     frame by frame, which art column the shaft runs down and which row the
//     paw's bottom outline sits on, and leaves out every frame whose paws are
//     busy.
//
// Frames with no ears (the egg, the gravestone, the medicine) get no
// candidate and wear nothing; a frame whose eyes or mouth are hidden prints a
// comment asking for that point by hand.

import { readFileSync, writeFileSync } from "node:fs";
import { PNG } from "pngjs";
import { SPRITE_FRAMES, SPRITE_SHEET_URL, type FrameName } from "../src/game/atlas.generated.ts";
import { BASE_CLIPS, IDLE_FLOURISH_CLIPS, ONE_SHOT_CLIPS, WALK_CLIP } from "../src/game/anim/clips.ts";
import { centreOf, earDip, eyes, isPink, mouth, rasterOf, type Raster, type Rgba } from "./head-parts.ts";

const SHEET = new URL(`../public${SPRITE_SHEET_URL}`, import.meta.url);
const CONTACT = new URL("./head-anchors-contact.png", import.meta.url);
/** Rows between the bottom of the brow bars and the top of the eyes: one art pixel. */
const BROW_GAP = 5;
const BROWS = SPRITE_FRAMES.elderBrows;
const BEARD = SPRITE_FRAMES.sageBeard;
const CANE = SPRITE_FRAMES.sageCane;
/** The art is drawn at this many frame pixels per art pixel (scripts/atlas.ts). */
const ART_SCALE = 5.5;
/** The cane sprite's column its shaft runs down, and its row the paw's bottom outline sits on. */
const CANE_SHAFT = { col: 2, pawRow: 7 };
const CANE_ROWS = 15;

/**
 * Where the near paw grips the cane, in art pixels of the frame: `col` is the
 * column the shaft runs down, inside the paw, and `paw` the row of the paw's
 * bottom outline. The sprite leaves its rows above that clear, so the frame's
 * own paw shows through between the knob and the shaft.
 *
 * Every frame left out gets `cane: null`. Most have their paws busy — eating,
 * drinking, gaming, grooming with both paws, holding the soap, bowing with
 * the paws down, cheering with them up, hugging themselves, under the quilt or
 * the dust, or dead. cry, lights, shiver and sneeze keep their paws free but
 * play only beside busy frames (hungry, petted, dirty, sick), where a cane
 * that came and went each loop would read as a glitch. groom keeps it: the far
 * paw grooms, the near one holds on. pekori can't: the bow brings the closed
 * eyes down onto the grip and the beard over it, so the whole greeting clip
 * (pekori, idleFront1, pekori) goes without, rather than the cane popping in
 * on the middle frame.
 *
 * The sprite's columns are five art pixels wide, so `col - 2` must be even
 * for its cells to land on the frame's 5/6px cadence.
 */
const CANE_GRIPS: Partial<Record<FrameName, { col: number; paw: number }>> = {
  blink: { col: 16, paw: 17 },
  cheer1: { col: 20, paw: 17 },
  cheer2: { col: 20, paw: 17 },
  earTwitch: { col: 16, paw: 17 },
  groom1: { col: 16, paw: 17 },
  groom2: { col: 16, paw: 17 },
  heart1: { col: 16, paw: 17 },
  heart2: { col: 16, paw: 17 },
  idleSide1: { col: 16, paw: 17 },
  idleSide2: { col: 16, paw: 17 },
  idleSide3: { col: 16, paw: 17 },
  // The tired slump drops the paw a row; the cane stays planted and its
  // shaft covers the paw's bottom outline instead.
  tired1: { col: 18, paw: 17 },
  tired2: { col: 18, paw: 17 },
  walk1: { col: 16, paw: 17 },
  walk2: { col: 16, paw: 17 },
  walk3: { col: 16, paw: 17 },
  walk4: { col: 16, paw: 17 },
  yawn1: { col: 16, paw: 17 },
  yawn2: { col: 16, paw: 17 },
};

const sheet = PNG.sync.read(readFileSync(SHEET));
const { at } = rasterOf(sheet);
const frameOf = (name: FrameName): Raster => rasterOf(sheet, SPRITE_FRAMES[name]);
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

type Point = { x: number; y: number };
type Candidate = {
  name: FrameName;
  hat: (Point & { nightcap: boolean }) | null;
  brows: Point | null;
  beard: Point | null;
  cane: Point | null;
};

/**
 * The cane's bottom-centre in head space, from where the paw grips it: its
 * sprite is placed so its shaft column and paw row land on the frame's own
 * art cells. A native frame can be a pixel shorter than its art rows add up
 * to, and the ferrule then stops at the frame's bottom edge rather than
 * under it.
 */
const cane = (name: FrameName): Point | null => {
  const grip = CANE_GRIPS[name];
  if (!grip) return null;
  const f = SPRITE_FRAMES[name];
  const left = Math.round((grip.col - CANE_SHAFT.col) * ART_SCALE);
  const bottom = Math.min(Math.round((grip.paw - CANE_SHAFT.pawRow + CANE_ROWS) * ART_SCALE), f.h);
  return { x: left + CANE.w / 2 - Math.floor(f.w / 2), y: bottom - f.h };
};

const candidate = (name: FrameName): Candidate => {
  const f = SPRITE_FRAMES[name];
  const frame = frameOf(name);
  const dip = earDip(frame);
  if (!dip) return { name, hat: null, brows: null, beard: null, cane: null };
  const { centre, floor } = dip;
  let crown = 0;
  while (crown < f.h && frame.at(centre, crown)[3] === 0) crown++;
  const nightcap = isWorn(frame.at(centre, crown));
  // Frame coordinates → the room's head space: columns from the frame's
  // bottom-centre as the atlas snaps it, rows from the frame's bottom edge.
  const toHeadSpace = (x: number, y: number): Point => ({ x: Math.round(x) - Math.floor(f.w / 2), y: y - f.h });
  const pair = eyes(frame, floor);
  const lips = pair && mouth(frame, pair);
  return {
    name,
    hat: { ...toHeadSpace(centre, floor), nightcap },
    // Raised eyes would lift the tufts' fur over the skull, which is the
    // second pair of ears this table exists to prevent: the fur's top row
    // never rises above the head outline.
    brows: pair && toHeadSpace((centreOf(pair[0]) + centreOf(pair[1])) / 2, Math.max(pair[0].y0 - BROW_GAP, floor + BROWS.h)),
    // Bottom-centre like the brows, so the beard's top row is the mouth's.
    beard: lips && toHeadSpace(centreOf(lips), lips.y0 + BEARD.h),
    cane: cane(name),
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
    // The cane, the tufts and the beard as the atlas draws them: bottom-centre
    // on their points, the cane underneath so the beard falls over it.
    if (c.cane) blit(CANE.x, CANE.y, CANE.w, CANE.h, footX + c.cane.x - CANE.w / 2, footY + c.cane.y - CANE.h);
    if (c.brows) blit(BROWS.x, BROWS.y, BROWS.w, BROWS.h, footX + c.brows.x - BROWS.w / 2, footY + c.brows.y - BROWS.h);
    if (c.beard) blit(BEARD.x, BEARD.y, BEARD.w, BEARD.h, footX + c.beard.x - BEARD.w / 2, footY + c.beard.y - BEARD.h);
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

const entry = ({ name, hat, brows, beard, cane }: Candidate): string => {
  if (!hat) return `  ${name}: null, // no ears in this frame`;
  const point = (p: Point | null, hidden: string): string => (p ? `{ x: ${p.x}, y: ${p.y} }` : `null /* ${hidden} hidden: set by hand */`);
  const fields = [`x: ${hat.x}`, `y: ${hat.y}`, `brows: ${point(brows, "eyes")}`, `beard: ${point(beard, "mouth")}`];
  fields.push(`cane: ${cane ? `{ x: ${cane.x}, y: ${cane.y} }` : "null"}`);
  if (hat.nightcap) fields.push("nightcap: true");
  return `  ${name}: { ${fields.join(", ")} },`;
};

// Art can land before the clip that plays it: `npm run head-anchors -- meditate1`
// adds frames by name to the clips' own.
const extra = process.argv.slice(2).map((name) => {
  if (!(name in SPRITE_FRAMES)) throw new Error(`${name} is not a frame in the atlas`);
  return name as FrameName;
});
const candidates = [...new Set([...petFrames(), ...extra])].sort().map(candidate);
for (const c of candidates) console.log(entry(c));
contactSheet(candidates);
console.log(`head-anchors: ${candidates.length} frames → ${CONTACT.pathname}`);
