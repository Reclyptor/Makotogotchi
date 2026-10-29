// A costume that is worn rather than pasted on (SPEC §22.12). A body costume
// used to be one fixed sprite hung in front of the pet, so the arms and the
// body's edges showed around it and it read as a sticker. A garment is drawn
// from the pose's own silhouette instead: every fur cell below the neckline
// is repainted in the garment's ramp — the arms become sleeves — and the
// outline stays on top, so the cloth follows every contour and fold.
//
// This file is the rules. `garment.generated.ts` is where each frame's body
// is (scripts/garment-regions.ts), and a holiday's scene is the garment's
// data: its colours and which of the optional pieces it has.

import type { RGB } from "./backdrop/theme";
import type { SceneContext } from "../engine/digest";

/** Which way the body faces, and whether it sits: each has its own slit and paws. */
export type GarmentFace = "side" | "front" | "sit" | "sitSide";

/** Inclusive cells. */
export type GarmentBox = { x0: number; x1: number; y0: number; y1: number };
/** An arm's end: the paw stays bare, and the cuff is the row of fur above it. */
export type GarmentPaw = { paw: GarmentBox; cuff: GarmentBox | null };

/** The body a garment hangs on in one frame, in the frame's art pixels (cells). */
export type GarmentRegion = {
  face: GarmentFace;
  /**
   * Where the art grid starts: a native cut sits on 5.5px cells beginning
   * this many pixels in, and an @1x frame at zero.
   */
  ox: number;
  oy: number;
  /** The frame's size in cells. */
  w: number;
  h: number;
  /** The collar's row: the garment hangs from here down. */
  neck: number;
  /** The last row of cloth: above the feet when standing, the frame's bottom when seated. */
  bottom: number;
  /** The body's first column, which the slit, the seam and the tails are measured from. */
  col0: number;
  /** Where the arms end, found in the pose's pixels or, failing that, the pose's standard arm. */
  paws: readonly GarmentPaw[];
  /**
   * The rows above the collar's top line, 0 to `neck - 2`, in the same
   * letters: the head, whose outline the beard must not reach.
   */
  head: readonly string[];
  /**
   * One string per row from `neck - 1` to `bottom`: f fur to dress, p pink,
   * t the tail, which stays fur, k outline, o a prop or anything
   * else, . empty.
   */
  rows: readonly string[];
};

/** Inclusive body columns. */
export type Span = readonly [number, number];

export type Garment = {
  ramp: {
    cloth: RGB;
    /** The neckline's band. */
    collar: RGB;
    /** The slit's edges, the seam, the cuffs. */
    trim: RGB;
    /** The collar's top line and the tails' edges. */
    line: RGB;
  };
  /** An open front, in body columns per facing, where the fur shows; null for a closed one. */
  slit: { side: Span; front: Span } | null;
  /**
   * A closed seam: one column of trim down the centre where a slit would be,
   * with no fur showing. Body columns per facing; none when absent.
   */
  seam?: { side: number; front: number };
  /** Cuffs above bare paws; false runs the sleeves down to the paw. */
  cuffs: boolean;
  /** A belt two rows above the hem, with a buckle at the middle of its widest run. */
  belt?: { belt: RGB; buckle: RGB };
  /** Flare and tails past the hem. */
  tails: boolean;
  /**
   * A floor-length skirt: the cloth widens below the waist and falls as one
   * closed bell over the legs and the gap between them, ending in an outline
   * row on the first row of the feet, so only the toes show beneath it.
   */
  skirt?: boolean;
  /**
   * A pattern on the last rows of cloth, one string per row, repeated across
   * the body's columns: c cloth, l collar, t trim, k line, . leaves the cloth.
   */
  hemPattern: readonly string[] | null;
  /** How many rows higher the pattern sits on a seated pose, so it clears the floor. */
  seatedHemLift?: number;
};

type Role = "cloth" | "collar" | "trim" | "line" | "belt" | "buckle";
export type GarmentCell = {
  /** Column and row in the frame's cells; a tail hangs past the frame, so may be negative. */
  x: number;
  y: number;
  color: RGB;
  /** Past the silhouette, painted over whatever is there. */
  piece: boolean;
};

