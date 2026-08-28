// The outdoor venues (SPEC §22.8), composed a pixel at a time with the same
// discipline as the room (§22.6): every colour is a named venue ramp, every
// gradient an ordered dither between adjacent ramp values, and the sky is
// the very machinery the window shows — drawn full-bleed, because out here
// there is no pane between the pet and the weather.
//
// Layout is shared: sky down to HORIZON_Y, the venue's own silhouette band
// against it, ground the rest of the way. The pet stands on the same floor
// line it does at home, so nothing about its draw call changes venue to
// venue.

import { BLEND_STEPS, type Season } from "@/sim/atmosphere";
import {
  isDark,
  pickRamp,
  ROOM_HEIGHT,
  ROOM_WIDTH,
  skyRamp,
  threshold,
  wear,
  type BackdropKey,
} from "./compose";
import type { RGB } from "./theme";
import type { SceneContext } from "../../engine/digest";

/** Where ground meets sky at every outdoor venue. */
export const HORIZON_Y = 92;

export const OUTDOOR_SKY = { x: 0, y: 0, w: ROOM_WIDTH, h: HORIZON_Y } as const;

/** The open ground span the pet may wander (before its own size insets). */
export const OUTDOOR_SPAN = { left: 20, right: ROOM_WIDTH - 20 } as const;

/** A small deterministic hash for feature placement — same field for every
 *  viewer, forever. */
const hash = (n: number): number => {
  let h = Math.imul(n ^ 0x9e3779b9, 2654435761);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
};

/** Winter buries every outdoor ground the same way (SPEC §22.8). */
const SNOW_RAMP: readonly [RGB, RGB, RGB] = [
  [186, 196, 214],
  [204, 214, 228],
  [222, 230, 242],
];

type Put = (x: number, y: number, color: RGB) => void;

/** The full-bleed sky, with the same segment dissolve the window carries. */
const paintSky = (key: BackdropKey, put: Put): void => {
  const current = skyRamp(key.segment, key.weather, key.season);
  const next = skyRamp(key.next, key.weather, key.season);
  for (let y = 0; y < HORIZON_Y; y++) {
    const t = y / (HORIZON_Y - 1);
    for (let x = 0; x < ROOM_WIDTH; x++) {
      let color = pickRamp(current, t, x, y);
      if (key.blend > 0 && key.blend / BLEND_STEPS > threshold(x, y, 1)) {
        color = pickRamp(next, t, x, y);
      }
      put(x, y, color);
    }
  }
};

/**
 * Ground receding to the horizon: the venue's seasonal ramp, dithered by
 * depth, with sparse two-pixel grain runs — blades, pebbles, needles — so
 * the surface has texture without noise. A `bare` ground (snow, frost)
 * keeps an unbroken crust.
 */
const paintGround = (
  key: BackdropKey,
  put: Put,
  ramps: Record<Season, readonly [RGB, RGB, RGB]>,
  grain: RGB,
  bare: boolean,
): void => {
  const worn = (color: RGB): RGB => wear(color, key.condition);
  const ramp = ramps[key.season].map(worn);
  for (let y = HORIZON_Y; y < ROOM_HEIGHT; y++) {
    const depth = (y - HORIZON_Y) / (ROOM_HEIGHT - HORIZON_Y);
    for (let x = 0; x < ROOM_WIDTH; x++) {
      let color = pickRamp(ramp, depth, x, y);
      if (!bare && hash(x * 131 + y * 517) < 0.05 + depth * 0.06 && hash(x * 37 + y * 91) < 0.5) {
        color = worn(grain);
      }
      put(x, y, color);
    }
  }
};

/**
 * Direct sunlight on the ground — the window's pool, unwalled (SPEC §22.8).
 * Two soft wedges by day whose strength follows the sun; one cool wash of
 * moonlight at night. Dithered like every other gradient.
 */
const paintLight = (key: BackdropKey, put: Put, sunPatch: RGB, moonPatch: RGB): void => {
  const dark = isDark(key.segment);
  const strengthBase = dark ? 0.3 : 0.2 + (key.sunStep / 8) * 0.7;
  const patches = dark ? [{ centre: 150, half: 60 }] : [{ centre: 70, half: 42 }, { centre: 196, half: 36 }];
  const color = wear(dark ? moonPatch : sunPatch, key.condition);
  for (let y = HORIZON_Y + 4; y < ROOM_HEIGHT; y++) {
    const depth = (y - HORIZON_Y) / (ROOM_HEIGHT - HORIZON_Y);
    for (const patch of patches) {
      const half = patch.half * (0.6 + depth * 0.6);
      for (let x = Math.max(0, Math.floor(patch.centre - half)); x < Math.min(ROOM_WIDTH, patch.centre + half); x++) {
        const offset = Math.abs(x - patch.centre) / half;
        const edge = 1 - offset * offset;
        if (edge * strengthBase > threshold(x, y, 2)) put(x, y, color);
      }
    }
  }
};

const makeBuffer = (): { buffer: Uint8ClampedArray; put: Put } => {
  const buffer = new Uint8ClampedArray(ROOM_WIDTH * ROOM_HEIGHT * 4);
  const put: Put = (x, y, color) => {
    const i = (y * ROOM_WIDTH + x) * 4;
    buffer[i] = color[0];
    buffer[i + 1] = color[1];
    buffer[i + 2] = color[2];
    buffer[i + 3] = 255;
  };
  return { buffer, put };
};

// ── the backyard garden ─────────────────────────────────────────────────────

