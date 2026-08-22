// The room's architecture, composed a pixel at a time (SPEC §22.3). This
// module is pure: it takes the hour, the weather, the season, the theme and
// the pet's condition, and returns an RGBA buffer. Nothing here touches a
// canvas, so the whole backdrop is unit-testable and the expensive work can
// be cached behind a key.
//
// Every gradient is an ordered dither between two adjacent ramp colours
// rather than a blend (SPEC §22.6): the room only ever contains colours the
// theme named, and large soft falloffs stay legible at this resolution
// instead of turning to mud.

import { BLEND_STEPS, type DaySegment, type Season, type Weather } from "@/sim/atmosphere";
import { mix, scale, themeFor, type RGB, type RoomTheme } from "./theme";

export const ROOM_WIDTH = 260;
export const ROOM_HEIGHT = 200;

export const RAIL_Y = 96;
export const RAIL_H = 4;
export const WAINSCOT_Y = 100;
export const FLOOR_Y = 126;

/** The window, and the pane of sky inside it — the room's light source. */
export const WINDOW = { x: 152, y: 14, w: 64, h: 52 } as const;
export const GLASS = { x: 155, y: 17, w: 58, h: 46 } as const;
const SILL = { x: 148, y: WINDOW.y + WINDOW.h, w: 72, h: 4 } as const;
const LIGHT_X = GLASS.x + GLASS.w / 2;
const LIGHT_Y = GLASS.y + GLASS.h / 2;

export const RUG = { x: 66, y: 158, w: 128, h: 26 } as const;

/** How rough a time the pet is having, which the room wears too (§22.4). */
export type Condition = "well" | "poor" | "critical";

export type BackdropKey = {
  /** Where the day is being spent (SPEC §22.8). */
  venueId: string;
  themeId: string;
  segment: DaySegment;
  next: DaySegment;
  blend: number;
  weather: Weather;
  season: Season;
  /** Quantized sun height, 0–8, so the cache turns over a few times an hour. */
  sunStep: number;
  condition: Condition;
};

export const keyOf = (key: BackdropKey): string =>
  [key.venueId, key.themeId, key.segment, key.next, key.blend, key.weather, key.season, key.sunStep, key.condition].join("|");

// ── dithering ───────────────────────────────────────────────────────────────

const BAYER = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
] as const;

/** The Bayer cutoff at a pixel; `layer` decorrelates stacked dithers. */
export const threshold = (x: number, y: number, layer = 0): number =>
  (BAYER[(y + layer * 2) & 3]![(x + layer * 3) & 3]! + 0.5) / 16;

/**
 * How much of each band is spent dithering into the next. The rest stays a
 * flat colour: a gradient that stipples end to end reads as noise, and the
 * eye needs somewhere to rest (SPEC §22.6).
 */
const DITHER_ZONE = 0.4;

/** Pick a ramp entry for a 0–1 position, dithering only across the seam. */
export const pickRamp = (ramp: readonly RGB[], t: number, x: number, y: number, layer = 0): RGB => {
  const clamped = Math.max(0, Math.min(0.999_9, t));
  const position = clamped * (ramp.length - 1);
  const index = Math.floor(position);
  const frac = position - index;
  const edge = (1 - DITHER_ZONE) / 2;
  const blend = frac <= edge ? 0 : frac >= 1 - edge ? 1 : (frac - edge) / DITHER_ZONE;
  return blend > threshold(x, y, layer) ? ramp[Math.min(index + 1, ramp.length - 1)]! : ramp[index]!;
};

// ── sky ─────────────────────────────────────────────────────────────────────

// Three hue-shifted colours per segment: zenith, middle, horizon. Dawn and
// dusk carry the widest hue travel — cool overhead, warm at the horizon —
// which is what makes them read as those hours and not just "dim".
const SKY_RAMPS: Record<DaySegment, readonly [RGB, RGB, RGB]> = {
  night: [
    [11, 16, 48],
    [20, 26, 66],
    [35, 42, 92],
  ],
  dawn: [
    [42, 58, 107],
    [106, 90, 140],
    [214, 138, 114],
  ],
  morning: [
    [74, 134, 196],
    [127, 176, 220],
    [191, 224, 239],
  ],
  midday: [
    [61, 143, 212],
    [111, 180, 230],
    [169, 220, 245],
  ],
  afternoon: [
    [74, 142, 194],
    [143, 184, 212],
    [224, 201, 160],
  ],
  dusk: [
    [42, 42, 94],
    [122, 74, 122],
    [224, 122, 74],
  ],
};

const OVERCAST: RGB = [122, 126, 140];

