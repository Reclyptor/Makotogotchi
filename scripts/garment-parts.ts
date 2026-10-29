// Finds the body a worn garment hangs on in one frame's pixels (SPEC
// §22.12): where the neckline is, which cells are the body, where the feet
// begin, where the arms end. Shared by scripts/garment-regions.ts, which
// writes them out, and the tests that hold them to the art. It reads pixels
// and nothing else, like head-parts.ts, so it cannot lean on the atlas.
//
// Each frame is read back onto its own art grid first: a @1x frame is the
// grid exactly, and a native cut sits on 5.5px cells starting some pixels in
// (the cut's offset), so every cell is one colour.
//
//   neckline  the art row under the mouth box (head-parts finds the mouth; a
//             frame with no mouth falls back to the beard's anchor), never
//             closer than two rows under the eyes;
//   fur       every 4-connected region of fur below the neckline, with outline,
//             props and transparency as walls, is dressed: the body, and the
//             arms an outline sets apart from it. Only the tail stays fur;
//             it is the tall region at the back (on the right: the art faces
//             left), which no arm is, being a few rows at most;
//   feet      the bottom rows whose fur runs are all narrow and which split
//             into two somewhere, bare; the last body row above them is the
//             garment's last;
//   paws      an interior horizontal outline run below the neckline with
//             dressed fur above and below it — an arm's bottom edge against the
//             body. The fur run above it is the paw, bare; the run above
//             that the cuff. Where no such edge exists (an arm raised or
//             hidden) the pose's standard arm stands in.

import { cellEdge } from "../src/game/scene/garment.ts";
import type { GarmentBox, GarmentFace, GarmentPaw, GarmentRegion } from "../src/game/scene/garment.ts";
import { earDip, eyes, mouth, type Raster } from "./head-parts.ts";

/** The widest a foot is, in cells with its outline: wider runs are the body. */
const MAX_FOOT = 7;
/** The tail is at least this many rows tall; an arm, a hand or a foot is fewer. */
const TAIL_MIN_ROWS = 5;
/** A paw's width in cells, between the arm's side outlines. */
const PAW_WIDTH = { min: 2, max: 6 } as const;
/** How much wider than the edge a fur run may be and still be the paw above it. */
const PAW_SLACK = 2;
/** Rows between the bottom of the eyes and the neckline at the least. */
const NECK_BELOW_EYES = 2;
/** The cloak reference's standard arm: the paw is the arm's lower two rows, the cuff the row above. */
const PAW_ROWS_ABOVE_HEM = [7, 6] as const;
/** Where a side-facing frame's near arm shows, in body columns, seven rows above the hem. */
const SIDE_ARM = { outer: [14, 17], inner: [15, 16] } as const;

type Class = "B" | "W" | "P" | "K" | "." | "X" | "M";
const FUR_RGB: Record<string, Class> = { "194,194,194": "B", "224,224,224": "W", "228,148,148": "P" };
const isFur = (c: Class): boolean => c === "B" || c === "W" || c === "P";

const classify = (frame: Raster, x: number, y: number, masked: boolean): Class => {
  const [r, g, b, a] = frame.at(x, y);
  if (masked) return "M";
  if (a === 0) return ".";
  if (r < 50 && g < 50 && b < 50) return "K";
  return FUR_RGB[`${r},${g},${b}`] ?? "X";
};

/** Cell boundaries along one axis: the cut's offset, then 5.5px cells. */
export const cellBounds = (size: number, offset: number): number[] => {
  const bounds: number[] = [];
  for (let i = 0; ; i++) {
    const edge = cellEdge(i, offset);
    bounds.push(Math.min(size, edge));
    if (edge >= size) return bounds;
  }
};