export const GARDEN = {
  grass: {
    spring: [
      [50, 92, 56],
      [66, 114, 62],
      [88, 138, 74],
    ],
    summer: [
      [46, 84, 52],
      [62, 106, 60],
      [82, 132, 72],
    ],
    autumn: [
      [84, 88, 44],
      [108, 108, 52],
      [134, 128, 62],
    ],
    winter: SNOW_RAMP,
  } as Record<Season, readonly [RGB, RGB, RGB]>,
  blade: [40, 76, 48] as RGB,
  hedge: [34, 62, 42] as RGB,
  hedgeLight: [48, 82, 52] as RGB,
  fence: [116, 92, 62] as RGB,
  fenceLight: [146, 118, 82] as RGB,
  path: [148, 126, 92] as RGB,
  pathEdge: [116, 96, 70] as RGB,
  soil: [88, 62, 44] as RGB,
  soilDark: [66, 46, 34] as RGB,
  leaf: [56, 112, 60] as RGB,
  fruit: [182, 92, 58] as RGB,
  bloomPink: [214, 128, 160] as RGB,
  bloomGold: [224, 186, 96] as RGB,
  sunPatch: [128, 150, 84] as RGB,
  moonPatch: [64, 84, 96] as RGB,
};

/** The garden fence's height above the horizon in a column. */
export const gardenHorizonAt = (sx: number): number => 7 + (Math.floor(sx / 13) % 2) * 2;

export const composeGarden = (key: BackdropKey): Uint8ClampedArray => {
  const { buffer, put } = makeBuffer();
  const worn = (color: RGB): RGB => wear(color, key.condition);
  const winter = key.season === "winter";

  paintSky(key, put);

  // Hedge against the sky, scalloped like the horizon promises the sun.
  for (let x = 0; x < ROOM_WIDTH; x++) {
    const top = HORIZON_Y - gardenHorizonAt(x);
    for (let y = top; y < HORIZON_Y; y++) {
      put(x, y, worn(y === top ? GARDEN.hedgeLight : GARDEN.hedge));
    }
  }

  paintGround(key, put, GARDEN.grass, GARDEN.blade, key.season === "winter");

  // The fence stands just inside the garden, posts on a steady beat.
  for (let x = 0; x < ROOM_WIDTH; x++) {
    put(x, HORIZON_Y, worn(GARDEN.fenceLight));
    put(x, HORIZON_Y + 4, worn(GARDEN.fence));
    if (x % 13 === 6) {
      for (let y = HORIZON_Y; y < HORIZON_Y + 9; y++) put(x, y, worn(GARDEN.fence));
      put(x, HORIZON_Y + 1, worn(GARDEN.fenceLight));
    }
  }

  // A path from the foreground up to the gate, narrowing with distance.
  for (let y = HORIZON_Y + 9; y < ROOM_HEIGHT; y++) {
    const depth = (y - HORIZON_Y) / (ROOM_HEIGHT - HORIZON_Y);
    const centre = 130 + depth * 14;
    const half = 5 + depth * 15;
    for (let x = Math.floor(centre - half); x <= Math.ceil(centre + half); x++) {
      const offset = Math.abs(x - centre) / half;
      if (offset > 1) continue;
      const edgeBand = offset > 0.72;
      const color = edgeBand ? GARDEN.pathEdge : GARDEN.path;
      if (offset <= 0.72 || threshold(x, y, 3) < 0.55) put(x, y, worn(winter ? SNOW_RAMP[1] : color));
    }
  }

  // Flowerbed on the left: turned soil with blooms on a loose lattice.
  for (let y = 150; y < 170; y++) {
    for (let x = 10; x < 62; x++) {
      put(x, y, worn((x + y) % 7 === 0 ? GARDEN.soilDark : GARDEN.soil));
    }
  }
  if (!winter) {
    for (let index = 0; index < 14; index++) {
      const x = 12 + Math.floor(hash(index * 47) * 48);
      const y = 152 + Math.floor(hash(index * 89) * 15);
      const bloom = index % 2 === 0 ? GARDEN.bloomPink : GARDEN.bloomGold;
      put(x, y, worn(bloom));
      put(x + 1, y, worn(bloom));
    }
  }

  // Vegetable patch on the right: soil rows with leaves, fruit in autumn.
  for (let y = 130; y < 148; y++) {
    for (let x = 196; x < 252; x++) {
      put(x, y, worn(y % 4 < 2 ? GARDEN.soil : GARDEN.soilDark));
    }
  }
  if (!winter) {
    for (let index = 0; index < 12; index++) {
      const x = 198 + Math.floor(hash(index * 61) * 50);
      const y = 130 + (index % 4) * 4 + 1;
      put(x, y, worn(GARDEN.leaf));
      put(x + 1, y, worn(GARDEN.leaf));
      if (key.season === "autumn" && index % 3 === 0) put(x, y + 1, worn(GARDEN.fruit));
    }
  }

  paintLight(key, put, GARDEN.sunPatch, GARDEN.moonPatch);
  return buffer;
};

// ── the wildflower meadow ───────────────────────────────────────────────────

export const MEADOW = {
  grass: {
    spring: [
      [54, 100, 62],
      [72, 126, 68],
      [96, 152, 80],
    ],
    summer: [
      [52, 96, 58],
      [70, 122, 66],
      [94, 148, 78],
    ],
    autumn: [
      [92, 94, 48],
      [118, 116, 56],
      [146, 138, 68],
    ],
    winter: SNOW_RAMP,
  } as Record<Season, readonly [RGB, RGB, RGB]>,
  blade: [44, 84, 50] as RGB,
  hillFar: [56, 96, 84] as RGB,
  treeline: [32, 56, 44] as RGB,
  poppy: [198, 88, 74] as RGB,
  daisy: [236, 232, 222] as RGB,
  violet: [150, 110, 180] as RGB,
  stalk: [40, 80, 46] as RGB,
  sunPatch: [138, 158, 88] as RGB,
  moonPatch: [66, 86, 98] as RGB,
};

/** Rolling treeline over far hills — where the meadow's sun sets. */
export const meadowHorizonAt = (sx: number): number => {
  const hills = 10 - Math.floor(Math.abs(((sx + 9) % 52) - 26) / 4);
  const trees = 12 - Math.abs(((sx + 4) % 18) - 9);
  return Math.max(4, hills, trees);
};