/** The art pixels a garment may hang past the frame's edge: a tail's reach. */
export const GARMENT_MARGIN_CELLS = 3;
/** The atlas upscales each art pixel to this many device pixels (scripts/atlas.ts). */
export const CELL_PX = 5.5;
/** A seated front pose closes its slit and seam this many rows above the floor, where the lap begins. */
const SIT_SLIT_CLOSES = 5;
/** The belt's row, counted up from the last row of cloth. */
const BELT_ROWS_ABOVE_BOTTOM = 2;

/**
 * Device pixels where art pixel `index` begins on one axis. A native cut
 * starts its first whole cell `offset` pixels in; either way cells fall on the
 * packer's own 5/6px cadence.
 */
export const cellEdge = (index: number, offset: number): number =>
  offset > 0 ? (index === 0 ? 0 : offset + Math.round((index - 1) * CELL_PX)) : Math.round(index * CELL_PX);

const within = (column: number, span: Span): boolean => column >= span[0] && column <= span[1];
const inBox = (x: number, y: number, box: GarmentBox): boolean => x >= box.x0 && x <= box.x1 && y >= box.y0 && y <= box.y1;

const HEM_ROLES: Record<string, Role> = { c: "cloth", l: "collar", t: "trim", k: "line" };

/**
 * The cells a garment paints on one frame, in paint order. Everything but the
 * extra pieces lands on a body-fur cell of the pose: never on outline, a
 * prop, a bare paw, or the tail.
 */
export const garmentCells = (region: GarmentRegion, garment: Garment): GarmentCell[] => {
  const { face, neck, bottom, col0 } = region;
  const seated = face === "sit" || face === "sitSide";
  const front = face === "front" || face === "sit";
  const slit = garment.slit ? (front ? garment.slit.front : garment.slit.side) : null;
  const seam = garment.seam ? (front ? garment.seam.front : garment.seam.side) : null;
  const paws = garment.cuffs ? region.paws : [];
  const cells: { x: number; y: number; role: Role; piece: boolean }[] = [];

  const column = (cx: number): number => cx - col0;
  // A seated front pose has a lap under the slit, which closes above it.
  const openAt = (cy: number): boolean => face === "sitSide" || !seated || cy <= bottom - SIT_SLIT_CLOSES;
  const inSlit = (cx: number, cy: number): boolean => slit !== null && within(column(cx), slit) && openAt(cy);
  const onSlitEdge = (cx: number, cy: number): boolean =>
    slit !== null && (column(cx) === slit[0] - 1 || column(cx) === slit[1] + 1) && openAt(cy);
  const onSeam = (cx: number, cy: number): boolean => seam !== null && column(cx) === seam && openAt(cy);
  const isPaw = (cx: number, cy: number): boolean => paws.some(({ paw }) => inBox(cx, cy, paw));
  const isCuff = (cx: number, cy: number): boolean => paws.some(({ cuff }) => cuff !== null && inBox(cx, cy, cuff));

  region.rows.forEach((row, index) => {
    const cy = neck - 1 + index;
    for (let cx = 0; cx < row.length; cx++) {
      if (row[cx] !== "f") continue; // outline, props, the tail and the transparent stay
      const at = (role: Role): void => void cells.push({ x: cx, y: cy, role, piece: false });
      if (cy === neck - 1) at("line"); // the collar's top line
      else if (isPaw(cx, cy)) continue; // a bare paw
      else if (isCuff(cx, cy)) at("trim");
      else if (inSlit(cx, cy)) continue; // the open front: fur shows
      else if (cy === neck) at("collar");
      else if (onSlitEdge(cx, cy) || onSeam(cx, cy)) at("trim");
      // The belly's white is a marking, not light: it maps to the cloth too.
      else at("cloth");
    }
  });

  // The skirt goes down before the pattern, so a hem's stars fall on it too.
  if (garment.skirt) cells.push(...skirtCells(region).map((cell) => ({ ...cell, piece: true })));

  const pattern = garment.hemPattern;
  if (pattern) {
    const first = bottom - (seated ? (garment.seatedHemLift ?? 0) : 0) - pattern.length + 1;
    for (const cell of cells) {
      if (cell.role !== "cloth" || cell.y < first || cell.y >= first + pattern.length) continue;
      const row = pattern[cell.y - first]!;
      const mark = row[((column(cell.x) % row.length) + row.length) % row.length]!;
      if (mark in HEM_ROLES) cell.role = HEM_ROLES[mark]!;
    }
  }

  if (garment.belt) {
    const beltRow = bottom - BELT_ROWS_ABOVE_BOTTOM;
    const onBelt = cells.filter((cell) => cell.y === beltRow && cell.role === "cloth");
    if (beltRow > neck + 1 && onBelt.length > 0) {
      const buckle = widestRunCentre(onBelt.map((cell) => cell.x));
      for (const cell of onBelt) cell.role = cell.x === buckle ? "buckle" : "belt";
    }
  }

  const color = (role: Role): RGB => {
    if (role === "belt") return garment.belt!.belt;
    if (role === "buckle") return garment.belt!.buckle;
    return garment.ramp[role];
  };
  const out: GarmentCell[] = cells.map((cell) => ({ x: cell.x, y: cell.y, color: color(cell.role), piece: cell.piece }));
  if (garment.tails) {
    for (const piece of tailCells(region)) out.push({ x: piece.x, y: piece.y, color: color(piece.role), piece: true });
  }
  return out;
};