/**
 * The three anchors become five bands by splitting each pair at its midpoint.
 * The ramp is still entirely determined by the anchors — this is a fixed
 * expansion, not a per-pixel blend.
 */
const expand = (anchors: readonly RGB[]): RGB[] => {
  const out: RGB[] = [];
  for (let i = 0; i < anchors.length - 1; i++) {
    out.push(anchors[i]!, mix(anchors[i]!, anchors[i + 1]!, 0.5));
  }
  out.push(anchors[anchors.length - 1]!);
  return out;
};

/** Weather and season bend the ramp without inventing a new palette. */
export const skyRamp = (segment: DaySegment, weather: Weather, season: Season): readonly RGB[] => {
  let ramp = expand(SKY_RAMPS[segment]);
  if (weather === "cloudy") ramp = ramp.map((color) => mix(color, OVERCAST, 0.35));
  if (weather === "rain") ramp = ramp.map((color) => scale(mix(color, OVERCAST, 0.45), 0.78));
  if (weather === "snow") ramp = ramp.map((color) => mix(color, [226, 232, 244], 0.3));
  // Summer light runs warmer and higher; winter light is thin and cool.
  if (season === "summer") ramp = ramp.map((color) => mix(color, [255, 226, 170], 0.08));
  if (season === "winter") ramp = ramp.map((color) => mix(color, [186, 206, 232], 0.12));
  return ramp;
};

export const isDark = (segment: DaySegment): boolean => segment === "night";

// ── outside ─────────────────────────────────────────────────────────────────

/**
 * The silhouette beyond the glass, as a height above the glass bottom for
 * each column. Fixed per theme so the view out of the window is a place
 * rather than noise.
 */
export const skylineAt = (theme: RoomTheme, gx: number): number => {
  if (theme.outside === "forest") {
    // Overlapping conifers: two saw waves of different periods.
    const near = 12 - Math.abs(((gx + 3) % 14) - 7);
    const far = 9 - Math.abs(((gx + 9) % 22) - 11);
    return Math.max(4, near, far);
  }
  if (theme.outside === "sea") return 9;
  // A town roofline: blocks of a few heights, with the odd taller building.
  const block = Math.floor(gx / 9);
  const heights = [10, 15, 8, 19, 12, 9, 16, 11];
  return heights[block % heights.length]!;
};

/**
 * Warm windows after dark. They sit on each building's own grid — two
 * columns, one row every four — so the town reads as rooms with people in
 * them rather than a scatter of sparks.
 */
const townLightAt = (gx: number, gy: number, height: number): boolean => {
  const column = gx % 9;
  if (column !== 3 && column !== 6) return false;
  const fromBottom = GLASS.h - 1 - gy;
  if (fromBottom > height - 3 || fromBottom < 3) return false;
  if (fromBottom % 4 !== 0) return false;
  const block = Math.floor(gx / 9);
  return (block * 31 + column * 17 + fromBottom * 7) % 5 < 3;
};

/** The strip of land at the foot of the view, which is what carries season. */
const SEASON_GROUND: Record<Season, RGB> = {
  spring: [96, 140, 86],
  summer: [72, 124, 70],
  autumn: [150, 104, 52],
  winter: [206, 214, 228],
};

// ── condition ───────────────────────────────────────────────────────────────

/**
 * A struggling pet takes the room down with it (SPEC §22.4): the palette
 * loses a little life and a little light. It is deliberately subtle — a
 * signal you feel before you read the meters, not a punishment.
 */
export const wear = (color: RGB, condition: Condition): RGB => {
  if (condition === "well") return color;
  const grey = (color[0] + color[1] + color[2]) / 3;
  const toward: RGB = [grey, grey, grey];
  return condition === "poor" ? scale(mix(color, toward, 0.22), 0.94) : scale(mix(color, toward, 0.42), 0.84);
};

// ── composition ─────────────────────────────────────────────────────────────