/** The offset at which every 5.5px cell of the frame is one colour. */
export const fitOffset = (frame: Raster): { ox: number; oy: number } => {
  const key = (x: number, y: number): number => {
    const [r, g, b, a] = frame.at(x, y);
    return a === 0 ? 0 : ((r << 16) | (g << 8) | b) + 1;
  };
  for (let oy = 0; oy < 6; oy++) {
    for (let ox = 0; ox < 6; ox++) {
      const bx = cellBounds(frame.w, ox);
      const by = cellBounds(frame.h, oy);
      let uniform = true;
      for (let cy = 0; cy < by.length - 1 && uniform; cy++) {
        for (let cx = 0; cx < bx.length - 1 && uniform; cx++) {
          const first = key(bx[cx]!, by[cy]!);
          for (let y = by[cy]!; y < by[cy + 1]! && uniform; y++) {
            for (let x = bx[cx]!; x < bx[cx + 1]!; x++) {
              if (key(x, y) !== first) {
                uniform = false;
                break;
              }
            }
          }
        }
      }
      if (uniform) return { ox, oy };
    }
  }
  throw new Error("a frame that is not on a 5.5px grid");
};

type Grid = { ox: number; oy: number; bx: number[]; by: number[]; cols: number; rows: number; cls: Class[][] };

/** The frame as classified cells, `mask` being the prop mask in front of it, if any. */
export const gridOf = (frame: Raster, mask: Raster | null): Grid => {
  const { ox, oy } = fitOffset(frame);
  const bx = cellBounds(frame.w, ox);
  const by = cellBounds(frame.h, oy);
  const cols = bx.length - 1;
  const rows = by.length - 1;
  const cls = Array.from({ length: rows }, (_, cy) =>
    Array.from({ length: cols }, (_, cx) => classify(frame, bx[cx]!, by[cy]!, mask !== null && mask.at(bx[cx]!, by[cy]!)[3] > 0)),
  );
  return { ox, oy, bx, by, cols, rows, cls };
};

const rowOf = (grid: Grid, y: number): number => {
  for (let cy = 0; cy < grid.rows; cy++) if (y < grid.by[cy + 1]!) return cy;
  return grid.rows - 1;
};

type Region = { cells: Set<number>; x0: number; x1: number; y0: number; y1: number };

/** Every 4-connected region of fur. */
const furRegions = (grid: Grid): Region[] => {
  const seen = new Set<number>();
  const found: Region[] = [];
  for (let cy = 0; cy < grid.rows; cy++) {
    for (let cx = 0; cx < grid.cols; cx++) {
      if (seen.has(cy * grid.cols + cx) || !isFur(grid.cls[cy]![cx]!)) continue;
      const region: Region = { cells: new Set(), x0: cx, x1: cx, y0: cy, y1: cy };
      const stack: [number, number][] = [[cx, cy]];
      while (stack.length > 0) {
        const [x, y] = stack.pop()!;
        if (x < 0 || y < 0 || x >= grid.cols || y >= grid.rows) continue;
        const key = y * grid.cols + x;
        if (seen.has(key) || !isFur(grid.cls[y]![x]!)) continue;
        seen.add(key);
        region.cells.add(key);
        region.x0 = Math.min(region.x0, x);
        region.x1 = Math.max(region.x1, x);
        region.y0 = Math.min(region.y0, y);
        region.y1 = Math.max(region.y1, y);
        stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
      }
      found.push(region);
    }
  }
  return found;
};

/** The fur a garment covers: all of it but the tail, which is tall and stands at the back, on the right. */
const dressableFur = (grid: Grid): Set<number> => {
  const regions = furRegions(grid);
  const body = regions.reduce<Region | null>((best, region) => (best && best.cells.size >= region.cells.size ? best : region), null);
  const dressed = new Set<number>();
  for (const region of regions) {
    const isTail = region !== body && region.y1 - region.y0 + 1 >= TAIL_MIN_ROWS && region.x0 >= grid.cols / 2;
    if (!isTail) for (const cell of region.cells) dressed.add(cell);
  }
  return dressed;
};

type Run = [number, number];