export const composeMeadow = (key: BackdropKey): Uint8ClampedArray => {
  const { buffer, put } = makeBuffer();
  const worn = (color: RGB): RGB => wear(color, key.condition);
  const winter = key.season === "winter";

  paintSky(key, put);

  // Far hills first, the nearer treeline scalloped over them.
  for (let x = 0; x < ROOM_WIDTH; x++) {
    const hillTop = HORIZON_Y - (10 - Math.floor(Math.abs(((x + 9) % 52) - 26) / 4));
    for (let y = hillTop; y < HORIZON_Y; y++) put(x, y, worn(MEADOW.hillFar));
    const treeTop = HORIZON_Y - (12 - Math.abs(((x + 4) % 18) - 9));
    for (let y = Math.max(treeTop, hillTop - 4); y < HORIZON_Y; y++) {
      if (y >= treeTop) put(x, y, worn(MEADOW.treeline));
    }
  }

  paintGround(key, put, MEADOW.grass, MEADOW.blade, key.season === "winter");

  // Wildflowers in loose drifts, denser toward the foreground; a head of
  // colour over a stalk pixel so they read as plants, not confetti.
  if (!winter) {
    const heads = [MEADOW.poppy, MEADOW.daisy, MEADOW.violet];
    for (let index = 0; index < 46; index++) {
      const drift = Math.floor(hash(index * 13) * 3);
      const x = 6 + Math.floor(hash(index * 29 + drift) * (ROOM_WIDTH - 12));
      const y = HORIZON_Y + 8 + Math.floor(hash(index * 71) ** 1.6 * (ROOM_HEIGHT - HORIZON_Y - 14));
      put(x, y, worn(heads[index % heads.length]!));
      put(x, y + 1, worn(MEADOW.stalk));
    }
  }

  paintLight(key, put, MEADOW.sunPatch, MEADOW.moonPatch);
  return buffer;
};

// ── the beach ───────────────────────────────────────────────────────────────

export const BEACH = {
  sand: {
    spring: [
      [160, 134, 100],
      [180, 154, 116],
      [202, 176, 132],
    ],
    summer: [
      [168, 140, 104],
      [188, 160, 120],
      [210, 182, 138],
    ],
    autumn: [
      [142, 118, 92],
      [160, 136, 106],
      [180, 156, 122],
    ],
    // A beach does not snow over; it frosts pale and cold (SPEC §22.8).
    winter: [
      [176, 178, 190],
      [196, 198, 208],
      [216, 218, 226],
    ],
  } as Record<Season, readonly [RGB, RGB, RGB]>,
  pebble: [140, 120, 96] as RGB,
  sea: [
    [24, 58, 92],
    [34, 80, 116],
    [52, 106, 140],
  ] as readonly [RGB, RGB, RGB],
  sparkle: [150, 190, 210] as RGB,
  foam: [226, 238, 242] as RGB,
  sunPatch: [214, 192, 138] as RGB,
  moonPatch: [88, 104, 122] as RGB,
};

/** The water's own band, above the sand. */
const WATER_TOP = HORIZON_Y - 22;

/** A sea horizon is nearly flat — one pixel of swell, in long runs. */
export const beachHorizonAt = (sx: number): number => 22 + (Math.floor(sx / 40) % 2);

export const composeBeach = (key: BackdropKey): Uint8ClampedArray => {
  const { buffer, put } = makeBuffer();
  const worn = (color: RGB): RGB => wear(color, key.condition);

  paintSky(key, put);

  // The water: its own ramp deepening away, catching sky sparkle in rows.
  const sea = BEACH.sea.map(worn);
  for (let x = 0; x < ROOM_WIDTH; x++) {
    const top = HORIZON_Y - beachHorizonAt(x);
    for (let y = top; y < HORIZON_Y; y++) {
      const t = 1 - (y - WATER_TOP) / (HORIZON_Y - WATER_TOP);
      let color = pickRamp(sea, t, x, y);
      if ((y - top) % 5 === 3 && hash(x * 53 + y * 17) < 0.35) color = worn(BEACH.sparkle);
      put(x, y, color);
    }
  }

  paintGround(key, put, BEACH.sand, BEACH.pebble, key.season === "winter");

  // The waterline: settled foam where the surf reaches the sand.
  for (let x = 0; x < ROOM_WIDTH; x++) {
    if (threshold(x, HORIZON_Y, 3) < 0.7) put(x, HORIZON_Y, worn(BEACH.foam));
    if (threshold(x, HORIZON_Y + 1, 3) < 0.3) put(x, HORIZON_Y + 1, worn(BEACH.foam));
  }

  paintLight(key, put, BEACH.sunPatch, BEACH.moonPatch);
  return buffer;
};

/** The surf breathes (SPEC §22.8): two foam runs sliding over the
 *  waterline. Reduced motion holds them at their settled position. */
export const renderBeachLive = (ctx: SceneContext, nowMs: number): void => {
  ctx.fillStyle = "#e8f2f4";
  const reach = Math.round(Math.sin(nowMs / 1700) * 3);
  const lag = Math.round(Math.sin(nowMs / 1700 - 1.1) * 2);
  for (let x = -6; x < ROOM_WIDTH; x += 14) {
    ctx.fillRect(x + reach, HORIZON_Y, 8, 1);
    ctx.fillRect(x + 7 + lag, HORIZON_Y + 2, 5, 1);
  }
};

// ── the forest clearing ─────────────────────────────────────────────────────