export const composeBackdrop = (key: BackdropKey): Uint8ClampedArray => {
  const theme = themeFor(key.themeId);
  const buffer = new Uint8ClampedArray(ROOM_WIDTH * ROOM_HEIGHT * 4);
  const put = (x: number, y: number, color: RGB): void => {
    const i = (y * ROOM_WIDTH + x) * 4;
    buffer[i] = color[0];
    buffer[i + 1] = color[1];
    buffer[i + 2] = color[2];
    buffer[i + 3] = 255;
  };

  const worn = (color: RGB): RGB => wear(color, key.condition);
  const wallRamp = theme.wall.map(worn);
  const floorRamp = theme.floor.map(worn);
  const sunlit = key.sunStep / 8;

  const currentSky = skyRamp(key.segment, key.weather, key.season);
  const nextSky = skyRamp(key.next, key.weather, key.season);
  const skyAt = (x: number, y: number, gy: number): RGB => {
    const t = gy / (GLASS.h - 1);
    const current = pickRamp(currentSky, t, x, y);
    if (key.blend === 0) return current;
    const upcoming = pickRamp(nextSky, t, x, y);
    return key.blend / BLEND_STEPS > threshold(x, y, 1) ? upcoming : current;
  };

  // 1. Wall — brightest beside the window, falling off with distance. The
  //    falloff is dithered, so the room has light without visible bands.
  const maxDistance = Math.hypot(ROOM_WIDTH, RAIL_Y);
  for (let y = 0; y < RAIL_Y; y++) {
    for (let x = 0; x < ROOM_WIDTH; x++) {
      const distance = Math.hypot(x - LIGHT_X, y - LIGHT_Y) / maxDistance;
      // Daylight reaches further into the room than a night sky does.
      const reach = 0.55 + sunlit * 0.5;
      const t = Math.min(1, distance / reach);
      let color = pickRamp([wallRamp[2]!, wallRamp[1]!, wallRamp[0]!], t, x, y);
      // 2. Wallpaper stripe: a single dim column every eight, only where the
      //    wall is not already at its darkest.
      if (x % 13 === 5 && color !== wallRamp[0]) color = worn(theme.stripe);
      put(x, y, color);
    }
  }

  // 3. Window — sky, then the outside silhouette, then the frame over both.
  for (let gy = 0; gy < GLASS.h; gy++) {
    for (let gx = 0; gx < GLASS.w; gx++) {
      const x = GLASS.x + gx;
      const y = GLASS.y + gy;
      let color = skyAt(x, y, gy);
      const height = skylineAt(theme, gx);
      const fromBottom = GLASS.h - 1 - gy;
      if (fromBottom < height) {
        const horizon = color;
        color = mix(horizon, [8, 6, 18], theme.outside === "sea" ? 0.35 : 0.62);
        if (theme.outside === "town" && isDark(key.segment) && townLightAt(gx, gy, height)) {
          color = [232, 196, 122];
        }
        if (theme.outside === "sea") {
          // Water catches the sky: alternating rows of two values.
          color = fromBottom % 3 === 0 ? mix(horizon, [12, 30, 60], 0.35) : color;
        }
      }
      // The ground at the foot of the view carries the season.
      if (fromBottom < 2 && theme.outside !== "sea") color = SEASON_GROUND[key.season];
      // Winter caps every roofline with a pixel of snow.
      if (key.season === "winter" && theme.outside !== "sea" && fromBottom === height - 1) {
        color = [226, 232, 244];
      }
      // A ledge of settled snow along the outside of the pane.
      if (key.weather === "snow" && fromBottom < 2) color = [222, 230, 242];
      put(x, y, color);
    }
  }

  // Frame, mullions and sill, lit from the room side.
  const frameLight = worn(theme.frame.light);
  const frameMid = worn(theme.frame.mid);
  const frameDark = worn(theme.frame.dark);
  for (let y = WINDOW.y; y < WINDOW.y + WINDOW.h; y++) {
    for (let x = WINDOW.x; x < WINDOW.x + WINDOW.w; x++) {
      const insideGlass = x >= GLASS.x && x < GLASS.x + GLASS.w && y >= GLASS.y && y < GLASS.y + GLASS.h;
      if (insideGlass) continue;
      const top = y < GLASS.y;
      const left = x < GLASS.x;
      put(x, y, top || left ? frameMid : frameDark);
    }
  }
  for (let x = WINDOW.x; x < WINDOW.x + WINDOW.w; x++) put(x, WINDOW.y, frameLight);
  // Mullions: one vertical, one horizontal, dividing the pane in four.
  const mullionX = GLASS.x + Math.floor(GLASS.w / 2);
  const mullionY = GLASS.y + Math.floor(GLASS.h / 2);
  for (let y = GLASS.y; y < GLASS.y + GLASS.h; y++) put(mullionX, y, frameMid);
  for (let x = GLASS.x; x < GLASS.x + GLASS.w; x++) put(x, mullionY, frameMid);
  for (let y = SILL.y; y < SILL.y + SILL.h; y++) {
    for (let x = SILL.x; x < SILL.x + SILL.w; x++) {
      put(x, y, y === SILL.y ? frameLight : y === SILL.y + SILL.h - 1 ? frameDark : frameMid);
    }
  }

  // 4. Picture rail — the room's horizon line, lit along its top edge.
  for (let y = RAIL_Y; y < RAIL_Y + RAIL_H; y++) {
    for (let x = 0; x < ROOM_WIDTH; x++) {
      put(x, y, y === RAIL_Y ? worn(theme.rail.highlight) : worn(theme.rail.body));
    }
  }

  // 5. Wainscot — panels separated by grooves, on a darker base board.
  const panel = worn(theme.wainscot.panel);
  const groove = worn(theme.wainscot.groove);
  const panelLight = worn(theme.wainscot.highlight);
  const base = worn(theme.wainscot.base);
  for (let y = WAINSCOT_Y; y < FLOOR_Y; y++) {
    for (let x = 0; x < ROOM_WIDTH; x++) {
      let color = panel;
      if (y >= FLOOR_Y - 4) color = base;
      else if (y === WAINSCOT_Y) color = panelLight;
      else if (x % 26 === 0) color = groove;
      else if (x % 26 === 1) color = panelLight;
      put(x, y, color);
    }
  }

  // 6. Floor — boards receding to the wall, seams tightening with distance
  //    so the room has depth without a perspective grid.
  const seam = worn(theme.seam);
  const seamRows = new Set<number>();
  const bands: { top: number; bottom: number }[] = [];
  let gap = 3;
  let previous = FLOOR_Y;
  for (let y = FLOOR_Y + 2; y < ROOM_HEIGHT; y += gap, gap += 2) {
    seamRows.add(y);
    bands.push({ top: previous, bottom: y });
    previous = y + 1;
  }
  bands.push({ top: previous, bottom: ROOM_HEIGHT - 1 });
  // Butt joints: one short vertical seam per board, staggered band to band.
  // They are drawn as segments spanning their band — a lone pixel here would
  // read as a dead pixel rather than a plank end (SPEC §22.6).
  const joints = new Set<number>();
  bands.forEach((band, index) => {
    const stride = 104 + (index % 3) * 31;
    for (let x = 18 + index * 37; x < ROOM_WIDTH; x += stride) {
      for (let y = band.top; y <= band.bottom; y++) joints.add(y * ROOM_WIDTH + x);
    }
  });
  const depthOf = (y: number): number => (y - FLOOR_Y) / (ROOM_HEIGHT - FLOOR_Y);
  for (let y = FLOOR_Y; y < ROOM_HEIGHT; y++) {
    const depth = depthOf(y);
    for (let x = 0; x < ROOM_WIDTH; x++) {
      let color = pickRamp(floorRamp, depth, x, y);
      // 7. Light pool — a dithered wedge of daylight, leaning away from the
      //    window as it comes forward. Dark hours leave a cool sheen instead.
      const centre = LIGHT_X - 46 * depth;
      const half = 22 + 30 * depth;
      const offset = Math.abs(x - centre) / half;
      if (offset < 1) {
        const edge = 1 - offset * offset;
        const strength = isDark(key.segment) ? edge * 0.3 : edge * (0.25 + sunlit * 0.75);
        if (strength > threshold(x, y, 2)) color = worn(isDark(key.segment) ? theme.moonPool : theme.sunPool);
      }
      if (seamRows.has(y) || joints.has(y * ROOM_WIDTH + x)) color = seam;
      put(x, y, color);
    }
  }

  // 8. Rug — a woven border and diamond motifs, with fringe at both ends.
  const rugBorder = worn(theme.rug.border);
  const rugField = worn(theme.rug.field);
  const rugMotif = worn(theme.rug.motif);
  const rugFringe = worn(theme.rug.fringe);
  for (let y = RUG.y; y < RUG.y + RUG.h; y++) {
    const ry = y - RUG.y;
    for (let x = RUG.x; x < RUG.x + RUG.w; x++) {
      const rx = x - RUG.x;
      const fringeSide = rx < 4 || rx >= RUG.w - 4;
      if (fringeSide) {
        if (ry % 2 === 0 && ry > 1 && ry < RUG.h - 2) put(x, y, rugFringe);
        continue;
      }
      let color = rugField;
      const edge = Math.min(rx - 4, RUG.w - 5 - rx, ry, RUG.h - 1 - ry);
      if (edge < 2) color = rugBorder;
      else if (edge < 3) color = rugMotif;
      else {
        // Diamonds: a taxicab lattice, which at this size reads as weaving.
        const dx = (rx - 4) % 22;
        const dy = ry % 11;
        if (Math.abs(dx - 11) + Math.abs(dy - 5) < 4) color = rugMotif;
      }
      put(x, y, color);
    }
  }

  return buffer;
};