/** The middle column of the longest unbroken run of `columns`. */
const widestRunCentre = (columns: readonly number[]): number => {
  const sorted = [...columns].sort((a, b) => a - b);
  let best = { start: sorted[0]!, length: 0 };
  let start = sorted[0]!;
  sorted.forEach((x, i) => {
    if (i > 0 && x !== sorted[i - 1]! + 1) start = x;
    const length = x - start + 1;
    if (length > best.length) best = { start, length };
  });
  return Math.round(best.start + (best.length - 1) / 2);
};

// ── skirt ───────────────────────────────────────────────────────────────────
// From three rows above the hem the cloth's outer edge steps out a column a row
// past the body on each side, then falls straight to the hem, a line of outline
// from edge to edge. Everything between the edges is cloth, over the body's own
// curve and outline: the legs and the gap between them are under it.

/** [rows below the hem, outer edge's body column]; the left side, which the right mirrors. */
const STANDING_SKIRT: readonly (readonly [number, number])[] = [
  [-3, -1],
  [-2, -2],
  [-1, -3],
];
/** A seated pose's skirt, counted up from the frame's last row, which is its hem line. */
const SEATED_SKIRT: readonly (readonly [number, number])[] = [
  [-3, -1],
  [-2, -2],
  [-1, -2],
];

const skirtCells = (region: GarmentRegion): { x: number; y: number; role: Role }[] => {
  const { face, bottom, col0, w, h } = region;
  const seated = face === "sit" || face === "sitSide";
  const side = face === "side" || face === "sitSide";
  // The hem line: the first row of the feet, or the frame's floor on a seated pose.
  const hemLine = seated ? h - 1 : bottom + 1;
  // A side body's last column is the haunch, which already bulges, so its right
  // edge flares one column less past it than the left does past the chest.
  const lastColumn = side ? w - 1 - col0 : BODY_LAST_COLUMN;
  const rightOf = (bx: number): number => lastColumn - bx - (side ? 1 : 0);
  const rows = seated ? SEATED_SKIRT : STANDING_SKIRT;
  const out: { x: number; y: number; role: Role }[] = [];
  const piece = (bx: number, y: number, role: Role): void => {
    out.push({ x: col0 + bx, y, role });
  };
  const span = (a: number, b: number, y: number, role: Role): void => {
    for (let x = Math.min(a, b); x <= Math.max(a, b); x++) piece(x, y, role);
  };
  const edgeRow = (y: number, edge: number): void => {
    span(edge + 1, rightOf(edge) - 1, y, "cloth");
    piece(edge, y, "line");
    piece(rightOf(edge), y, "line");
  };
  for (const [dy, edge] of rows) edgeRow(hemLine + dy, edge);
  // Rows between the last flare row and the hem keep the widest edge.
  const widest = rows.at(-1)![1];
  for (let y = hemLine + rows.at(-1)![0] + 1; y < hemLine; y++) edgeRow(y, widest);
  span(widest, rightOf(widest), hemLine, "line");
  return out;
};