export const FOREST = {
  floor: {
    spring: [
      [40, 70, 44],
      [54, 90, 52],
      [70, 112, 64],
    ],
    summer: [
      [36, 62, 40],
      [48, 80, 48],
      [62, 100, 58],
    ],
    autumn: [
      [86, 72, 40],
      [108, 88, 46],
      [130, 106, 56],
    ],
    // Snowed-in come winter (SPEC §22.8).
    winter: SNOW_RAMP,
  } as Record<Season, readonly [RGB, RGB, RGB]>,
  fern: [46, 90, 52] as RGB,
  canopy: [26, 46, 34] as RGB,
  canopyLight: [38, 64, 44] as RGB,
  trunk: [44, 34, 28] as RGB,
  trunkLight: [70, 54, 42] as RGB,
  stumpTop: [150, 122, 86] as RGB,
  stumpRing: [122, 96, 64] as RGB,
  stumpSide: [92, 70, 50] as RGB,
  stumpShadow: [70, 52, 38] as RGB,
  sunPatch: [120, 142, 80] as RGB,
  moonPatch: [60, 80, 92] as RGB,
};

/** Conifers stand tall around the clearing — the sun sets behind them. */
export const forestHorizonAt = (sx: number): number => 16 + Math.abs(((sx + 7) % 24) - 12) / 2;

export const composeForest = (key: BackdropKey): Uint8ClampedArray => {
  const { buffer, put } = makeBuffer();
  const worn = (color: RGB): RGB => wear(color, key.condition);
  const winter = key.season === "winter";

  paintSky(key, put);

  // The canopy band against the sky, with trunks dropping out of it.
  for (let x = 0; x < ROOM_WIDTH; x++) {
    const top = HORIZON_Y - Math.round(forestHorizonAt(x));
    for (let y = top; y < HORIZON_Y; y++) {
      put(x, y, worn(y === top ? FOREST.canopyLight : FOREST.canopy));
    }
    // Winter caps the canopy with snow, the way the room's rooflines cap.
    if (winter) put(x, top, worn(SNOW_RAMP[2]));
  }
  for (let trunkX = 10; trunkX < ROOM_WIDTH; trunkX += 26) {
    const sway = Math.floor(hash(trunkX * 7) * 5);
    for (let y = HORIZON_Y - 8; y < HORIZON_Y; y++) {
      put(trunkX + sway, y, worn(FOREST.trunkLight));
      put(trunkX + sway + 1, y, worn(FOREST.trunk));
      put(trunkX + sway + 2, y, worn(FOREST.trunk));
    }
  }

  paintGround(key, put, FOREST.floor, FOREST.fern, winter);

  // The stump to perch on, right of centre, rings on its face.
  const stump = { x: 196, y: 148, w: 26, h: 12 };
  for (let y = stump.y; y < stump.y + 6; y++) {
    for (let x = stump.x; x < stump.x + stump.w; x++) {
      const edge = Math.min(x - stump.x, stump.x + stump.w - 1 - x, y - stump.y, stump.y + 5 - y);
      put(x, y, worn(edge === 0 ? FOREST.stumpRing : FOREST.stumpTop));
    }
  }
  put(stump.x + 12, stump.y + 2, worn(FOREST.stumpRing));
  put(stump.x + 13, stump.y + 2, worn(FOREST.stumpRing));
  put(stump.x + 10, stump.y + 3, worn(FOREST.stumpRing));
  for (let y = stump.y + 6; y < stump.y + stump.h; y++) {
    for (let x = stump.x; x < stump.x + stump.w; x++) {
      put(x, y, worn(x % 5 === 0 ? FOREST.stumpShadow : FOREST.stumpSide));
    }
  }

  paintLight(key, put, FOREST.sunPatch, FOREST.moonPatch);
  return buffer;
};

// ── the shrine path ─────────────────────────────────────────────────────────

export const SHRINE = {
  stone: {
    spring: [
      [78, 88, 74],
      [98, 108, 90],
      [120, 128, 108],
    ],
    summer: [
      [74, 84, 70],
      [94, 104, 86],
      [116, 124, 104],
    ],
    autumn: [
      [96, 90, 68],
      [118, 110, 82],
      [140, 130, 98],
    ],
    winter: SNOW_RAMP,
  } as Record<Season, readonly [RGB, RGB, RGB]>,
  moss: [62, 86, 58] as RGB,
  cedar: [28, 48, 40] as RGB,
  cedarLight: [40, 66, 50] as RGB,
  vermilion: [186, 62, 48] as RGB,
  vermilionDark: [140, 42, 34] as RGB,
  tread: [152, 148, 136] as RGB,
  riser: [112, 108, 98] as RGB,
  lantern: [136, 132, 118] as RGB,
  lanternLight: [166, 162, 148] as RGB,
  lanternDark: [92, 90, 82] as RGB,
  sunPatch: [140, 146, 104] as RGB,
  moonPatch: [70, 80, 96] as RGB,
};

/** The torii, in scene coordinates. Its posts stand on the ground, so they
 *  run a few pixels past the horizon rather than resting on it. */
const TORII = { left: 84, right: 172, post: 7, top: 46, beam: 8 } as const;

/**
 * Cedars all along the ridge, with the gate's two posts spiking through
 * them. The span *between* the posts stays at cedar height on purpose: the
 * sun is clipped to whatever stands in its column, so a low horizon there is
 * what lets it drop into the gateway at dusk instead of vanishing behind a
 * solid block of red.
 */
export const shrineHorizonAt = (sx: number): number => {
  const onPost =
    (sx >= TORII.left && sx < TORII.left + TORII.post) || (sx >= TORII.right - TORII.post && sx < TORII.right);
  if (onPost) return HORIZON_Y - TORII.top;
  return 12 + Math.floor(Math.abs(((sx + 5) % 22) - 11) / 3);
};

