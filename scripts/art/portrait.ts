// Pixel-filters the framed picture from its source drawing (SPEC §22.3).
//
//   npm run art:portrait
//
// The picture on the room's wall is not drawn pixel by pixel — it is a
// photograph of a drawing, put through the same filter every time. Keeping the
// filter in a script rather than the result in a file by hand is what makes it
// reviewable: the grid in src/game/scene/portrait.generated.ts is 48 rows of
// letters, and nobody can tell by eye whether such a thing is right. They can
// tell whether this is.
//
// Three steps, and the middle one is the whole trick:
//
//   crop      to the drawing's own bounding box, so no paper is wasted
//   downscale by area average, weighted toward ink
//   quantize  by median cut
//
// A plain area average bleaches the drawing away. The strokes are one to three
// pixels wide on a 449x420 sheet and the paper around them is white, so at 48
// pixels across, a cell holding one dark line and thirty white neighbours
// averages to very slightly off-white — the whole drawing dissolves. Weighting
// each source pixel by how far it is from white lets the lines carry the cell
// they fall in, which is what the eye does looking at the original.

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { PNG } from "pngjs";

const SOURCE = new URL("./portrait-source.png", import.meta.url);
const GENERATED = new URL("../../src/game/scene/portrait.generated.ts", import.meta.url);
const CONTACT = new URL("./portrait-contact.png", import.meta.url);

/** The framed picture's size in room pixels, and how many colours it keeps. */
const WIDTH = 48;
const HEIGHT = 48;
const COLOURS = 20;

/**
 * How hard ink outweighs paper when a cell is averaged. 0 is a plain mean,
 * which erases the drawing; 3 keeps the strokes without turning the picture
 * into a smudge of outline.
 */
const INK_BIAS = 3;

/** Anything this close to white is paper, for the purpose of finding the art. */
const PAPER = 238;

/**
 * Grid letters, assigned lightest colour first.
 *
 * No `O`/`l`/`I` — the grid is meant to be read in a diff, and those cannot be
 * told from `0` and `1` in a monospace font. No digits at all, for a sharper
 * reason: the palette ships as an object keyed by these letters, and JavaScript
 * orders integer-like keys numerically ahead of every other key whatever order
 * they were written in. A digit in here silently shuffles the palette out of
 * the light-to-dark order the rest of this file promises.
 */
const LETTERS = ".,:;-~+=abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ";

type RGB = [number, number, number];
type Rect = { x: number; y: number; w: number; h: number };

/** Indexed rather than counted, so a pixel's channel is known to exist. */
const CHANNELS = [0, 1, 2] as const;

const source = PNG.sync.read(readFileSync(SOURCE));

const pixelAt = (x: number, y: number): RGB => {
  const index = (y * source.width + x) << 2;
  return [source.data[index]!, source.data[index + 1]!, source.data[index + 2]!];
};

/** The drawing's own extent, so the crop is the art and not the margins. */
const contentBounds = (): Rect => {
  let minX = source.width;
  let minY = source.height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < source.height; y++) {
    for (let x = 0; x < source.width; x++) {
      const [r, g, b] = pixelAt(x, y);
      if (r > PAPER && g > PAPER && b > PAPER) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) throw new Error("the source drawing is blank");
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
};

/** Area average of each destination cell, weighted toward ink over paper. */
const downscale = (crop: Rect, width: number, height: number): RGB[][] => {
  const rows: RGB[][] = [];
  for (let cellY = 0; cellY < height; cellY++) {
    const row: RGB[] = [];
    const y0 = crop.y + Math.floor((cellY * crop.h) / height);
    const y1 = Math.max(crop.y + Math.floor(((cellY + 1) * crop.h) / height), y0 + 1);
    for (let cellX = 0; cellX < width; cellX++) {
      const x0 = crop.x + Math.floor((cellX * crop.w) / width);
      const x1 = Math.max(crop.x + Math.floor(((cellX + 1) * crop.w) / width), x0 + 1);
      let r = 0;
      let g = 0;
      let b = 0;
      let total = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const [pr, pg, pb] = pixelAt(x, y);
          const ink = 1 - Math.min(pr, pg, pb) / 255;
          const weight = 1 + ink * INK_BIAS;
          r += pr * weight;
          g += pg * weight;
          b += pb * weight;
          total += weight;
        }
      }
      row.push([Math.round(r / total), Math.round(g / total), Math.round(b / total)]);
    }
    rows.push(row);
  }
  return rows;
};

/**
 * Median cut: repeatedly split the box whose colours are most spread out, along
 * the channel they are most spread out on, until there are as many boxes as
 * colours wanted. Each box's mean becomes a palette entry.
 */
