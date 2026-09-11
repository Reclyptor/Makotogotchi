// The pixel filter the wall's pictures go through (SPEC §22.3, §22.10),
// shared by art:portrait and art:ancestors so the two are made the same way:
// area-average each cell of a crop, weighted toward ink, then median-cut the
// result to a small palette and write it as a grid of palette letters.

export type RGB = [number, number, number];
export type Rect = { x: number; y: number; w: number; h: number };

/** Indexed rather than counted, so a pixel's channel is known to exist. */
const CHANNELS = [0, 1, 2] as const;

/**
 * Grid letters, assigned lightest colour first.
 *
 * No `O`/`l`/`I` — the grid is meant to be read in a diff, and those cannot be
 * told from `0` and `1` in a monospace font. No digits at all, for a sharper
 * reason: the palette ships as an object keyed by these letters, and JavaScript
 * orders integer-like keys numerically ahead of every other key whatever order
 * they were written in. A digit in here silently shuffles the palette out of
 * the light-to-dark order the generated file promises.
 */
export const LETTERS = ".,:;-~+=abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ";

/**
 * Area average of each destination cell, weighted toward ink over paper.
 *
 * A plain mean bleaches a line drawing away: a cell holding one dark stroke
 * and thirty white neighbours averages to off-white. Weighting each source
 * pixel by how far it is from white lets the lines carry the cell they fall
 * in, which is what the eye does looking at the original. `inkBias` 0 is the
 * plain mean.
 */
export const downscale = (
  pixelAt: (x: number, y: number) => RGB,
  crop: Rect,
  width: number,
  height: number,
  inkBias: number,
): RGB[][] => {
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
          const weight = 1 + ink * inkBias;
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
 * colours wanted. Each box's mean becomes a palette entry, lightest first.
 */
export const quantize = (grid: RGB[][], colours: number): { palette: RGB[]; indices: number[][] } => {
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
  return { palette, indices: toPalette(grid, palette) };
};

/** Each cell's nearest palette entry, for a grid quantized elsewhere. */
export const toPalette = (grid: RGB[][], palette: RGB[]): number[][] =>
  grid.map((row) =>
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

/** A grid of palette indices as rows of letters, and the palette as source. */
export const letterRows = (indices: number[][]): string[] =>
  indices.map((row) => row.map((index) => LETTERS[index]!).join(""));

export const paletteEntries = (palette: RGB[]): string =>
  palette.map((colour, index) => `  "${LETTERS[index]}": [${colour.join(", ")}],`).join("\n");