export const composeShrine = (key: BackdropKey): Uint8ClampedArray => {
  const { buffer, put } = makeBuffer();
  const worn = (color: RGB): RGB => wear(color, key.condition);
  const winter = key.season === "winter";

  paintSky(key, put);

  // The cedar ridge, scalloped like the horizon promises.
  for (let x = 0; x < ROOM_WIDTH; x++) {
    const top = HORIZON_Y - (12 + Math.floor(Math.abs(((x + 5) % 22) - 11) / 3));
    for (let y = top; y < HORIZON_Y; y++) put(x, y, worn(y === top ? SHRINE.cedarLight : SHRINE.cedar));
    if (winter) put(x, top, worn(SNOW_RAMP[2]));
  }

  paintGround(key, put, SHRINE.stone, SHRINE.moss, winter);

  // The steps, climbing away from the viewer and narrowing with distance.
  // Kept right of centre so they never cover the patch of open ground the
  // seasonal-change check samples.
  for (let y = HORIZON_Y; y < ROOM_HEIGHT; y++) {
    const depth = (y - HORIZON_Y) / (ROOM_HEIGHT - HORIZON_Y);
    const centre = 134 + depth * 8;
    const half = 6 + depth * 16;
    // A riser every few rows reads as treads without drawing every step.
    const face = Math.floor(y / 6) % 2 === 0;
    for (let x = Math.max(0, Math.floor(centre - half)); x < Math.min(ROOM_WIDTH, centre + half); x++) {
      const offset = Math.abs(x - centre) / half;
      if (offset > 1) continue;
      // Snow settles on the treads but the risers stay swept stone, or the
      // whole stair disappears into the white it is standing on.
      const color = winter ? (face ? SNOW_RAMP[2] : SHRINE.riser) : face ? SHRINE.tread : SHRINE.riser;
      if (offset <= 0.8 || threshold(x, y, 3) < 0.5) put(x, y, worn(color));
    }
  }

  // The gate: two posts and the beam they carry, planted in the ground.
  for (const postX of [TORII.left, TORII.right - TORII.post]) {
    for (let y = TORII.top; y < HORIZON_Y + 6; y++) {
      for (let x = postX; x < postX + TORII.post; x++) {
        put(x, y, worn(x === postX ? SHRINE.vermilion : SHRINE.vermilionDark));
      }
    }
  }
  for (let y = TORII.top; y < TORII.top + TORII.beam; y++) {
    // The lintel oversails the posts, which is what makes it a torii and not
    // a doorframe; the tie-beam below it is thinner and set inside them.
    const lintel = y < TORII.top + 4;
    const from = lintel ? TORII.left - 8 : TORII.left + 2;
    const to = lintel ? TORII.right + 8 : TORII.right - 2;
    for (let x = Math.max(0, from); x < Math.min(ROOM_WIDTH, to); x++) {
      put(x, y, worn(y === TORII.top ? SHRINE.vermilion : SHRINE.vermilionDark));
    }
  }

  // A stone lantern either side of the path, the near one larger. Drawn as
  // four stacked slabs — footing, post, fire box, roof — because a lantern
  // only reads at this size if each part is clearly a different width.
  const lantern = (baseX: number, baseY: number, scale: number): void => {
    const slab = (top: number, height: number, half: number, color: RGB): void => {
      for (let y = top; y < top + height; y++) {
        for (let x = Math.max(0, baseX - half); x < Math.min(ROOM_WIDTH, baseX + half); x++) put(x, y, worn(color));
      }
    };
    const unit = scale;
    slab(baseY - 3 * unit, 3 * unit, 4 * unit, SHRINE.lanternDark); // footing
    slab(baseY - 8 * unit, 5 * unit, 2 * unit, SHRINE.lantern); // post
    slab(baseY - 14 * unit, 6 * unit, 5 * unit, SHRINE.lantern); // fire box
    // The window the light would come out of, and the eaves over it.
    slab(baseY - 13 * unit, 3 * unit, 2 * unit, SHRINE.lanternLight);
    slab(baseY - 17 * unit, 3 * unit, 7 * unit, SHRINE.lanternLight); // roof
    slab(baseY - 19 * unit, 2 * unit, 2 * unit, SHRINE.lanternDark); // finial
  };
  lantern(40, 178, 2);
  lantern(228, 150, 1);

  paintLight(key, put, SHRINE.sunPatch, SHRINE.moonPatch);
  return buffer;
};

// ── the koi pond ────────────────────────────────────────────────────────────

export const POND = {
  bank: {
    spring: [
      [64, 96, 62],
      [84, 118, 72],
      [106, 142, 86],
    ],
    summer: [
      [58, 90, 58],
      [78, 112, 68],
      [100, 136, 82],
    ],
    autumn: [
      [98, 92, 50],
      [122, 112, 60],
      [148, 134, 74],
    ],
    winter: SNOW_RAMP,
  } as Record<Season, readonly [RGB, RGB, RGB]>,
  blade: [48, 82, 52] as RGB,
  reed: [56, 78, 48] as RGB,
  reedLight: [78, 102, 60] as RGB,
  water: [
    [26, 54, 66],
    [36, 76, 90],
    [52, 100, 112],
  ] as readonly [RGB, RGB, RGB],
  ice: [
    [150, 172, 184],
    [176, 196, 206],
    [202, 218, 226],
  ] as readonly [RGB, RGB, RGB],
  glint: [122, 162, 172] as RGB,
  pad: [44, 96, 62] as RGB,
  padLight: [62, 120, 74] as RGB,
  bloom: [226, 168, 196] as RGB,
  sunPatch: [128, 148, 88] as RGB,
  moonPatch: [64, 82, 96] as RGB,
};

/** Where the near bank takes over from the water. */
const POND_BOTTOM = HORIZON_Y + 44;

/** Reeds on the far bank — low, and never level for long. */
export const pondHorizonAt = (sx: number): number => 6 + Math.floor(Math.abs(((sx + 3) % 16) - 8) / 2);