// ── tails ───────────────────────────────────────────────────────────────────
// The hem flares from three rows above the feet into tails beside them, each
// with one thin angled tongue. Written for a body 21 columns wide, in body
// columns, which `mirror` reflects for the right-hand side.

/** [rows below the hem, outer edge, fill range, inner edge, tongue cells] */
type FlareRow = readonly [number, number, Span, number | null, readonly number[]];

const LEFT_FLARE: readonly FlareRow[] = [
  [-3, 0, [1, 1], null, [1]],
  [-2, -1, [0, 2], null, [1]],
  [-1, -2, [-1, 4], null, [0, 1]],
  [0, -3, [-2, 2], 3, [0]],
  [1, -3, [-2, 2], 3, [-1, 0]],
];
/** A side body's right flare starts under the hamster's tail, which covers the body's edge above the hem. */
const SIDE_RIGHT_FLARE: readonly FlareRow[] = [
  [-1, 22, [21, 21], null, []],
  [0, 23, [17, 22], 16, [20]],
  [1, 23, [17, 22], 16, [20, 21]],
];
const BODY_LAST_COLUMN = 20;

const tailCells = (region: GarmentRegion): { x: number; y: number; role: Role }[] => {
  const { face, bottom, col0 } = region;
  // The hem is the row under the last row of cloth, where the feet start.
  const hem = bottom + 1;
  const out: { x: number; y: number; role: Role }[] = [];
  const piece = (bx: number, cy: number, role: Role): void => {
    out.push({ x: col0 + bx, y: cy, role });
  };
  const span = (a: number, b: number, cy: number, role: Role): void => {
    for (let x = Math.min(a, b); x <= Math.max(a, b); x++) piece(x, cy, role);
  };
  const same = (x: number): number => x;
  const mirror = (x: number): number => BODY_LAST_COLUMN - x;

  const flare = (rows: readonly FlareRow[], m: (x: number) => number): void => {
    for (const [dy, edgeColumn, fill, inner, tongue] of rows) {
      const y = hem + dy;
      span(m(fill[0]), m(fill[1]), y, "cloth");
      piece(m(edgeColumn), y, "line");
      if (inner !== null) piece(m(inner), y, "line");
      for (const t of tongue) piece(m(t), y, "line");
    }
    const last = rows.at(-1)!;
    span(m(last[1]), m(last[3] ?? last[2][1]), hem + last[0] + 1, "line");
  };

  if (face === "front" || face === "side") {
    flare(LEFT_FLARE, same);
    flare(face === "front" ? LEFT_FLARE : SIDE_RIGHT_FLARE, face === "front" ? mirror : same);
  } else if (face === "sit") {
    // Seated: tails on the floor beside the tucked feet, and three tongues on the lap.
    for (const m of [same, mirror]) {
      span(m(0), m(2), bottom - 4, "cloth");
      piece(m(-1), bottom - 4, "line");
      span(m(-1), m(1), bottom - 3, "cloth");
      piece(m(-2), bottom - 3, "line");
      for (const dy of [-2, -1]) {
        span(m(-2), m(-1), bottom + dy, "cloth");
        piece(m(-3), bottom + dy, "line");
      }
      span(m(-3), m(-1), bottom, "line");
    }
    for (const bx of [6, 10, 14]) for (const dy of [-3, -2, -1]) piece(bx, bottom + dy, "line");
  }
  return out;
};