/** Maximal runs of cells in row `cy` that satisfy `test`. */
const runs = (grid: Grid, cy: number, test: (c: Class, cx: number) => boolean): Run[] => {
  const out: Run[] = [];
  for (let cx = 0; cx < grid.cols; cx++) {
    if (!test(grid.cls[cy]![cx]!, cx)) continue;
    const x0 = cx;
    while (cx + 1 < grid.cols && test(grid.cls[cy]![cx + 1]!, cx + 1)) cx++;
    out.push([x0, cx]);
  }
  return out;
};

/** The body's first column on the cloak's reckoning: the lower half's widest run of anything opaque. */
const bodyColumn = (grid: Grid): { col0: number; hem: number } => {
  const opaque = (cy: number): Run | null =>
    runs(grid, cy, (c) => c !== ".").reduce<Run | null>((best, run) => (best && best[1] - best[0] >= run[1] - run[0] ? best : run), null);
  let hem = grid.rows;
  for (let y = grid.rows - 1; y >= 0; y--) {
    const run = opaque(y);
    if (run && run[1] - run[0] + 1 > grid.cols / 2) {
      hem = y + 1;
      break;
    }
  }
  let body: Run | null = null;
  for (let y = Math.floor(grid.rows / 2); y < grid.rows; y++) {
    const run = opaque(y);
    if (run && (!body || run[1] - run[0] > body[1] - body[0])) body = run;
  }
  if (!body) throw new Error("a frame with no body to dress");
  return { col0: body[0], hem };
};

/** A side-facing body carries its near arm as an outlined stub at fixed columns; a front-facing one does not. */
const facingOf = (grid: Grid, col0: number, hem: number): "side" | "front" => {
  const row = grid.cls[hem - PAW_ROWS_ABOVE_HEM[0]];
  const outline = (column: number): boolean => row?.[col0 + column] === "K";
  const [outerLeft, outerRight] = SIDE_ARM.outer;
  const [innerLeft, innerRight] = SIDE_ARM.inner;
  return outline(outerLeft) && outline(outerRight) && !outline(innerLeft) && !outline(innerRight) ? "side" : "front";
};

/** The pose's standard arm, for a frame whose paws the pixels do not give up. */
const standardPaws = (face: GarmentFace, col0: number, bottom: number, neck: number): GarmentPaw[] => {
  const hem = bottom + 1;
  // The paw is the arm's lower two rows on a standing body and one row in a seated pose's lap.
  const [top, low] = face === "sit" ? [hem - 8, hem - 8] : [hem - PAW_ROWS_ABOVE_HEM[0], hem - PAW_ROWS_ABOVE_HEM[1]];
  const arm = (x0: number, x1: number): GarmentPaw => ({
    paw: { x0: col0 + x0, x1: col0 + x1, y0: top, y1: low },
    cuff: { x0: col0 + x0 - 1, x1: col0 + x1 + 1, y0: top - 1, y1: top - 1 },
  });
  const arms = face === "sit" ? [arm(3, 5), arm(15, 17)] : face === "side" || face === "sitSide" ? [arm(15, 16)] : [arm(1, 4), arm(16, 19)];
  // A pose that hunches its shoulders up to the table has no arm below the collar to leave bare.
  return arms.filter(({ paw }) => paw.y0 > neck);
};

/**
 * The garment's region on one frame. `mouthTop` is the frame pixel row the
 * beard's anchor puts the mouth's top row on, used only where no mouth can
 * be found; `seated` is a pose sitting with its paws in its lap, which no
 * outline tells apart from a standing one.
 */