export const composePond = (key: BackdropKey): Uint8ClampedArray => {
  const { buffer, put } = makeBuffer();
  const worn = (color: RGB): RGB => wear(color, key.condition);
  const winter = key.season === "winter";

  paintSky(key, put);

  for (let x = 0; x < ROOM_WIDTH; x++) {
    const top = HORIZON_Y - pondHorizonAt(x);
    for (let y = top; y < HORIZON_Y; y++) put(x, y, worn(y === top ? POND.reedLight : POND.reed));
  }

  paintGround(key, put, POND.bank, POND.blade, winter);

  // The water, laid over the near end of the ground: it deepens toward the
  // viewer, and freezes pale rather than merely darkening come winter.
  const surface = (winter ? POND.ice : POND.water).map(worn);
  for (let y = HORIZON_Y; y < POND_BOTTOM; y++) {
    const t = (y - HORIZON_Y) / (POND_BOTTOM - HORIZON_Y);
    for (let x = 0; x < ROOM_WIDTH; x++) {
      let color = pickRamp(surface, t, x, y);
      // Glints lie flat on still water, but a fixed row spacing draws a
      // barcode: the row they pick wanders with the column instead.
      const band = (y - HORIZON_Y + Math.floor(hash(x * 3) * 3)) % 7;
      if (!winter && band === 4 && hash(x * 29 + y * 13) < 0.45) color = worn(POND.glint);
      put(x, y, color);
    }
  }

  // Lily pads: whole discs rather than single pixels, and wider the nearer
  // they float. A one-pixel pad is invisible at this size — the pond needs
  // to read as a pond from the first glance, not on inspection.
  if (!winter) {
    for (let index = 0; index < 9; index++) {
      const from = HORIZON_Y + 5;
      const y = from + Math.floor(hash(index * 53) * (POND_BOTTOM - from - 6));
      const x = 16 + Math.floor(hash(index * 31) * (ROOM_WIDTH - 32));
      // Perspective: pads near the bottom of the water band are closest.
      const near = (y - from) / (POND_BOTTOM - from);
      const half = 3 + Math.round(near * 4);
      const rows = 2 + Math.round(near);
      for (let row = 0; row < rows; row++) {
        // The disc narrows top and bottom, and carries the wedge notch that
        // makes a lily pad a lily pad.
        const shrink = row === 0 || row === rows - 1 ? 1 : 0;
        for (let dx = -half + shrink; dx <= half - shrink; dx++) {
          const notch = dx > half - 3 && row < rows - 1;
          if (notch) continue;
          const px = x + dx;
          if (px < 0 || px >= ROOM_WIDTH) continue;
          put(px, y + row, worn(row === 0 ? POND.padLight : POND.pad));
        }
      }
      if (index % 3 === 0) {
        for (let dx = -1; dx <= 1; dx++) {
          const px = x + dx;
          if (px >= 0 && px < ROOM_WIDTH) put(px, y - 1, worn(POND.bloom));
        }
        if (x >= 0 && x < ROOM_WIDTH) put(x, y - 2, worn(POND.bloom));
      }
    }
  }

  // Reeds standing out of the near edge, so the water has a bank rather than
  // a cut line where it stops.
  for (let index = 0; index < 16; index++) {
    const x = 4 + Math.floor(hash(index * 83) * (ROOM_WIDTH - 8));
    const tall = 4 + Math.floor(hash(index * 41) * 5);
    for (let y = POND_BOTTOM - tall; y < POND_BOTTOM + 1; y++) {
      put(x, y, worn(winter ? SNOW_RAMP[0] : POND.reed));
    }
    put(x, POND_BOTTOM - tall, worn(winter ? SNOW_RAMP[2] : POND.reedLight));
  }

  paintLight(key, put, POND.sunPatch, POND.moonPatch);
  return buffer;
};

/** Koi, drifting under the surface (SPEC §22.8). They are drawn over the
 *  composed scene rather than into it, so they cost nothing to cache; under
 *  reduced motion the clock is held at zero and they simply sit still. */
export const renderPondLive = (ctx: SceneContext, nowMs: number): void => {
  const fish = [
    { color: "#d9743c", y: HORIZON_Y + 12, period: 21_000, phase: 0.1, len: 7 },
    { color: "#e8e2d4", y: HORIZON_Y + 24, period: 27_000, phase: 0.5, len: 6 },
    { color: "#c8543c", y: HORIZON_Y + 34, period: 18_000, phase: 0.8, len: 8 },
  ];
  for (const koi of fish) {
    const drift = ((nowMs / koi.period + koi.phase) % 1 + 1) % 1;
    const x = Math.round(-10 + drift * (ROOM_WIDTH + 20));
    ctx.fillStyle = koi.color;
    ctx.fillRect(x, koi.y, koi.len, 2);
    // A tail that trails the body, so it reads as swimming rather than sliding.
    ctx.fillRect(x - 2, koi.y + (Math.floor(nowMs / 700 + koi.phase * 10) % 2 === 0 ? 0 : 1), 2, 1);
  }
};

// ── the blossom park ────────────────────────────────────────────────────────

/** The canopy, which is the whole point of the place: it is a different tree
 *  in every season, and bare enough in winter to see the sky through. */
const CANOPY: Record<Season, { light: RGB; shade: RGB }> = {
  spring: { light: [244, 186, 208], shade: [212, 138, 172] },
  // Summer's crown has to sit clearly *in front of* a green lawn, so it runs
  // much darker than the ground it stands on rather than merely a different
  // green — at this size, similar values read as one shape.
  summer: { light: [58, 104, 54], shade: [28, 62, 36] },
  autumn: { light: [214, 126, 62], shade: [156, 74, 42] },
  winter: { light: [96, 80, 70], shade: [58, 46, 42] },
};

