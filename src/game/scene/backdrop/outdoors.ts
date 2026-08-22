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
 * depth, with sparse two-pixel blade runs so the grass has grain without
 * noise. Winter swaps the whole ramp for snow.
 */
const paintGround = (
  key: BackdropKey,
  put: Put,
  grass: Record<Season, readonly [RGB, RGB, RGB]>,
  blade: RGB,
): void => {
  const worn = (color: RGB): RGB => wear(color, key.condition);
  const winter = key.season === "winter";
  const ramp = (winter ? SNOW_RAMP : grass[key.season]).map(worn);
  for (let y = HORIZON_Y; y < ROOM_HEIGHT; y++) {
    const depth = (y - HORIZON_Y) / (ROOM_HEIGHT - HORIZON_Y);
    for (let x = 0; x < ROOM_WIDTH; x++) {
      let color = pickRamp(ramp, depth, x, y);
      // Blade runs, denser up close; snow keeps an unbroken crust.
      if (!winter && hash(x * 131 + y * 517) < 0.05 + depth * 0.06 && hash(x * 37 + y * 91) < 0.5) {
        color = worn(blade);
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

  paintGround(key, put, GARDEN.grass, GARDEN.blade);

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

  paintGround(key, put, MEADOW.grass, MEADOW.blade);

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