export const regionOf = (frame: Raster, mask: Raster | null, mouthTop: number, seated: boolean): GarmentRegion => {
  const grid = gridOf(frame, mask);
  const dressed = dressableFur(grid);
  const isDressed = (cx: number, cy: number): boolean => dressed.has(cy * grid.cols + cx);

  // Neckline: the row under the mouth's bottom row, and never nearer the eyes than the collar can sit.
  const dip = earDip(frame);
  const pair = dip && eyes(frame, dip.floor);
  const box = pair && mouth(frame, pair);
  let neck = box ? rowOf(grid, box.y1) + 1 : rowOf(grid, mouthTop) + 2;
  if (pair) neck = Math.max(neck, rowOf(grid, pair[0].y1) + NECK_BELOW_EYES);

  // Feet: from the bottom, rows whose fur runs are all narrow, as long as the
  // group splits into two somewhere; otherwise the pose is sitting on its hem.
  // Measured on everything opaque, outline included: the body's last row is a
  // row of fur between the feet's own outlines, which is still the body.
  const opaqueRuns = (cy: number): Run[] => runs(grid, cy, (c) => c !== ".");
  let feetTop = grid.rows;
  for (let cy = grid.rows - 1; cy >= 0; cy--) {
    if (opaqueRuns(cy).some(([a, b]) => b - a + 1 > MAX_FOOT)) break;
    feetTop = cy;
  }
  const split = Array.from({ length: grid.rows - feetTop }, (_, i) => opaqueRuns(feetTop + i).length >= 2).some(Boolean);
  if (!split) feetTop = grid.rows;
  let bottom = feetTop - 1;
  while (bottom > neck && !grid.cls[bottom]!.some((c, cx) => isFur(c) && isDressed(cx, bottom))) bottom--;

  // Paws: an arm's bottom edge against the body. A cell with a transparent
  // neighbour is the silhouette's own edge, and a single cell is a step in a
  // diagonal line, so neither counts.
  const onEdge = (cx: number, cy: number): boolean => {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const x = cx + dx;
        const y = cy + dy;
        if (x < 0 || y < 0 || x >= grid.cols || y >= grid.rows || grid.cls[y]![x] === ".") return true;
      }
    }
    return false;
  };
  const detected: GarmentPaw[] = [];
  for (let cy = neck + 2; cy < bottom; cy++) {
    for (const [a, b] of runs(grid, cy, (c) => c === "K")) {
      let x0 = a;
      let x1 = b;
      const interior = (cx: number): boolean => isDressed(cx, cy - 1) && isDressed(cx, cy + 1) && !onEdge(cx, cy);
      while (x0 <= x1 && !interior(x0)) x0++;
      while (x1 >= x0 && !interior(x1)) x1--;
      const width = x1 - x0 + 1;
      if (width < PAW_WIDTH.min || width > PAW_WIDTH.max) continue;
      // The paw is the fur run above, between the arm's side outlines; a run
      // much wider than the edge is the body itself, not a paw.
      const span = (row: number): GarmentBox | null => {
        const hit = runs(grid, row, (c, cx) => isFur(c) && isDressed(cx, row)).find(([p, q]) => q >= x0 && p <= x1);
        return hit && hit[1] - hit[0] + 1 <= width + PAW_SLACK ? { x0: hit[0], x1: hit[1], y0: row, y1: row } : null;
      };
      const paw = span(cy - 1);
      const cuff = cy - 2 > neck ? span(cy - 2) : null;
      if (paw) detected.push({ paw, cuff });
    }
  }

  const { col0, hem } = bodyColumn(grid);
  const stands = facingOf(grid, col0, hem);
  const face: GarmentFace = seated ? "sit" : hem === grid.rows && stands === "side" ? "sitSide" : stands;

  const letters = grid.cls.slice(0, bottom + 1).map((row, cy) =>
    row
      .map((c, cx) => {
        if (isFur(c)) return !isDressed(cx, cy) ? "t" : c === "P" ? "p" : "f";
        return c === "K" ? "k" : c === "." ? "." : "o";
      })
      .join(""),
  );
  return {
    face,
    ox: grid.ox,
    oy: grid.oy,
    w: grid.cols,
    h: grid.rows,
    neck,
    bottom,
    col0,
    paws: detected.length > 0 ? detected : standardPaws(face, col0, bottom, neck),
    head: letters.slice(0, neck - 1),
    rows: letters.slice(neck - 1),
  };
};