export const BLOSSOM = {
  lawn: {
    spring: [
      [62, 104, 64],
      [82, 128, 74],
      [104, 152, 88],
    ],
    summer: [
      [56, 98, 60],
      [76, 122, 70],
      [98, 146, 84],
    ],
    autumn: [
      [102, 96, 52],
      [126, 116, 62],
      [152, 140, 76],
    ],
    winter: SNOW_RAMP,
  } as Record<Season, readonly [RGB, RGB, RGB]>,
  blade: [50, 88, 54] as RGB,
  /** Every colour the crown can wear, so the readability check has the set. */
  canopy: Object.values(CANOPY).flatMap((season) => [season.light, season.shade]) as RGB[],
  trunk: [72, 56, 48] as RGB,
  trunkLight: [98, 78, 64] as RGB,
  gravel: [158, 150, 136] as RGB,
  gravelEdge: [124, 118, 106] as RGB,
  bench: [124, 88, 56] as RGB,
  benchDark: [92, 64, 42] as RGB,
  fallen: [222, 158, 186] as RGB,
  sunPatch: [146, 156, 96] as RGB,
  moonPatch: [70, 84, 98] as RGB,
};

/** An avenue of crowns: high at each tree, dipping to the gaps between. */
export const blossomHorizonAt = (sx: number): number => 8 + Math.max(0, 10 - Math.abs(((sx + 12) % 34) - 17));

export const composeBlossom = (key: BackdropKey): Uint8ClampedArray => {
  const { buffer, put } = makeBuffer();
  const worn = (color: RGB): RGB => wear(color, key.condition);
  const winter = key.season === "winter";
  const canopy = CANOPY[key.season];

  paintSky(key, put);

  for (let x = 0; x < ROOM_WIDTH; x++) {
    const top = HORIZON_Y - blossomHorizonAt(x);
    for (let y = top; y < HORIZON_Y; y++) {
      // Bare winter branches let the sky through in the gaps; in leaf the
      // crown is solid, lit along its upper edge.
      if (winter && hash(x * 41 + y * 97) > 0.42) continue;
      put(x, y, worn(y < top + 2 ? canopy.light : canopy.shade));
    }
  }
  // Trunks under the crowns, on the avenue's own beat and standing a little
  // proud of the horizon so the trees are planted rather than floating.
  for (let trunkX = 5; trunkX < ROOM_WIDTH - 3; trunkX += 34) {
    for (let y = HORIZON_Y - 9; y < HORIZON_Y + 3; y++) {
      put(trunkX, y, worn(BLOSSOM.trunkLight));
      put(trunkX + 1, y, worn(BLOSSOM.trunk));
      put(trunkX + 2, y, worn(BLOSSOM.trunk));
    }
  }

  paintGround(key, put, BLOSSOM.lawn, BLOSSOM.blade, winter);

  // The gravel walk, running away to the right of the sampled ground.
  for (let y = HORIZON_Y + 2; y < ROOM_HEIGHT; y++) {
    const depth = (y - HORIZON_Y) / (ROOM_HEIGHT - HORIZON_Y);
    const centre = 150 + depth * 26;
    const half = 4 + depth * 18;
    for (let x = Math.max(0, Math.floor(centre - half)); x < Math.min(ROOM_WIDTH, centre + half); x++) {
      const offset = Math.abs(x - centre) / half;
      if (offset > 1) continue;
      const color = winter ? SNOW_RAMP[1] : offset > 0.74 ? BLOSSOM.gravelEdge : BLOSSOM.gravel;
      if (offset <= 0.74 || threshold(x, y, 3) < 0.55) put(x, y, worn(color));
    }
  }

  // Petals settle on the ground in spring, the way they do everywhere else.
  if (key.season === "spring") {
    for (let index = 0; index < 34; index++) {
      const x = 4 + Math.floor(hash(index * 19) * (ROOM_WIDTH - 8));
      const y = HORIZON_Y + 8 + Math.floor(hash(index * 67) ** 1.4 * (ROOM_HEIGHT - HORIZON_Y - 12));
      put(x, y, worn(BLOSSOM.fallen));
    }
  }

  // A bench under the trees, left of the walk and drawn heavily enough to
  // read as furniture at this size: a solid seat, thick legs, and a back
  // whose slats are separated by ground rather than by a darker brown.
  const bench = { left: 34, right: 96, seat: 150 };
  for (let y = bench.seat; y < bench.seat + 5; y++) {
    for (let x = bench.left; x < bench.right; x++) {
      put(x, y, worn(y === bench.seat ? BLOSSOM.bench : BLOSSOM.benchDark));
    }
  }
  for (const legX of [bench.left + 4, bench.right - 8]) {
    for (let y = bench.seat + 5; y < bench.seat + 17; y++) {
      for (let x = legX; x < legX + 4; x++) put(x, y, worn(BLOSSOM.benchDark));
    }
  }
  for (const railY of [bench.seat - 16, bench.seat - 10]) {
    for (let x = bench.left + 2; x < bench.right - 2; x++) {
      put(x, railY, worn(BLOSSOM.bench));
      put(x, railY + 3, worn(BLOSSOM.benchDark));
    }
  }
  for (const postX of [bench.left + 2, bench.right - 6]) {
    for (let y = bench.seat - 16; y < bench.seat; y++) {
      for (let x = postX; x < postX + 4; x++) put(x, y, worn(BLOSSOM.benchDark));
    }
  }

  paintLight(key, put, BLOSSOM.sunPatch, BLOSSOM.moonPatch);
  return buffer;
};

/** Petals coming down, in spring only (SPEC §22.8). Held still by reduced
 *  motion like every other living touch. */
export const renderBlossomLive = (ctx: SceneContext, nowMs: number, key: BackdropKey): void => {
  if (key.season !== "spring") return;
  ctx.fillStyle = "#f2c2d8";
  for (let index = 0; index < 18; index++) {
    const fall = 9000 + hash(index * 37) * 6000;
    const progress = ((nowMs / fall + hash(index * 71)) % 1 + 1) % 1;
    // Each petal swings on its own phase, so they drift rather than drop.
    const sway = Math.sin(nowMs / 1600 + index * 1.9) * 5;
    const x = Math.round(hash(index * 23) * ROOM_WIDTH + sway);
    const y = Math.round(progress * (ROOM_HEIGHT - 20));
    ctx.fillRect(x, y, 2, 1);
  }
};