const quantize = (grid: RGB[][], colours: number): { palette: RGB[]; indices: number[][] } => {
  let boxes: RGB[][] = [grid.flat()];
  for (;;) {
    if (boxes.length >= colours) break;
    let target = -1;
    let channel: (typeof CHANNELS)[number] = 0;
    let widest = 0;
    boxes.forEach((box, index) => {
      if (box.length < 2) return;
      for (const c of CHANNELS) {
        let lo = 255;
        let hi = 0;
        for (const pixel of box) {
          if (pixel[c] < lo) lo = pixel[c];
          if (pixel[c] > hi) hi = pixel[c];
        }
        if (hi - lo > widest) {
          widest = hi - lo;
          target = index;
          channel = c;
        }
      }
    });
    // Every box is a single colour: the image has fewer colours than asked for.
    if (target < 0) break;
    const sorted = boxes[target]!.slice().sort((a, b) => a[channel] - b[channel]);
    const middle = sorted.length >> 1;
    boxes.splice(target, 1, sorted.slice(0, middle), sorted.slice(middle));
  }
  boxes = boxes.filter((box) => box.length > 0);
  const palette: RGB[] = boxes.map((box) => {
    const sum = box.reduce((acc, p) => [acc[0] + p[0]!, acc[1] + p[1]!, acc[2] + p[2]!], [0, 0, 0]);
    return sum.map((value) => Math.round(value / box.length)) as RGB;
  });
  // Lightest first, so the letters run light to dark and the grid reads as a
  // picture in a diff rather than as noise.
  palette.sort((a, b) => b[0] + b[1] + b[2] - (a[0] + a[1] + a[2]));
  const indices = grid.map((row) =>
    row.map(([r, g, b]) => {
      let best = 0;
      let bestDistance = Infinity;
      palette.forEach((p, index) => {
        const distance = (p[0] - r) ** 2 + (p[1] - g) ** 2 + (p[2] - b) ** 2;
        if (distance < bestDistance) {
          bestDistance = distance;
          best = index;
        }
      });
      return best;
    }),
  );
  return { palette, indices };
};

const crop = contentBounds();
const { palette, indices } = quantize(downscale(crop, WIDTH, HEIGHT), COLOURS);
if (palette.length > LETTERS.length) throw new Error(`${palette.length} colours needs more letters`);

const rows = indices.map((row) => row.map((index) => LETTERS[index]!).join(""));
const entries = palette
  .map((colour, index) => `  ${LETTERS[index] === "." ? '"."' : `"${LETTERS[index]}"`}: [${colour.join(", ")}],`)
  .join("\n");

writeFileSync(
  GENERATED,
  `// GENERATED by scripts/art/portrait.ts from scripts/art/portrait-source.png.
// Do not edit: re-run \`npm run art:portrait\` instead (SPEC §22.3).
//
// ${WIDTH}x${HEIGHT} at ${palette.length} colours, cropped to the drawing's own
// bounds (${crop.w}x${crop.h} of ${source.width}x${source.height}). One letter per
// pixel, ordered lightest to darkest.

/** Letter to colour, lightest first. */
export const PORTRAIT_PALETTE: Readonly<Record<string, readonly [number, number, number]>> = {
${entries}
};

export const PORTRAIT_PIXELS: readonly string[] = [
${rows.map((row) => `  "${row}",`).join("\n")}
];
`,
);

// A contact print at 6x, for looking at rather than trusting.
const SCALE = 6;
const contact = new PNG({ width: WIDTH * SCALE, height: HEIGHT * SCALE });
for (let y = 0; y < HEIGHT * SCALE; y++) {
  for (let x = 0; x < WIDTH * SCALE; x++) {
    const colour = palette[indices[Math.floor(y / SCALE)]![Math.floor(x / SCALE)]!]!;
    const index = (y * WIDTH * SCALE + x) << 2;
    contact.data[index] = colour[0];
    contact.data[index + 1] = colour[1];
    contact.data[index + 2] = colour[2];
    contact.data[index + 3] = 255;
  }
}
writeFileSync(CONTACT, PNG.sync.write(contact));

const used = new Set(rows.flatMap((row) => [...row]));
console.log(
  `portrait: ${WIDTH}x${HEIGHT}, ${palette.length} colours (${used.size} used), ` +
    `cropped to ${crop.w}x${crop.h} at ${crop.x},${crop.y} → ${readdirSync(new URL(".", GENERATED)).includes("portrait.generated.ts") ? "src/game/scene/portrait.generated.ts" : "generated"} + scripts/art/portrait-contact.png`,
);
