// Regenerates the sprite atlas from public/sprites.png (SPEC §10.2).
//
//   npm run atlas
//
// Frames are detected from the image itself — connected components over the
// alpha channel, merged into grid cells so floating details (sweat drops,
// sparkles, "..." dots) join their parent sprite — and named by the manifest
// below, which is the one human-maintained piece. Outputs:
//
//   src/game/atlas.generated.ts   committed; the build needs no image code
//   scripts/atlas-contact.png     red-boxed contact sheet for visual review
//
// If the art changes, re-run, eyeball the contact sheet, review the diff.

import { readFileSync, writeFileSync } from "node:fs";
import { PNG } from "pngjs";

const SOURCE = new URL("../public/sprites.png", import.meta.url);
const GENERATED = new URL("../src/game/atlas.generated.ts", import.meta.url);
const CONTACT = new URL("./atlas-contact.png", import.meta.url);

// Five pet row bands; within a row, large components anchor the columns and
// small floating details (sweat drops, sparkles, "..." dots) attach to the
// nearest anchor. The food row is irregular and taken as raw boxes sorted
// by x. No column grid is assumed — the sheet's pitch is not uniform.
const ANCHOR_MIN_SIZE = 40;
const ROW_BANDS: [number, number][] = [
  [28, 171],
  [171, 314],
  [314, 457],
  [457, 605],
  [605, 760],
];
const FOOD_BAND: [number, number] = [1040, 1105];

// (row, col) → frame name. Names follow the original artist's vocabulary.
const PET_MANIFEST: string[][] = [
  ["jog1", "jog2", "jog3", "idleSide1", "idleSide2", "idleSide3", "sleep1", "sleep2", "eat1", "eat2"],
  ["idleFront1", "idleFront2", "idleFront3", "lift1", "lift2", "game1", "game2", "game3", "sick1", "sick2"],
  ["dead1", "dead2", "clone1", "clone2", "clone3", "clone4", "clone5", "clone6", "clone7", "clone8"],
  ["angry1", "angry2", "tired1", "tired2", "unhappyEat1", "unhappyEat2", "lights1", "lights2", "tea1", "tea2"],
  ["pekori", "bored1", "bored2", "bored3", "drpepper1", "drpepper2", "dustbath1", "dustbath2", "dustbath3"],
];
const FOOD_MANIFEST = ["plate", "fishman", "fish", "pepper1", "pepper2", "sausage", "pizza", "burger", "onigiri", "bowl"];

type Box = { x: number; y: number; w: number; h: number };

const detectComponents = (png: PNG): Box[] => {
  const { width, height, data } = png;
  const mask = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i++) mask[i] = data[i * 4 + 3]! > 0 ? 1 : 0;

  // 2px dilation connects antialiased edges without bridging sprite gaps.
  const RADIUS = 2;
  const dilated = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!mask[y * width + x]) continue;
      for (let dy = -RADIUS; dy <= RADIUS; dy++) {
        for (let dx = -RADIUS; dx <= RADIUS; dx++) {
          const ny = y + dy;
          const nx = x + dx;
          if (ny >= 0 && ny < height && nx >= 0 && nx < width) dilated[ny * width + nx] = 1;
        }
      }
    }
  }

  const label = new Int32Array(width * height).fill(-1);
  const boxes: (Box & { pixels: number })[] = [];
  for (let start = 0; start < width * height; start++) {
    if (!dilated[start] || label[start]! >= 0) continue;
    const id = boxes.length;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -1;
    let maxY = -1;
    let pixels = 0;
    const stack = [start];
    label[start] = id;
    while (stack.length) {
      const index = stack.pop()!;
      const y = Math.floor(index / width);
      const x = index % width;
      if (mask[index]) {
        pixels += 1;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
      const neighbors: number[] = [];
      if (x > 0) neighbors.push(index - 1);
      if (x < width - 1) neighbors.push(index + 1);
      if (index >= width) neighbors.push(index - width);
      if (index < width * (height - 1)) neighbors.push(index + width);
      for (const neighbor of neighbors) {
        if (dilated[neighbor] && label[neighbor]! < 0) {
          label[neighbor] = id;
          stack.push(neighbor);
        }
      }
    }
    if (pixels > 20) boxes.push({ x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1, pixels });
  }
  return boxes;
};

const union = (a: Box, b: Box): Box => {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
};