// ── the mountain ────────────────────────────────────────────────────────────

export const MOUNTAIN = {
  shore: {
    spring: [
      [84, 88, 78],
      [110, 112, 98],
      [138, 136, 120],
    ],
    summer: [
      [92, 90, 78],
      [118, 114, 98],
      [146, 140, 120],
    ],
    autumn: [
      [86, 74, 58],
      [110, 96, 74],
      [136, 120, 94],
    ],
    winter: SNOW_RAMP,
  } as Record<Season, readonly [RGB, RGB, RGB]>,
  pebble: [66, 64, 58] as RGB,
  lake: [
    [30, 52, 78],
    [42, 72, 100],
    [58, 96, 124],
  ] as readonly [RGB, RGB, RGB],
  lakeIce: [162, 178, 196] as RGB,
  reflectSnow: [96, 118, 142] as RGB,
  reflectRock: [52, 66, 88] as RGB,
  ridgeFar: [96, 114, 140] as RGB,
  ridgeNear: [50, 66, 88] as RGB,
  rock: [78, 74, 88] as RGB,
  rockLight: [102, 98, 112] as RGB,
  snowCap: [238, 242, 250] as RGB,
  snowShade: [206, 214, 232] as RGB,
  sunPatch: [148, 144, 122] as RGB,
  moonPatch: [72, 84, 104] as RGB,
};

const FUJI = { centre: 130, peak: 64, slope: 0.55, summit: 6, snowline: 30 } as const;

// Two ranks of ridges, scalloped rather than stepped: a silhouette built out
// of `Math.floor(x / n) % m` draws rectangular blocks, which read as a wall
// with crenellations instead of hills behind a lake.
const farRidgeAt = (sx: number): number => 12 + Math.floor(Math.abs(((sx + 13) % 46) - 23) / 3);
const nearRidgeAt = (sx: number): number => 6 + Math.floor(Math.abs(((sx + 31) % 34) - 17) / 4);

/** The ridges, and the cone standing well above them. The peak reaches 64 of
 *  the sky's 92 rows — high enough that the sun sets behind the mountain
 *  rather than beside it. */
export const mountainHorizonAt = (sx: number): number => {
  const fromCentre = Math.abs(sx - FUJI.centre);
  // A summit that is flat and a little wide, which is what stops the cone
  // reading as a triangle.
  const cone = FUJI.peak - Math.max(0, fromCentre - FUJI.summit) * FUJI.slope;
  return Math.max(farRidgeAt(sx), Math.round(cone));
};

/** Where the near shore takes over from the lake. */
const LAKE_BOTTOM = HORIZON_Y + 34;

export const composeMountain = (key: BackdropKey): Uint8ClampedArray => {
  const { buffer, put } = makeBuffer();
  const worn = (color: RGB): RGB => wear(color, key.condition);
  const winter = key.season === "winter";

  paintSky(key, put);

  // The cone first, then the ridges in front of it: the near range overlaps
  // the mountain's foot, which is what puts it *behind* them rather than
  // standing on the same line.
  const snowline = winter ? 40 : FUJI.snowline;
  for (let x = 0; x < ROOM_WIDTH; x++) {
    const cone = mountainHorizonAt(x);
    // Snow lies lower in some gullies than others, so the line wanders by
    // column before it is dithered. A snowline that is only dithered is
    // still a ruled line — it just has a checkered edge.
    const wander = hash(x * 7) * 6 - 3;
    for (let y = HORIZON_Y - cone; y < HORIZON_Y; y++) {
      const capped = HORIZON_Y - y > snowline + wander - threshold(x, y, 1) * 5;
      // The sunward face, handed over across a dithered band rather than a
      // hard seam down the middle of the cone.
      const lit = (FUJI.centre + 7 - x) / 14 > threshold(x, y, 3);
      if (capped) put(x, y, worn(lit ? MOUNTAIN.snowCap : MOUNTAIN.snowShade));
      else put(x, y, worn(lit ? MOUNTAIN.rockLight : MOUNTAIN.rock));
    }
  }
  for (let x = 0; x < ROOM_WIDTH; x++) {
    for (let y = HORIZON_Y - farRidgeAt(x); y < HORIZON_Y; y++) put(x, y, worn(MOUNTAIN.ridgeFar));
    for (let y = HORIZON_Y - nearRidgeAt(x); y < HORIZON_Y; y++) put(x, y, worn(MOUNTAIN.ridgeNear));
  }

  paintGround(key, put, MOUNTAIN.shore, MOUNTAIN.pebble, winter);

  // The lake, and the mountain lying upside down in it.
  const water = MOUNTAIN.lake.map(worn);
  for (let y = HORIZON_Y; y < LAKE_BOTTOM; y++) {
    const t = (y - HORIZON_Y) / (LAKE_BOTTOM - HORIZON_Y);
    for (let x = 0; x < ROOM_WIDTH; x++) {
      let color = winter ? worn(MOUNTAIN.lakeIce) : pickRamp(water, t, x, y);
      // The mountain lying upside down in the water. The lake is shallower
      // than the mountain is tall, so the image is squashed two-to-one:
      // `mirrored` is the height up the cone that this row is showing.
      const depth = y - HORIZON_Y;
      const mirrored = depth * 2;
      if (!winter && mirrored < mountainHorizonAt(x)) {
        // Broken into bands and fading with distance from the shoreline, the
        // way a reflection on water that is moving at all actually behaves.
        const settled = depth % 5 !== 4 && threshold(x, y, 2) > depth / 26;
        if (settled) color = worn(mirrored > snowline ? MOUNTAIN.reflectSnow : MOUNTAIN.reflectRock);
      }
      put(x, y, color);
    }
  }

  paintLight(key, put, MOUNTAIN.sunPatch, MOUNTAIN.moonPatch);
  return buffer;
};
