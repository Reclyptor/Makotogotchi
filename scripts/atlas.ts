// Packs the sprite atlas from art/ (SPEC §10.2).
//
//   npm run atlas
//
// Every frame is its own PNG at art/<category>/<name>.png — adding a sprite
// is dropping a file in and re-running. The packer shelf-packs the frames
// into the served sheet and emits the typed atlas. Outputs:
//
//   public/sprites.png            the served sheet
//   src/game/atlas.generated.ts   committed; the build needs no image code
//   scripts/atlas-contact.png     red-boxed contact sheet for visual review
//
// If the art changes, re-run, eyeball the contact sheet, review the diff.
//
// Two source formats, told apart by filename:
//   art/pet/idleSide1.png      native resolution, packed as-is (the original
//                              sheet's frames, extracted losslessly)
//   art/pet/walk1@1x.png       logical pixel grid — one image px per art px —
//                              upscaled ×5.5 at pack time to match the
//                              original scale (cell i spans round(i*5.5) to
//                              round((i+1)*5.5), the same 5/6px cadence the
//                              hand-drawn sheet uses)
// Prefer @1x for new art: it is small, diffable, and editable in anything.

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";

const ART = new URL("../art/", import.meta.url);
const SHEET = new URL("../public/sprites.png", import.meta.url);
const GENERATED = new URL("../src/game/atlas.generated.ts", import.meta.url);
const CONTACT = new URL("./atlas-contact.png", import.meta.url);

const MAX_SHEET_WIDTH = 1600;
const GUTTER = 8;
const SCALE = 5.5;

type Frame = { name: string; category: string; png: PNG };
type Placed = Frame & { x: number; y: number };

const collator = new Intl.Collator("en", { numeric: true });

// Nearest-neighbour upscale on non-integer boundaries: logical cell i spans
// device [round(i*SCALE), round((i+1)*SCALE)), reproducing the original
// sheet's alternating 5/6px pixel widths.
const upscale = (logical: PNG): PNG => {
  const width = Math.round(logical.width * SCALE);
  const height = Math.round(logical.height * SCALE);
  const out = new PNG({ width, height });
  for (let cy = 0; cy < logical.height; cy++) {
    const y0 = Math.round(cy * SCALE);
    const y1 = Math.round((cy + 1) * SCALE);
    for (let cx = 0; cx < logical.width; cx++) {
      const x0 = Math.round(cx * SCALE);
      const x1 = Math.round((cx + 1) * SCALE);
      const src = (cy * logical.width + cx) * 4;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          logical.data.copy(out.data, (y * width + x) * 4, src, src + 4);
        }
      }
    }
  }
  return out;
};