// ── the beard over the cloth ────────────────────────────────────────────────
// A Sage's moustache droops to the shoulders, where its ends reach the
// body's outline and show as white specks on the cloth's silhouette. Below
// the collar the beard keeps to the middle of the cloth: nothing of it is
// drawn outside the silhouette or within a couple of art pixels of its edge,
// so the garment's edge always reads clean and the beard keeps its centre.

/** How far past the frame, in cells, the beard can reach and still be cut. */
const BEARD_REACH_CELLS = 8;
/** How many cells in from the silhouette's outline the beard stays out of. */
const BEARD_EDGE_CELLS = 2;

/**
 * The cells where the beard is not drawn on a dressed frame. At any row, the
 * silhouette's own edge (an outline cell with a transparent neighbour) and
 * everything outside it, out to the beard's reach: a bowed or turned head puts
 * the moustache's ends on the head's outline too. From the collar's top line
 * down, also the outline cell of each row and the two cells inward of it on
 * either side, tail included, so the garment's edge reads clean. Frames that
 * wear no garment are untouched.
 */
export const beardClipCells = (region: GarmentRegion): { x: number; y: number }[] => {
  const cells: { x: number; y: number }[] = [];
  const rows = [...region.head, ...region.rows];
  const at = (x: number, y: number): string => (x < 0 || x >= region.w || y < 0 ? "." : (rows[y]?.[x] ?? "o"));
  rows.forEach((row, y) => {
    const left = row.search(/[^.]/);
    const right = row.length - 1 - [...row].reverse().join("").search(/[^.]/);
    for (let x = -BEARD_REACH_CELLS; x < region.w + BEARD_REACH_CELLS; x++) {
      const cell = at(x, y);
      const edge =
        cell === "k" && [-1, 0, 1].some((dy) => [-1, 0, 1].some((dx) => (dx !== 0 || dy !== 0) && at(x + dx, y + dy) === "."));
      const margin = y >= region.neck - 1 && (left < 0 || x <= left + BEARD_EDGE_CELLS || x >= right - BEARD_EDGE_CELLS);
      if (cell === "." || edge || margin) cells.push({ x, y });
    }
  });
  return cells;
};

/** Paint the beard's clip in the frame's own pixels, to be cut out of the beard. */
export const paintBeardClip = (ctx: SceneContext, region: GarmentRegion): void => {
  const { ox, oy } = region;
  ctx.fillStyle = "#000";
  for (const cell of beardClipCells(region)) {
    const x = cellEdge(cell.x, ox);
    const y = cellEdge(cell.y, oy);
    ctx.fillRect(x, y, cellEdge(cell.x + 1, ox) - x, cellEdge(cell.y + 1, oy) - y);
  }
};

// ── painting ────────────────────────────────────────────────────────────────

const css = ([r, g, b]: RGB): string => `rgb(${r}, ${g}, ${b})`;

/** Paint a garment in the frame's own pixels, with the frame's top-left at the origin. */
export const paintGarment = (ctx: SceneContext, region: GarmentRegion, garment: Garment): void => {
  const { ox, oy } = region;
  for (const cell of garmentCells(region, garment)) {
    const x = cellEdge(cell.x, ox);
    const y = cellEdge(cell.y, oy);
    ctx.fillStyle = css(cell.color);
    ctx.fillRect(x, y, cellEdge(cell.x + 1, ox) - x, cellEdge(cell.y + 1, oy) - y);
  }
};

/**
 * What a garment's canvas covers in the frame's pixels: the frame, and a
 * tail's reach on each side. A native frame can stop a pixel short of its last
 * row of art pixels, which a tail on the floor row still wants.
 */
export const garmentExtent = (
  frame: { w: number; h: number },
  region: GarmentRegion,
): { x: number; y: number; w: number; h: number } => {
  const left = cellEdge(-GARMENT_MARGIN_CELLS, region.ox);
  const right = Math.max(frame.w, cellEdge(region.w + GARMENT_MARGIN_CELLS, region.ox));
  return { x: left, y: 0, w: right - left, h: Math.max(frame.h, cellEdge(region.h, region.oy)) };
};