const buildFrames = (boxes: Box[]): Map<string, Box> => {
  const rows: Box[][] = ROW_BANDS.map(() => []);
  const food: Box[] = [];

  for (const box of boxes) {
    const cy = box.y + box.h / 2;
    if (cy >= FOOD_BAND[0] && cy < FOOD_BAND[1]) {
      food.push(box);
      continue;
    }
    const row = ROW_BANDS.findIndex(([top, bottom]) => cy >= top && cy < bottom);
    if (row < 0) throw new Error(`component at (${box.x},${box.y}) falls outside every row band`);
    rows[row]!.push(box);
  }

  const cells = new Map<string, Box>();
  rows.forEach((rowBoxes, row) => {
    const manifest = PET_MANIFEST[row]!;
    const anchors = rowBoxes.filter((box) => box.w >= ANCHOR_MIN_SIZE && box.h >= ANCHOR_MIN_SIZE).sort((a, b) => a.x - b.x);
    if (anchors.length !== manifest.length) {
      throw new Error(`row ${row}: expected ${manifest.length} sprites, detected ${anchors.length} anchors`);
    }
    const merged = anchors.map((anchor) => ({ ...anchor }));
    for (const fragment of rowBoxes) {
      if (anchors.includes(fragment)) continue;
      const cx = fragment.x + fragment.w / 2;
      let best = 0;
      let bestDistance = Infinity;
      merged.forEach((anchor, index) => {
        const distance = Math.abs(anchor.x + anchor.w / 2 - cx);
        if (distance < bestDistance) {
          bestDistance = distance;
          best = index;
        }
      });
      merged[best] = { ...union(merged[best]!, fragment) };
    }
    merged.forEach((box, index) => cells.set(manifest[index]!, box));
  });

  food.sort((a, b) => a.x - b.x);
  if (food.length !== FOOD_MANIFEST.length) {
    throw new Error(`expected ${FOOD_MANIFEST.length} food items, detected ${food.length}`);
  }
  food.forEach((box, index) => cells.set(FOOD_MANIFEST[index]!, box));

  const expected = [...PET_MANIFEST.flat(), ...FOOD_MANIFEST];
  return new Map(expected.map((name) => {
    const box = cells.get(name);
    if (!box) throw new Error(`manifest frame never detected: ${name}`);
    return [name, box];
  }));
};

const emitModule = (frames: Map<string, Box>): string => {
  const lines = [
    "// GENERATED by scripts/atlas.ts — do not edit by hand. Re-run `npm run atlas`",
    "// after any change to public/sprites.png and review the contact sheet.",
    "",
    "export type SpriteFrame = { x: number; y: number; w: number; h: number };",
    "",
    "export const SPRITE_FRAMES = {",
    ...[...frames].map(([name, box]) => `  ${name}: { x: ${box.x}, y: ${box.y}, w: ${box.w}, h: ${box.h} },`),
    "} as const satisfies Record<string, SpriteFrame>;",
    "",
    "export type FrameName = keyof typeof SPRITE_FRAMES;",
    "",
  ];
  return lines.join("\n");
};

const drawContactSheet = (png: PNG, frames: Map<string, Box>): void => {
  const sheet = new PNG({ width: png.width, height: png.height });
  png.data.copy(sheet.data);
  // Checkerboard backdrop under transparency, red frame borders.
  for (let i = 0; i < sheet.width * sheet.height; i++) {
    if (sheet.data[i * 4 + 3] === 0) {
      const x = i % sheet.width;
      const y = Math.floor(i / sheet.width);
      const shade = (Math.floor(x / 8) + Math.floor(y / 8)) % 2 === 0 ? 235 : 215;
      sheet.data[i * 4] = shade;
      sheet.data[i * 4 + 1] = shade;
      sheet.data[i * 4 + 2] = shade;
      sheet.data[i * 4 + 3] = 255;
    }
  }
  const plot = (x: number, y: number): void => {
    if (x < 0 || y < 0 || x >= sheet.width || y >= sheet.height) return;
    const i = (y * sheet.width + x) * 4;
    sheet.data[i] = 255;
    sheet.data[i + 1] = 0;
    sheet.data[i + 2] = 0;
    sheet.data[i + 3] = 255;
  };
  for (const box of frames.values()) {
    for (let x = box.x - 1; x <= box.x + box.w; x++) {
      plot(x, box.y - 1);
      plot(x, box.y + box.h);
    }
    for (let y = box.y - 1; y <= box.y + box.h; y++) {
      plot(box.x - 1, y);
      plot(box.x + box.w, y);
    }
  }
  writeFileSync(CONTACT, PNG.sync.write(sheet));
};

const png = PNG.sync.read(readFileSync(SOURCE));
const frames = buildFrames(detectComponents(png));
writeFileSync(GENERATED, emitModule(frames));
drawContactSheet(png, frames);
console.log(`atlas: ${frames.size} frames → src/game/atlas.generated.ts + scripts/atlas-contact.png`);