const loadFrames = (): Frame[] => {
  const frames: Frame[] = [];
  const seen = new Map<string, string>();
  const categories = readdirSync(ART, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort(collator.compare);
  for (const category of categories) {
    const files = readdirSync(new URL(`${category}/`, ART))
      .filter((file) => file.endsWith(".png"))
      .sort(collator.compare);
    for (const file of files) {
      const logical = file.endsWith("@1x.png");
      const name = file.slice(0, logical ? -8 : -4);
      if (!/^[a-zA-Z][a-zA-Z0-9]*$/.test(name)) {
        throw new Error(`art/${category}/${file}: frame names must be valid identifiers`);
      }
      const previous = seen.get(name);
      if (previous) throw new Error(`duplicate frame name "${name}" in art/${previous} and art/${category}`);
      seen.set(name, category);
      const png = PNG.sync.read(readFileSync(new URL(`${category}/${file}`, ART)));
      frames.push({ name, category, png: logical ? upscale(png) : png });
    }
  }
  if (frames.length === 0) throw new Error(`no frames found under ${fileURLToPath(ART)}`);
  return frames;
};

// Shelf packing in (category, name) order: deterministic, category rows stay
// adjacent so the contact sheet reads like the old hand-laid sheet did.
const pack = (frames: Frame[]): { placed: Placed[]; width: number; height: number } => {
  const placed: Placed[] = [];
  let x = GUTTER;
  let y = GUTTER;
  let shelfHeight = 0;
  let width = 0;
  for (const frame of frames) {
    if (x + frame.png.width + GUTTER > MAX_SHEET_WIDTH && x > GUTTER) {
      x = GUTTER;
      y += shelfHeight + GUTTER;
      shelfHeight = 0;
    }
    placed.push({ ...frame, x, y });
    x += frame.png.width + GUTTER;
    shelfHeight = Math.max(shelfHeight, frame.png.height);
    width = Math.max(width, x);
  }
  return { placed, width, height: y + shelfHeight + GUTTER };
};

const composeSheet = (placed: Placed[], width: number, height: number): PNG => {
  const sheet = new PNG({ width, height });
  for (const frame of placed) {
    for (let row = 0; row < frame.png.height; row++) {
      frame.png.data.copy(
        sheet.data,
        ((frame.y + row) * width + frame.x) * 4,
        row * frame.png.width * 4,
        (row + 1) * frame.png.width * 4,
      );
    }
  }
  return sheet;
};

const emitModule = (placed: Placed[]): string => {
  const lines = [
    "// GENERATED by scripts/atlas.ts — do not edit by hand. Re-run `npm run atlas`",
    "// after any change under art/ and review the contact sheet.",
    "",
    "export type SpriteFrame = { x: number; y: number; w: number; h: number };",
    "",
    "export const SPRITE_FRAMES = {",
    ...placed.map((f) => `  ${f.name}: { x: ${f.x}, y: ${f.y}, w: ${f.png.width}, h: ${f.png.height} },`),
    "} as const satisfies Record<string, SpriteFrame>;",
    "",
    "export type FrameName = keyof typeof SPRITE_FRAMES;",
    "",
  ];
  return lines.join("\n");
};

const drawContactSheet = (sheet: PNG, placed: Placed[]): void => {
  const contact = new PNG({ width: sheet.width, height: sheet.height });
  sheet.data.copy(contact.data);
  // Checkerboard backdrop under transparency, red frame borders.
  for (let i = 0; i < contact.width * contact.height; i++) {
    if (contact.data[i * 4 + 3] === 0) {
      const x = i % contact.width;
      const y = Math.floor(i / contact.width);
      const shade = (Math.floor(x / 8) + Math.floor(y / 8)) % 2 === 0 ? 235 : 215;
      contact.data[i * 4] = shade;
      contact.data[i * 4 + 1] = shade;
      contact.data[i * 4 + 2] = shade;
      contact.data[i * 4 + 3] = 255;
    }
  }
  const plot = (x: number, y: number): void => {
    if (x < 0 || y < 0 || x >= contact.width || y >= contact.height) return;
    const i = (y * contact.width + x) * 4;
    contact.data[i] = 255;
    contact.data[i + 1] = 0;
    contact.data[i + 2] = 0;
    contact.data[i + 3] = 255;
  };
  for (const frame of placed) {
    for (let x = frame.x - 1; x <= frame.x + frame.png.width; x++) {
      plot(x, frame.y - 1);
      plot(x, frame.y + frame.png.height);
    }
    for (let y = frame.y - 1; y <= frame.y + frame.png.height; y++) {
      plot(frame.x - 1, y);
      plot(frame.x + frame.png.width, y);
    }
  }
  writeFileSync(CONTACT, PNG.sync.write(contact));
};

const frames = loadFrames();
const { placed, width, height } = pack(frames);
const sheet = composeSheet(placed, width, height);
writeFileSync(SHEET, PNG.sync.write(sheet));
writeFileSync(GENERATED, emitModule(placed));
drawContactSheet(sheet, placed);
console.log(`atlas: ${placed.length} frames packed into ${width}x${height} → public/sprites.png + src/game/atlas.generated.ts`);
