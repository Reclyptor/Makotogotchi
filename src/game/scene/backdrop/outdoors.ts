// The outdoor venues (SPEC §22.8), composed a pixel at a time with the same
// discipline as the room (§22.6): every colour is a named venue ramp, every
// gradient an ordered dither between adjacent ramp values, and the sky is
// the very machinery the window shows — drawn full-bleed, because out here
// there is no pane between the pet and the weather.
//
// **Every venue sets its own horizon, and that is the point.** A shared
// horizon with a shared recipe — sky, a ten-pixel silhouette strip, one flat
// plane of ground — produces places that differ only in tint, and at this
// resolution a tint is not a place. So the forest is roofed and hemmed in,
// the meadow is almost entirely sky, the pond is almost entirely water, and
// the shrine's gate is big enough to stand under. What distinguishes them is
// composition: where the eye line sits, what breaks it, and how much of the
// frame each element is allowed to take.

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
import { bands, castShadow, haze, pebble, ramp, roots, scatter, shadowStrip, solid, tuft, type Ramp } from "./paint";
import type { SceneContext } from "../../engine/digest";

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

/** What ground cover looks like once snow has taken it: one declared ramp
 *  every venue reuses, rather than each deriving its own mid-render. */
export const WINTER_COVER = ramp(SNOW_RAMP[1], 0.8);

type Put = (x: number, y: number, color: RGB) => void;

/** The full-bleed sky, with the same segment dissolve the window carries. */
const paintSky = (key: BackdropKey, put: Put, horizonY: number): void => {
  const current = skyRamp(key.segment, key.weather, key.season);
  const next = skyRamp(key.next, key.weather, key.season);
  for (let y = 0; y < horizonY; y++) {
    const t = y / Math.max(1, horizonY - 1);
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
 * Light on the ground, arriving from the sky rather than from a spotlight.
 *
 * The previous version laid two big soft cones on every venue, at the same
 * two positions, which read as torch beams on carpet and was the single
 * most damaging thing in the scenes. Light outdoors comes from above and
 * behind: it lands hardest near the horizon and falls away toward the
 * viewer, so that is what this is — a dithered wash keyed to the sun's
 * height, in a colour the venue declares.
 */
const skyLight = (key: BackdropKey, put: Put, warm: RGB, cool: RGB, horizonY: number, to = ROOM_HEIGHT): void => {
  const dark = isDark(key.segment);
  // Kept low on purpose. At two thirds coverage this stopped being light on
  // the ground and became a pale film over it — the shelf, the lawn and the
  // sand all washed out to the same cream near the horizon whatever colour
  // they had been mixed to.
  const strength = dark ? 0.13 : 0.07 + (key.sunStep / 8) * 0.2;
  const color = wear(dark ? cool : warm, key.condition);
  const span = Math.max(1, to - horizonY);
  for (let y = horizonY; y < to; y++) {
    const fall = 1 - (y - horizonY) / span;
    const here = strength * fall * fall;
    for (let x = 0; x < ROOM_WIDTH; x++) {
      // A slow lateral swell so the wash is not a flat horizontal ribbon.
      const swell = 0.85 + 0.3 * Math.sin(x / 47 + horizonY);
      if (here * swell > threshold(x, y, 2)) put(x, y, color);
    }
  }
};

const makeBuffer = (): { buffer: Uint8ClampedArray; put: Put } => {
  const buffer = new Uint8ClampedArray(ROOM_WIDTH * ROOM_HEIGHT * 4);
  const put: Put = (x, y, color) => {
    if (x < 0 || x >= ROOM_WIDTH || y < 0 || y >= ROOM_HEIGHT) return;
    const i = (y * ROOM_WIDTH + x) * 4;
    buffer[i] = color[0];
    buffer[i + 1] = color[1];
    buffer[i + 2] = color[2];
    buffer[i + 3] = 255;
  };
  return { buffer, put };
};

/** A filled column run, the shape most venue furniture is made of. */
const column = (put: Put, x: number, from: number, to: number, color: RGB): void => {
  for (let y = from; y < to; y++) put(x, y, color);
};

// ── the backyard garden ─────────────────────────────────────────────────────
// Enclosed. A tall board fence runs the whole width and takes the upper third,
// so there is barely any sky — a yard, not a landscape.

export const GARDEN_HORIZON = 78;

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
  blade: ramp([52, 96, 56], 0.8),
  fence: ramp([128, 96, 60]),
  post: ramp([98, 72, 44]),
  shed: ramp([104, 80, 64]),
  shedRoof: ramp([72, 56, 46]),
  soil: ramp([92, 64, 46]),
  board: ramp([138, 106, 68]),
  leaf: ramp([58, 116, 62]),
  fruit: ramp([190, 92, 56]),
  bloomPink: ramp([220, 132, 164]),
  bloomGold: ramp([230, 190, 98]),
  stone: ramp([140, 136, 126]),
  shadow: [56, 66, 52] as RGB,
  sun: [128, 150, 84] as RGB,
  moon: [64, 84, 96] as RGB,
};

/** Boards to the top of the frame, with posts standing proud of them. */
export const gardenHorizonAt = (sx: number): number => (sx % 21 < 4 ? 62 : 54);

export const composeGarden = (key: BackdropKey): Uint8ClampedArray => {
  const { buffer, put } = makeBuffer();
  const worn = (color: RGB): RGB => wear(color, key.condition);
  const winter = key.season === "winter";
  const tone = (r: Ramp): Ramp => ({ light: worn(r.light), mid: worn(r.mid), shade: worn(r.shade) });

  paintSky(key, put, GARDEN_HORIZON);

  // The fence: boards with their own grain, posts standing proud, and two
  // rails crossing them so it reads as carpentry rather than as a wall.
  const boards = tone(GARDEN.fence);
  const posts = tone(GARDEN.post);
  for (let x = 0; x < ROOM_WIDTH; x++) {
    const post = x % 21 < 4;
    const top = GARDEN_HORIZON - gardenHorizonAt(x);
    for (let y = top; y < GARDEN_HORIZON; y++) {
      const grain = hash(x * 131 + Math.floor(y / 5) * 17) < 0.18;
      const face = post ? posts : boards;
      const seam = x % 7 === 0 || x % 7 === 6;
      put(x, y, y < top + 2 ? face.light : seam ? face.shade : grain ? face.shade : face.mid);
    }
    if (post) put(x, top - 1, posts.light);
  }
  for (const railY of [GARDEN_HORIZON - 42, GARDEN_HORIZON - 17]) {
    for (let x = 0; x < ROOM_WIDTH; x++) {
      put(x, railY, boards.light);
      put(x, railY + 1, boards.mid);
      put(x, railY + 2, boards.shade);
    }
  }

  // A shed in the right corner, breaking the fence line.
  const shed = { left: 184, right: 246, eaves: GARDEN_HORIZON - 60 };
  const walls = tone(GARDEN.shed);
  const roof = tone(GARDEN.shedRoof);
  for (let x = shed.left; x < shed.right; x++) {
    const ridge = shed.eaves + Math.floor(Math.abs(x - (shed.left + shed.right) / 2) / 2.6);
    for (let y = ridge; y < ridge + 6; y++) put(x, y, y < ridge + 2 ? roof.light : roof.mid);
    put(x, ridge + 6, roof.shade);
    for (let y = ridge + 7; y < GARDEN_HORIZON; y++) {
      const plank = x % 6 === 0;
      put(x, y, x < shed.left + 3 ? walls.light : x > shed.right - 4 ? walls.shade : plank ? walls.shade : walls.mid);
    }
  }
  solid(put, { x: shed.left + 22, y: GARDEN_HORIZON - 32, w: 16, h: 32 }, tone(GARDEN.post));

  // Lawn as flat regions, so the beds and the planting read against it.
  const grass = GARDEN.grass[key.season];
  bands(
    put,
    GARDEN_HORIZON,
    ROOM_HEIGHT,
    [
      { until: GARDEN_HORIZON + 22, color: worn(grass[2]) },
      { until: GARDEN_HORIZON + 58, color: worn(grass[1]) },
      { until: ROOM_HEIGHT, color: worn(grass[0]) },
    ],
    12,
  );
  const blade = winter ? tone(WINTER_COVER) : tone(GARDEN.blade);
  scatter(GARDEN_HORIZON + 2, ROOM_HEIGHT - 2, 120, 0x9a2d, (x, y, depth, index) => {
    tuft(put, x, y, 2 + Math.round(depth * 4), blade, index + Math.round(x / 6));
  });

  // Raised beds: boarded sides catching the light, turned soil inside, and
  // each one throwing a shadow so it stands on the lawn instead of on top
  // of it.
  const soil = tone(GARDEN.soil);
  const board = tone(GARDEN.board);
  for (let bed = 0; bed < 3; bed++) {
    const top = 112 + bed * 28;
    const inset = 30 - bed * 11;
    const height = 17 - bed * 2;
    const right = ROOM_WIDTH - inset - 56;
    shadowStrip(put, inset, top + height, right - inset, 4, worn(GARDEN.shadow));
    for (let y = top; y < top + height; y++) {
      for (let x = inset; x < right; x++) {
        put(x, y, hash(x * 53 + y * 29) < 0.22 ? soil.shade : soil.mid);
      }
    }
    for (let x = inset; x < right; x++) {
      put(x, top, board.light);
      put(x, top + 1, board.mid);
      put(x, top + height - 2, board.mid);
      put(x, top + height - 1, board.shade);
    }
    for (let y = top; y < top + height; y++) {
      put(inset, y, board.light);
      put(right - 1, y, board.shade);
    }
    if (winter) continue;
    const rows = 3 - bed;
    for (let index = 0; index < 12 - bed * 3; index++) {
      const x = inset + 4 + Math.floor(hash(index * 47 + bed * 13) * (right - inset - 8));
      const y = top + 4 + ((index % rows) * (height - 6)) / rows;
      const which = index % 3;
      const crop = which === 0 ? tone(GARDEN.leaf) : which === 1 ? tone(GARDEN.bloomPink) : tone(GARDEN.bloomGold);
      tuft(put, x, Math.round(y), 3 + (index % 2), crop, index);
      if (key.season === "autumn" && index % 4 === 0) {
        const fruit = tone(GARDEN.fruit);
        put(x, Math.round(y) - 3, fruit.light);
        put(x + 1, Math.round(y) - 3, fruit.mid);
        put(x, Math.round(y) - 2, fruit.shade);
      }
    }
  }

  scatter(GARDEN_HORIZON + 20, ROOM_HEIGHT - 6, 7, 0x570e, (x, y, depth) => {
    pebble(put, x, y, 2 + Math.round(depth * 2), tone(GARDEN.stone), worn(GARDEN.shadow));
  });


    // A robin on the rail and a watering can left out by the beds. Small
  // signs that somebody keeps this garden are what stop it reading as a
  // diagram of one.
  const railY = GARDEN_HORIZON - 42;
  const bird = tone(GARDEN.post);
  const breast = tone(GARDEN.fruit);
  for (let dy = 0; dy < 6; dy++) {
    for (let dx = 0; dx < 5; dx++) {
      if (dy === 0 && (dx === 0 || dx > 3)) continue;
      put(150 + dx, railY - 7 + dy, dy < 2 ? bird.mid : bird.shade);
    }
  }
  put(150, railY - 3, breast.mid);
  put(151, railY - 3, breast.light);
  put(150, railY - 2, breast.mid);
  put(155, railY - 5, bird.shade);
  put(156, railY - 5, bird.shade);
  put(149, railY - 6, bird.light);

  const can = tone(GARDEN.stone);
  shadowStrip(put, 202, 188, 22, 3, worn(GARDEN.shadow));
  solid(put, { x: 204, y: 172, w: 18, h: 16 }, can);
  for (let dx = 0; dx < 10; dx++) {
    put(222 + dx, 175 + Math.round(dx * 0.6), can.mid);
    put(222 + dx, 176 + Math.round(dx * 0.6), can.shade);
  }
  for (let dy = 0; dy < 8; dy++) put(201, 166 + dy, can.light);
  for (let dx = 0; dx < 9; dx++) put(201 + dx, 166, can.light);

  skyLight(key, put, GARDEN.sun, GARDEN.moon, GARDEN_HORIZON);
  return buffer;
};

// ── the wildflower meadow ───────────────────────────────────────────────────
// The opposite of the garden: the horizon drops almost to the pet's feet and
// the sky takes two thirds of the frame. Tall stems rise from the bottom edge
// so the eye reads depth rather than a flat green band.

export const MEADOW_HORIZON = 126;

export const MEADOW = {
  grass: {
    spring: [
      [78, 128, 74],
      [102, 152, 84],
      [130, 176, 98],
    ],
    summer: [
      [96, 138, 70],
      [124, 162, 82],
      [156, 186, 100],
    ],
    autumn: [
      [130, 128, 62],
      [158, 150, 74],
      [186, 174, 92],
    ],
    winter: SNOW_RAMP,
  } as Record<Season, readonly [RGB, RGB, RGB]>,
  treeline: [64, 92, 84] as RGB,
  stalk: [58, 104, 58] as RGB,
  // Declared ramps, not ones derived mid-render: every colour paintable
  // below the horizon has to be enumerable (SPEC §22.6).
  blade: ramp([70, 118, 66], 0.8),
  track: ramp([150, 126, 92]),
  stone: ramp([138, 136, 128]),
  poppy: ramp([206, 84, 70]),
  daisy: ramp([242, 238, 226]),
  violet: ramp([154, 112, 186]),
  shadow: [58, 84, 62] as RGB,
  sun: [178, 192, 116] as RGB,
  moon: [78, 98, 108] as RGB,
};

/** A distant treeline, low and hazy — the far edge of a very wide field. */
export const meadowHorizonAt = (sx: number): number => 4 + Math.floor(Math.abs(((sx + 7) % 34) - 17) / 5);

export const composeMeadow = (key: BackdropKey): Uint8ClampedArray => {
  const { buffer, put } = makeBuffer();
  const worn = (color: RGB): RGB => wear(color, key.condition);
  const winter = key.season === "winter";
  const sky = skyRamp(key.segment, key.weather, key.season);
  const far = sky[sky.length - 1]!;

  paintSky(key, put, MEADOW_HORIZON);

  // Birds, because an enormous empty sky needs something in it.
  if (!isDark(key.segment)) {
    for (const [bx, by, span] of [[64, 26, 3], [72, 31, 2], [186, 20, 3], [196, 27, 2], [204, 18, 2]] as const) {
      const ink = worn(haze(MEADOW.treeline, far, 0.35));
      for (let i = 0; i < span; i++) {
        put(bx - i, by + i, ink);
        put(bx + i, by + i, ink);
      }
    }
  }

  // Three ranks of land receding, each hazed further toward the sky. This
  // is the depth cue a flat field has no other way to get.
  const rankTone = (base: RGB, amount: number): Ramp => ramp(haze(base, far, amount), 0.7);
  for (let x = 0; x < ROOM_WIDTH; x++) {
    // Two ridges of hills, each a rolling profile rather than a ruled slab,
    // and each fading into the sky at its own rate. A single flat band of
    // hazed colour reads as a painted stripe across the horizon.
    const crest = MEADOW_HORIZON - 30 + Math.round(Math.abs(((x + 40) % 168) - 84) / 6);
    for (let y = crest; y < MEADOW_HORIZON - 12; y++) {
      // Fading upward into haze rather than stopping on an edge.
      const intoSky = (y - crest) / Math.max(1, MEADOW_HORIZON - 12 - crest);
      if (intoSky < 0.28 && threshold(x, y, 1) > 0.35 + intoSky) continue;
      put(x, y, worn(haze(MEADOW.treeline, far, 0.58 - intoSky * 0.14)));
    }
    const nearer = MEADOW_HORIZON - 16 + Math.round(Math.abs(((x + 11) % 74) - 37) / 9);
    for (let y = nearer; y < MEADOW_HORIZON; y++) put(x, y, worn(haze(MEADOW.treeline, far, 0.34)));
  }
  // A hedgerow of individual crowns rather than one continuous strip.
  scatter(MEADOW_HORIZON - 8, MEADOW_HORIZON - 4, 26, 0x5eed, (x, y, depth, index) => {
    const crown = rankTone(MEADOW.treeline, 0.22);
    const size = 4 + Math.round(hash(index * 71) * 4);
    for (let dy = 0; dy < size; dy++) {
      const half = Math.round(size * Math.sin(((dy + 0.5) / size) * Math.PI) * 0.9);
      for (let dx = -half; dx <= half; dx++) {
        put(x + dx, y - dy, dy > size - 2 && dx < 0 ? crown.light : dx > half - 2 ? crown.shade : crown.mid);
      }
    }
    void depth;
  });

  // The field itself: flat regions, seams dithered, so there is somewhere
  // for the eye to rest and the detail below can read.
  const field = MEADOW.grass[key.season];
  bands(
    put,
    MEADOW_HORIZON,
    ROOM_HEIGHT,
    [
      { until: MEADOW_HORIZON + 18, color: worn(field[2]) },
      { until: MEADOW_HORIZON + 44, color: worn(field[1]) },
      { until: ROOM_HEIGHT, color: worn(field[0]) },
    ],
    12,
  );

  // A track worn through the grass, curving rather than ruled, with the
  // earth showing through and a lit lip on its near side.
  if (!winter) {
    const soil = MEADOW.track;
    for (let y = MEADOW_HORIZON + 4; y < ROOM_HEIGHT; y++) {
      const t = (y - MEADOW_HORIZON) / (ROOM_HEIGHT - MEADOW_HORIZON);
      const centre = 176 - t * 34 + Math.sin(t * 3.1) * 10;
      const half = 1 + t * t * 13;
      for (let x = Math.round(centre - half); x <= Math.round(centre + half); x++) {
        const edge = Math.abs(x - centre) / half;
        if (edge > 1) continue;
        put(x, y, worn(edge > 0.82 ? soil.light : edge > 0.6 ? soil.mid : soil.shade));
      }
    }
  }

  // Ground cover in clumps, larger and denser toward the viewer.
  const blade = winter ? WINTER_COVER : MEADOW.blade;
  scatter(MEADOW_HORIZON + 2, ROOM_HEIGHT - 2, 210, 0x67a55, (x, y, depth, index) => {
    const tone = { light: worn(blade.light), mid: worn(blade.mid), shade: worn(blade.shade) };
    tuft(put, x, y, 2 + Math.round(depth * 5), tone, index + Math.round(x / 7));
  });

  if (!winter) {
    const heads: Ramp[] = [MEADOW.poppy, MEADOW.daisy, MEADOW.violet];
    scatter(MEADOW_HORIZON + 8, ROOM_HEIGHT - 4, 46, 0xb1004, (x, y, depth, index) => {
      const stem = 3 + Math.round(depth * 9);
      const tone = heads[index % heads.length]!;
      column(put, x, y - stem, y, worn(MEADOW.stalk));
      // A head of two to five pixels, never one — a lone pixel is a fault.
      const wide = depth > 0.55 ? 2 : 1;
      for (let dx = -wide; dx <= wide; dx++) {
        put(x + dx, y - stem, worn(dx < 0 ? tone.light : dx > 0 ? tone.shade : tone.mid));
      }
      if (depth > 0.7) put(x, y - stem - 1, worn(tone.light));
    });
  }

  // Stones sitting in the grass, each on its own shadow.
  scatter(MEADOW_HORIZON + 14, ROOM_HEIGHT - 6, 9, 0x57003, (x, y, depth) => {
    pebble(put, x, y, 2 + Math.round(depth * 3), MEADOW.stone, worn(MEADOW.shadow));
  });


  skyLight(key, put, MEADOW.sun, MEADOW.moon, MEADOW_HORIZON);
  return buffer;
};


// ── the cove ────────────────────────────────────────────────────────────────
// Not an empty shoreline seen head-on — two horizontal bands of blue and tan
// have nothing in them to look at. This is a rocky cove: an islet with a
// wind-bent pine breaking the sea horizon, and a wet rock shelf with tide
// pools where the sand used to be. Vertical interest, a focal point, and a
// foreground with things living in it.

export const BEACH_HORIZON = 120;

/** Where the water begins — well above the shore, so the sea is a real band. */
const SEA_TOP = 62;

export const BEACH = {
  shelf: {
    spring: [
      [54, 58, 64],
      [70, 74, 78],
      [88, 90, 94],
    ],
    summer: [
      [58, 60, 64],
      [74, 76, 80],
      [94, 94, 96],
    ],
    autumn: [
      [52, 50, 52],
      [66, 64, 64],
      [84, 80, 80],
    ],
    // The rock does not vanish under snow; it glazes over with ice.
    winter: [
      [138, 148, 162],
      [166, 176, 188],
      [196, 204, 214],
    ],
  } as Record<Season, readonly [RGB, RGB, RGB]>,
  sea: [
    [16, 44, 72],
    [24, 68, 100],
    [38, 96, 126],
  ] as readonly [RGB, RGB, RGB],
  swell: [92, 146, 168] as RGB,
  foam: [236, 244, 246] as RGB,
  headland: [58, 74, 92] as RGB,
  rock: ramp([74, 70, 72]),
  rockWet: ramp([52, 52, 58]),
  pool: ramp([104, 156, 176]),
  weed: ramp([64, 78, 46], 0.9),
  weedRust: ramp([112, 74, 44], 0.9),
  barnacle: ramp([206, 200, 188]),
  shell: ramp([232, 214, 194]),
  star: ramp([214, 110, 88]),
  pine: ramp([38, 68, 52]),
  pineTrunk: ramp([70, 52, 42]),
  boat: ramp([146, 122, 96]),
  boatTrim: ramp([92, 74, 58]),
  rope: ramp([172, 156, 122]),
  gull: [246, 248, 250] as RGB,
  shadow: [62, 64, 72] as RGB,
  sun: [150, 156, 156] as RGB,
  moon: [76, 90, 110] as RGB,
};

/** The islet: the thing the whole cove is arranged around. */
const ISLET = { x: 198, halfW: 25, top: 50 } as const;

/**
 * A sea stack, not a cone. Sea rock erodes into near-vertical flanks under
 * a broad top, with a notch where a weaker bed has gone: a smooth curve
 * from base to apex reads as a sand pile or, worse, a rocket nose.
 */
const isletAt = (sx: number): number => {
  const offset = sx - ISLET.x;
  const from = Math.abs(offset);
  if (from >= ISLET.halfW) return 0;
  const shoulder = ISLET.halfW * 0.4;
  const flank = Math.max(0, from - shoulder) / (ISLET.halfW - shoulder);
  // Jitter along the whole profile: a clean flat top over straight flanks
  // is a chimney, and no amount of texture inside it fixes the silhouette.
  const jag = (hash(Math.floor(sx / 2) * 733) - 0.5) * 0.17;
  const notch = offset > 2 && offset < 9 ? 0.19 : 0;
  return Math.round((BEACH_HORIZON - ISLET.top) * Math.max(0, 1 - flank ** 1.9 + jag - notch));
};

/** The far headland along the water horizon, and the islet standing over it. */
export const beachHorizonAt = (sx: number): number =>
  Math.max(BEACH_HORIZON - SEA_TOP + (Math.floor(sx / 31) % 2) * 2, isletAt(sx));

export const composeBeach = (key: BackdropKey): Uint8ClampedArray => {
  const { buffer, put } = makeBuffer();
  const worn = (color: RGB): RGB => wear(color, key.condition);
  const tone = (r: Ramp): Ramp => ({ light: worn(r.light), mid: worn(r.mid), shade: worn(r.shade) });
  const winter = key.season === "winter";
  const sky = skyRamp(key.segment, key.weather, key.season);
  const far = sky[sky.length - 1]!;

  paintSky(key, put, BEACH_HORIZON);

  // Gulls over the water, because an empty sky is an empty scene.
  if (!isDark(key.segment)) {
    for (const [gx, gy, span] of [[54, 30, 3], [66, 37, 2], [214, 22, 2], [98, 20, 2]] as const) {
      const ink = worn(haze(BEACH.headland, far, 0.3));
      for (let i = 0; i < span; i++) {
        put(gx - i, gy + i, ink);
        put(gx + i, gy + i, ink);
      }
    }
  }

  // Headland closing the far side of the bay.
  for (let x = 0; x < ROOM_WIDTH; x++) {
    const lift = Math.round(Math.max(0, 26 - Math.abs(x - 18) / 2.4));
    for (let y = SEA_TOP - lift; y < SEA_TOP; y++) put(x, y, worn(haze(BEACH.headland, far, 0.42)));
  }

  // The sea: flat bands with a dithered seam, swell lines running across it.
  bands(
    put,
    SEA_TOP,
    BEACH_HORIZON,
    [
      { until: SEA_TOP + 16, color: worn(BEACH.sea[0]) },
      { until: SEA_TOP + 38, color: worn(BEACH.sea[1]) },
      { until: BEACH_HORIZON, color: worn(BEACH.sea[2]) },
    ],
    9,
  );
  for (let y = SEA_TOP + 3; y < BEACH_HORIZON; y += 4 + Math.floor(hash(y * 37) * 4)) {
    for (let x = 0; x < ROOM_WIDTH; x++) {
      if (hash(Math.floor(x / 5) * 419 + y * 11) > 0.17) continue;
      const run = 3 + Math.floor(hash(x * 23 + y) * 6);
      for (let dx = 0; dx < run; dx++) put(x + dx, y, worn(BEACH.swell));
    }
  }

  // The islet, and the pine that has been leaning off it for a century.
  const stack = tone(BEACH.rock);
  for (let x = 0; x < ROOM_WIDTH; x++) {
    const rise = isletAt(x);
    if (rise <= 0) continue;
    const crest = BEACH_HORIZON - rise;
    for (let y = crest; y < BEACH_HORIZON; y++) {
      const down = (y - crest) / Math.max(1, rise);
      // Bedding planes, tilted and unevenly spaced. Level courses at a
      // fixed pitch are brickwork; rock is bedded at an angle and some
      // beds are thicker than others.
      const tilt = Math.round((x - ISLET.x) * 0.3);
      const band = Math.floor((y + tilt) / 6);
      const strata = (y + tilt) % 6 === 0 && hash(band * 331) < 0.5;
      const lit = x < ISLET.x - 3;
      const value = down < 0.06 ? stack.light : strata ? stack.shade : lit ? stack.mid : stack.shade;
      put(x, y, value);
    }
  }
  // The pine: a black pine leans off the rock in flat, layered cushions of
  // needles carried on a crooked trunk. Radiating fronds would be a palm,
  // which is the wrong sea entirely.
  const needle = tone(BEACH.pine);
  const pineTrunk = tone(BEACH.pineTrunk);
  const rootY = BEACH_HORIZON - isletAt(ISLET.x);
  const bend = (step: number): number => ISLET.x + 2 - Math.round((step / 26) ** 1.8 * 22);
  for (let step = 0; step < 26; step++) {
    const x = bend(step);
    put(x, rootY - step, pineTrunk.light);
    put(x + 1, rootY - step, pineTrunk.mid);
    put(x + 2, rootY - step, pineTrunk.shade);
  }
  // Two limbs off the trunk, each carrying its own cushion.
  for (const [atStep, reach] of [[12, -11], [19, 9]] as const) {
    const from = bend(atStep);
    for (let step = 0; step <= Math.abs(reach); step++) {
      const x = from + Math.sign(reach) * step;
      put(x, rootY - atStep - Math.round(step * 0.35), pineTrunk.mid);
    }
  }
  const cushion = (cx: number, cy: number, halfW: number): void => {
    for (let dy = 0; dy < 4; dy++) {
      const span = Math.round(halfW * (dy === 0 ? 0.6 : dy === 3 ? 0.75 : 1));
      for (let dx = -span; dx <= span; dx++) {
        if (dy === 3 && hash((cx + dx) * 31) < 0.45) continue;
        put(cx + dx, cy + dy, dy === 0 ? needle.light : dy < 3 ? needle.mid : needle.shade);
      }
    }
  };
  cushion(bend(26) + 1, rootY - 30, 13);
  cushion(bend(12) - 11, rootY - 17, 9);
  cushion(bend(19) + 9, rootY - 24, 7);

  // Surf collaring the islet, and breaking along the shelf.
  for (let x = 0; x < ROOM_WIDTH; x++) {
    const rise = isletAt(x);
    if (rise > 0 && threshold(x, BEACH_HORIZON, 3) < 0.75) {
      put(x, BEACH_HORIZON - 1, worn(BEACH.foam));
      put(x, BEACH_HORIZON - 2, worn(BEACH.foam));
    }
  }

  // The shelf: wet rock, flat regions, seams dithered.
  const shelf = BEACH.shelf[key.season];
  bands(
    put,
    BEACH_HORIZON,
    ROOM_HEIGHT,
    [
      { until: BEACH_HORIZON + 20, color: worn(shelf[0]) },
      { until: BEACH_HORIZON + 50, color: worn(shelf[1]) },
      { until: ROOM_HEIGHT, color: worn(shelf[2]) },
    ],
    6,
  );
  // Fissures running back through the rock, so the shelf is bedded and not
  // a plane of colour.
  const wet = tone(BEACH.rockWet);
  for (let index = 0; index < 3; index++) {
    let x = 30 + Math.floor(hash(index * 613) * (ROOM_WIDTH - 60));
    const from = BEACH_HORIZON + 26 + Math.floor(hash(index * 97) * 30);
    for (let y = from; y < ROOM_HEIGHT; y++) {
      x += Math.round(hash(x * 17 + y * 7) * 2) - 1;
      put(x, y, wet.shade);
      if (hash(x * 5 + y) < 0.3) put(x + 1, y, wet.mid);
    }
  }

  // Tide pools: still water holding the sky, each with a wet rim.
  const pool = tone(BEACH.pool);
  for (const [px, py, halfW, halfH] of [
    [64, 150, 26, 9],
    [196, 172, 22, 8],
    [122, 190, 18, 6],
    [236, 138, 14, 5],
  ] as const) {
    for (let dy = -halfH; dy <= halfH; dy++) {
      const span = Math.round(halfW * Math.sqrt(Math.max(0, 1 - (dy / (halfH + 0.5)) ** 2)));
      for (let dx = -span; dx <= span; dx++) {
        const rim = dx > span - 2 || dx < -span + 1 || dy === -halfH || dy === halfH;
        // The near rim is lit, the far rim is in shadow, and the water
        // itself carries a lighter band where it catches the sky.
        put(px + dx, py + dy, rim ? (dy > 0 ? wet.light : wet.shade) : dy < -halfH + 3 ? pool.light : pool.mid);
      }
    }
    // Weed trailing out of the pool.
    for (let index = 0; index < 5; index++) {
      const wx = px - halfW + Math.floor(hash(index * 71 + px) * halfW * 2);
      tuft(put, wx, py + halfH, 3 + Math.floor(hash(index * 13 + px) * 3), tone(BEACH.weed), index + px);
    }
  }

  // Life on the rock: weed, barnacle crusts, shells and a starfish.
  const weed = winter ? tone(WINTER_COVER) : tone(BEACH.weed);
  const rust = tone(BEACH.weedRust);
  scatter(BEACH_HORIZON + 2, ROOM_HEIGHT - 2, 90, 0x5ea3, (x, y, depth, index) => {
    tuft(put, x, y, 2 + Math.round(depth * 5), index % 4 === 0 ? rust : weed, index + x);
  });
  scatter(BEACH_HORIZON + 4, ROOM_HEIGHT - 4, 30, 0xba27, (x, y, depth, index) => {
    const crust = tone(BEACH.barnacle);
    const wide = 1 + Math.round(depth * 3);
    for (let dx = -wide; dx <= wide; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        if (hash((x + dx) * 41 + (y + dy) * 13 + index) < 0.42) continue;
        put(x + dx, y + dy, dy < 0 ? crust.light : crust.mid);
      }
    }
  });
  scatter(BEACH_HORIZON + 8, ROOM_HEIGHT - 4, 18, 0x5e11, (x, y, depth) => {
    const shell = tone(BEACH.shell);
    const wide = 1 + Math.round(depth * 1.6);
    for (let dx = -wide; dx <= wide; dx++) put(x + dx, y, dx < 0 ? shell.light : shell.shade);
    put(x, y - 1, shell.mid);
  });
  const star = tone(BEACH.star);
  for (const [sx, sy] of [[152, 166], [88, 186]] as const) {
    for (const [ax, ay] of [[0, -3], [-3, 1], [3, 1], [-2, 3], [2, 3]] as const) {
      put(sx + ax, sy + ay, star.light);
      put(sx + Math.round(ax / 2), sy + Math.round(ay / 2), star.mid);
    }
    put(sx, sy, star.shade);
  }

  // A boat hauled up out of the water, with its rope coiled beside it.
  const hull = tone(BEACH.boat);
  const trim = tone(BEACH.boatTrim);
  shadowStrip(put, 24, 178, 56, 4, worn(BEACH.shadow));
  for (let dx = -28; dx <= 28; dx++) {
    const sheer = Math.round((dx / 28) ** 2 * 7);
    const top = 164 + sheer;
    for (let y = top; y < 180 - Math.round((dx / 28) ** 2 * 4); y++) {
      const plank = (y - top) % 4 === 0;
      put(52 + dx, y, y < top + 2 ? trim.light : plank ? hull.shade : hull.mid);
    }
  }
  for (let dx = -20; dx <= 20; dx += 13) solid(put, { x: 52 + dx - 8, y: 166, w: 16, h: 3 }, trim);
  const rope = tone(BEACH.rope);
  for (let index = 0; index < 22; index++) {
    const angle = (index / 22) * Math.PI * 2;
    put(94 + Math.round(Math.cos(angle) * 7), 186 + Math.round(Math.sin(angle) * 3), rope.mid);
    put(94 + Math.round(Math.cos(angle) * 4), 186 + Math.round(Math.sin(angle) * 2), rope.light);
  }

  skyLight(key, put, BEACH.sun, BEACH.moon, BEACH_HORIZON);
  return buffer;
};

/** The surf breathes (SPEC §22.8): foam running along the shelf edge and
 *  washing around the islet. Reduced motion holds it at its settled reach. */
export const renderBeachLive = (ctx: SceneContext, nowMs: number): void => {
  ctx.fillStyle = "#eef6f8";
  const reach = Math.round(Math.sin(nowMs / 1900) * 3);
  const lag = Math.round(Math.sin(nowMs / 1900 - 1.2) * 2);
  for (let x = -6; x < ROOM_WIDTH; x += 15) {
    ctx.fillRect(x + reach, BEACH_HORIZON - 1, 9, 1);
    ctx.fillRect(x + 8 + lag, BEACH_HORIZON + 1, 5, 1);
  }
};


// ── the forest clearing ─────────────────────────────────────────────────────
// Roofed. Canopy hangs from the top edge with a ragged gap of sky in the
// middle, and two trunks run the full height of the frame — the only venue
// with foreground standing between the viewer and the pet.

export const FOREST_HORIZON = 66;

export const FOREST = {
  floor: {
    spring: [
      [40, 70, 44],
      [54, 90, 52],
      [70, 112, 64],
    ],
    summer: [
      [34, 58, 38],
      [46, 76, 46],
      [58, 94, 56],
    ],
    autumn: [
      [86, 72, 40],
      [108, 88, 46],
      [130, 106, 56],
    ],
    // Snowed-in come winter (SPEC §22.8).
    winter: SNOW_RAMP,
  } as Record<Season, readonly [RGB, RGB, RGB]>,
  far: [40, 62, 52] as RGB,
  dapple: [86, 116, 68] as RGB,
  fern: ramp([46, 90, 52], 0.8),
  canopy: ramp([26, 48, 34]),
  trunk: ramp([48, 36, 30]),
  stumpTop: ramp([150, 122, 86]),
  stumpSide: ramp([92, 70, 50]),
  rock: ramp([92, 96, 92]),
  leafRust: ramp([162, 84, 44]),
  leafGold: ramp([196, 148, 62]),
  shadow: [30, 46, 36] as RGB,
  sun: [126, 148, 84] as RGB,
  moon: [56, 74, 86] as RGB,
};

/** Distant trunks across the clearing's far side. */
export const forestHorizonAt = (sx: number): number => 10 + Math.floor(Math.abs(((sx + 11) % 26) - 13) / 2);

/**
 * How far the canopy hangs down in a column: heavy at the edges, torn open
 * over the middle so the clearing has sky and weather can fall through it.
 *
 * The opening has a flat bottom on purpose. Tapering it from a single centre
 * point cuts a V out of the leaves, and a V of bright sky between two dark
 * masses reads as a snow-capped peak — which is another venue entirely.
 */
const canopyAt = (sx: number): number => {
  const from = Math.abs(sx - 128);
  const open = from < 36 ? 1 : Math.max(0, 1 - (from - 36) / 20);
  const ragged = hash(Math.floor(sx / 3) * 977) * 7;
  return Math.max(0, Math.round(30 + ragged - open * 30));
};

export const composeForest = (key: BackdropKey): Uint8ClampedArray => {
  const { buffer, put } = makeBuffer();
  const worn = (color: RGB): RGB => wear(color, key.condition);
  const winter = key.season === "winter";
  const sky = skyRamp(key.segment, key.weather, key.season);
  const far = sky[sky.length - 1]!;

  paintSky(key, put, FOREST_HORIZON);

  // Depth into the trees: a hazed far wall, then nearer trunks in front of
  // it, so the clearing has a back rather than a painted line.
  for (let x = 0; x < ROOM_WIDTH; x++) {
    const wall = FOREST_HORIZON - forestHorizonAt(x);
    for (let y = wall; y < FOREST_HORIZON; y++) put(x, y, worn(haze(FOREST.far, far, 0.45)));
  }
  // Trunks back in the trees. Evenly spaced identical bars read as a picket
  // fence, so spacing, width, height and haze all vary — some stand in
  // pairs, some are missing entirely.
  let trunkX = 4;
  for (let index = 0; trunkX < ROOM_WIDTH; index++) {
    const roll = hash(index * 977);
    trunkX += 7 + Math.round(roll * 16);
    if (hash(index * 613) < 0.18) continue; // a gap in the trees
    const depth = 0.18 + hash(index * 331) * 0.34;
    const width = hash(index * 71) < 0.3 ? 3 : 2;
    const rise = 16 + Math.round(hash(index * 137) * 18);
    const lean = Math.round(hash(index * 31) * 3) - 1;
    const tone = ramp(haze(FOREST.trunk.mid, far, depth), 0.6);
    for (let y = FOREST_HORIZON - rise; y < FOREST_HORIZON; y++) {
      const x = trunkX + Math.round((lean * (FOREST_HORIZON - y)) / rise);
      for (let dx = 0; dx < width; dx++) put(x + dx, y, worn(dx === 0 ? tone.mid : tone.shade));
    }
  }

  // The floor: flat regions with dithered seams.
  const floor = FOREST.floor[key.season];
  bands(
    put,
    FOREST_HORIZON,
    ROOM_HEIGHT,
    [
      { until: FOREST_HORIZON + 26, color: worn(floor[2]) },
      { until: FOREST_HORIZON + 70, color: worn(floor[1]) },
      { until: ROOM_HEIGHT, color: worn(floor[0]) },
    ],
    14,
  );

  // Dappled light: irregular pools that fall where the canopy is thin,
  // rather than two symmetrical cones aimed at the floor.
  if (!isDark(key.segment)) {
    const pool = worn(FOREST.dapple);
    scatter(FOREST_HORIZON + 6, ROOM_HEIGHT - 4, 13, 0xda99, (x, y, depth, index) => {
      if (canopyAt(x) > 22) return; // no gap overhead, no light on the floor
      const halfW = 6 + Math.round(depth * 18) + Math.round(hash(index * 17) * 8);
      const halfH = Math.max(2, Math.round(halfW * 0.28));
      for (let dy = -halfH; dy <= halfH; dy++) {
        for (let dx = -halfW; dx <= halfW; dx++) {
          const d = (dx / halfW) ** 2 + (dy / halfH) ** 2;
          if (d > 1) continue;
          // Light on a floor is broken by everything it falls through, so
          // even the middle of a pool is stippled rather than solid. Filled
          // ovals read as puddles or moss, not as sun.
          if (threshold(x + dx, y + dy, 2) < 0.24 + d * 0.7) continue;
          put(x + dx, y + dy, pool);
        }
      }
    });
  }

  // Leaf litter and ferns, clustered and perspective-scaled.
  const fern = winter ? WINTER_COVER : FOREST.fern;
  scatter(FOREST_HORIZON + 2, ROOM_HEIGHT - 2, 150, 0xfe30, (x, y, depth, index) => {
    const tone = { light: worn(fern.light), mid: worn(fern.mid), shade: worn(fern.shade) };
    tuft(put, x, y, 2 + Math.round(depth * 6), tone, index + Math.round(x / 5));
  });
  if (key.season === "autumn") {
    scatter(FOREST_HORIZON + 4, ROOM_HEIGHT - 2, 70, 0x1ea5, (x, y, depth, index) => {
      const tone = index % 2 === 0 ? FOREST.leafRust : FOREST.leafGold;
      const wide = 1 + Math.round(depth * 2);
      for (let dx = -wide; dx <= wide; dx++) put(x + dx, y, worn(dx < 0 ? tone.light : tone.shade));
    });
  }
  scatter(FOREST_HORIZON + 16, ROOM_HEIGHT - 6, 10, 0x5100, (x, y, depth) => {
    pebble(put, x, y, 2 + Math.round(depth * 3), FOREST.rock, worn(FOREST.shadow));
  });

  // The fallen log, three tones with rings and its own cast shadow.
  const log = { x: 138, y: 148, w: 52, h: 13 };
  castShadow(put, log.x + Math.round(log.w / 2), log.y + log.h + 1, Math.round(log.w * 0.6), worn(FOREST.shadow));
  const bark = FOREST.stumpSide;
  for (let y = log.y; y < log.y + log.h; y++) {
    for (let x = log.x; x < log.x + log.w; x++) {
      const t = (y - log.y) / log.h;
      put(x, y, worn(t < 0.24 ? bark.light : t > 0.72 ? bark.shade : bark.mid));
    }
  }
  const face = FOREST.stumpTop;
  for (let dy = 0; dy < log.h; dy++) {
    const half = Math.round((log.h / 2) * Math.sqrt(Math.max(0, 1 - ((dy - log.h / 2) / (log.h / 2)) ** 2)));
    for (let dx = -half; dx <= half; dx++) {
      const rings = Math.abs(dx) + Math.abs(dy - Math.round(log.h / 2));
      put(log.x + 4 + dx, log.y + dy, worn(rings % 4 < 2 ? face.mid : face.light));
    }
  }

  // The two near trunks, over everything, with roots flaring into the floor.
  for (const trunkX of [24, 212]) {
    const width = 15;
    const tone = FOREST.trunk;
    castShadow(put, trunkX + Math.round(width / 2), ROOM_HEIGHT - 6, 24, worn(FOREST.shadow));
    for (let y = 0; y < ROOM_HEIGHT; y++) {
      for (let dx = 0; dx < width; dx++) {
        // Bark as vertical furrows: a lit side, a mid body, a shadow side.
        const furrow = hash((trunkX + dx) * 97 + Math.floor(y / 7) * 13) < 0.22;
        const value = dx < 3 ? tone.light : dx > width - 4 ? tone.shade : furrow ? tone.shade : tone.mid;
        put(trunkX + dx, y, worn(value));
      }
    }
    roots(put, trunkX, width, ROOM_HEIGHT - 2, { light: worn(tone.light), mid: worn(tone.mid), shade: worn(tone.shade) }, trunkX);
  }

  // Mushrooms in the litter — the smallest thing that says a forest floor
  // is alive rather than carpeted.
  const cap = { light: worn(FOREST.leafRust.light), mid: worn(FOREST.leafRust.mid), shade: worn(FOREST.leafRust.shade) };
  const stalkTone = { light: worn(FOREST.stumpTop.light), mid: worn(FOREST.stumpTop.mid), shade: worn(FOREST.stumpTop.shade) };
  scatter(FOREST_HORIZON + 20, ROOM_HEIGHT - 6, 11, 0x5b20, (x, y, depth) => {
    const wide = 1 + Math.round(depth * 2);
    for (let dy = 0; dy < 1 + Math.round(depth * 2); dy++) put(x, y - dy, stalkTone.mid);
    const lift = y - 1 - Math.round(depth * 2);
    for (let dx = -wide; dx <= wide; dx++) put(x + dx, lift, dx < 0 ? cap.light : cap.mid);
    for (let dx = -wide + 1; dx <= wide - 1; dx++) put(x + dx, lift - 1, cap.light);
  });

  // The canopy last: leaf masses hanging from the top edge, not a band.
  const leaf = FOREST.canopy;
  for (let x = 0; x < ROOM_WIDTH; x++) {
    const hang = canopyAt(x);
    for (let y = 0; y < hang; y++) put(x, y, worn(y > hang - 4 ? leaf.shade : leaf.mid));
  }
  scatter(4, 34, 60, 0x1ea7, (x, y, depth, index) => {
    if (canopyAt(x) < 6) return;
    const size = 3 + Math.round(hash(index * 53) * 5);
    for (let dy = 0; dy < size; dy++) {
      const half = Math.round(size * Math.sin(((dy + 0.5) / size) * Math.PI));
      for (let dx = -half; dx <= half; dx++) {
        put(x + dx, y + dy, worn(dy < 2 ? leaf.light : dx > half - 2 ? leaf.shade : leaf.mid));
      }
    }
    void depth;
  });
  if (winter) {
    for (let x = 0; x < ROOM_WIDTH; x++) {
      const hang = canopyAt(x);
      if (hang > 0 && hash(x * 7) < 0.6) put(x, hang - 1, worn(SNOW_RAMP[2]));
    }
  }


  skyLight(key, put, FOREST.sun, FOREST.moon, FOREST_HORIZON);
  return buffer;
};


// ── the shrine path ─────────────────────────────────────────────────────────
// The gate is the venue. Its posts run from near the top of the frame down
// into the paving, so the pet stands *inside* the torii rather than in front
// of a distant one.

export const SHRINE_HORIZON = 98;

export const SHRINE = {
  stone: {
    spring: [
      [92, 100, 88],
      [116, 122, 106],
      [140, 144, 126],
    ],
    summer: [
      [88, 96, 84],
      [112, 118, 102],
      [136, 140, 122],
    ],
    autumn: [
      [112, 100, 76],
      [136, 122, 92],
      [160, 146, 112],
    ],
    winter: SNOW_RAMP,
  } as Record<Season, readonly [RGB, RGB, RGB]>,
  cedar: [26, 46, 38] as RGB,
  cedarLight: [38, 64, 48] as RGB,
  moss: ramp([66, 96, 60], 0.9),
  vermilion: ramp([196, 66, 50]),
  lantern: ramp([146, 142, 128]),
  gravel: ramp([150, 148, 138]),
  rope: ramp([196, 176, 130]),
  paper: ramp([242, 240, 232]),
  water: [96, 132, 148] as RGB,
  shadow: [64, 70, 66] as RGB,
  sun: [150, 154, 112] as RGB,
  moon: [70, 80, 96] as RGB,
};

/** The gate, drawn big: posts nearly the height of the frame. */
const TORII = { left: 46, right: 214, post: 11, top: 16, lintel: 10 } as const;

export const shrineHorizonAt = (sx: number): number => {
  const onPost =
    (sx >= TORII.left && sx < TORII.left + TORII.post) || (sx >= TORII.right - TORII.post && sx < TORII.right);
  // The span between the posts stays at the cedar line on purpose: the sun is
  // clipped to whatever stands in its column, and a low horizon there is what
  // lets it drop *into* the gateway at dusk.
  if (onPost) return SHRINE_HORIZON - TORII.top;
  return 20 + Math.floor(Math.abs(((sx + 5) % 24) - 12) / 2);
};

export const composeShrine = (key: BackdropKey): Uint8ClampedArray => {
  const { buffer, put } = makeBuffer();
  const worn = (color: RGB): RGB => wear(color, key.condition);
  const tone = (r: Ramp): Ramp => ({ light: worn(r.light), mid: worn(r.mid), shade: worn(r.shade) });
  const winter = key.season === "winter";

  paintSky(key, put, SHRINE_HORIZON);

  // Cedars behind the gate, individual crowns rather than a scalloped strip.
  for (let x = 0; x < ROOM_WIDTH; x++) {
    const top = SHRINE_HORIZON - (20 + Math.floor(Math.abs(((x + 5) % 24) - 12) / 2));
    for (let y = top; y < SHRINE_HORIZON; y++) put(x, y, worn(y === top ? SHRINE.cedarLight : SHRINE.cedar));
    if (winter) put(x, top, worn(SNOW_RAMP[2]));
  }

  // The precinct floor: courses of stone laid flat, with moss in the joints.
  const course = SHRINE.stone[key.season];
  bands(
    put,
    SHRINE_HORIZON,
    ROOM_HEIGHT,
    [
      { until: SHRINE_HORIZON + 24, color: worn(course[2]) },
      { until: SHRINE_HORIZON + 62, color: worn(course[1]) },
      { until: ROOM_HEIGHT, color: worn(course[0]) },
    ],
    12,
  );
  // Paving slabs: courses that widen toward the viewer, offset course to
  // course, each slab lit along its upper edge. A single flat field of
  // stone is the thing that made this precinct read as empty.
  const gravel = tone(SHRINE.gravel);
  let courseY = SHRINE_HORIZON + 3;
  for (let course = 0; courseY < ROOM_HEIGHT; course++) {
    const depth = (courseY - SHRINE_HORIZON) / (ROOM_HEIGHT - SHRINE_HORIZON);
    const tall = 5 + Math.round(depth * 9);
    const wide = 16 + Math.round(depth * 22);
    for (let x = 0; x < ROOM_WIDTH; x++) {
      const joint = (x + course * Math.round(wide / 2)) % wide === 0;
      if (joint) column(put, x, courseY, Math.min(ROOM_HEIGHT, courseY + tall), gravel.shade);
      put(x, courseY, gravel.light);
      if (courseY + tall - 1 < ROOM_HEIGHT) put(x, courseY + tall - 1, gravel.shade);
    }
    courseY += tall;
  }
  const moss = winter ? tone(WINTER_COVER) : tone(SHRINE.moss);
  scatter(SHRINE_HORIZON + 4, ROOM_HEIGHT - 2, 60, 0x3055, (x, y, depth, index) => {
    tuft(put, x, y, 2 + Math.round(depth * 3), moss, index + x);
  });

  // The steps, each tread lit along its nose and each riser in shadow.
  for (let y = SHRINE_HORIZON; y < ROOM_HEIGHT; y++) {
    const depth = (y - SHRINE_HORIZON) / (ROOM_HEIGHT - SHRINE_HORIZON);
    const half = 20 + depth * 26;
    const step = Math.floor((y - SHRINE_HORIZON) / 7);
    const inStep = (y - SHRINE_HORIZON) % 7;
    for (let x = Math.max(0, Math.round(130 - half)); x < Math.min(ROOM_WIDTH, 130 + half); x++) {
      const value = inStep === 0 ? gravel.light : inStep > 4 ? gravel.shade : gravel.mid;
      put(x, y, value);
    }
    void step;
  }

  // The gate, over everything: posts to the ground, then the lintel.
  const paint = tone(SHRINE.vermilion);
  for (const postX of [TORII.left, TORII.right - TORII.post]) {
    castShadow(put, postX + TORII.post + 8, SHRINE_HORIZON + 34, 14, worn(SHRINE.shadow));
    for (let x = postX; x < postX + TORII.post; x++) {
      const shade = x < postX + 2 ? paint.light : x > postX + TORII.post - 4 ? paint.shade : paint.mid;
      column(put, x, TORII.top, SHRINE_HORIZON + 34, shade);
    }
  }
  for (let y = TORII.top; y < TORII.top + TORII.lintel; y++) {
    const over = y < TORII.top + 5;
    const from = over ? TORII.left - 14 : TORII.left + 4;
    const to = over ? TORII.right + 14 : TORII.right - 4;
    for (let x = from; x < to; x++) {
      put(x, y, y < TORII.top + 2 ? paint.light : y > TORII.top + TORII.lintel - 3 ? paint.shade : paint.mid);
    }
  }
  for (let x = TORII.left + 4; x < TORII.right - 4; x++) {
    put(x, TORII.top + 20, paint.light);
    put(x, TORII.top + 21, paint.mid);
    put(x, TORII.top + 22, paint.shade);
  }

  // Stone lanterns either side, stacked slabs each catching the light.
  const lamp = tone(SHRINE.lantern);
  const lantern = (baseX: number, baseY: number, unit: number): void => {
    castShadow(put, baseX + 5 * unit, baseY, 6 * unit, worn(SHRINE.shadow));
    solid(put, { x: baseX - 4 * unit, y: baseY - 3 * unit, w: 8 * unit, h: 3 * unit }, lamp);
    solid(put, { x: baseX - 2 * unit, y: baseY - 8 * unit, w: 4 * unit, h: 5 * unit }, lamp);
    solid(put, { x: baseX - 5 * unit, y: baseY - 14 * unit, w: 10 * unit, h: 6 * unit }, lamp);
    solid(put, { x: baseX - 7 * unit, y: baseY - 17 * unit, w: 14 * unit, h: 3 * unit }, lamp);
    solid(put, { x: baseX - 2 * unit, y: baseY - 19 * unit, w: 4 * unit, h: 2 * unit }, lamp);
  };
  lantern(22, 168, 2);
  lantern(244, 142, 1);


    // The shimenawa across the gate with its paper streamers, and a basin to
  // wash at. A torii on its own is a shape; these make it a shrine.
  const rope = tone(SHRINE.rope);
  const paper = tone(SHRINE.paper);
  const ropeY = TORII.top + 34;
  const sagAt = (x: number): number =>
    Math.round(Math.sin(((x - TORII.left) / (TORII.right - TORII.left)) * Math.PI) * 6);
  for (let x = TORII.left + 6; x < TORII.right - 6; x++) {
    const y = ropeY + sagAt(x);
    put(x, y, rope.light);
    put(x, y + 1, rope.mid);
    put(x, y + 2, rope.mid);
    put(x, y + 3, rope.shade);
  }
  for (const streamerX of [82, 116, 150, 184]) {
    const y = ropeY + sagAt(streamerX) + 4;
    for (let dy = 0; dy < 11; dy++) {
      const wide = dy < 5 ? 1 : 2;
      for (let dx = -wide; dx <= wide; dx++) put(streamerX + dx, y + dy, dx < 0 ? paper.light : paper.mid);
    }
  }

  const basin = tone(SHRINE.lantern);
  castShadow(put, 210, 180, 14, worn(SHRINE.shadow));
  solid(put, { x: 202, y: 178, w: 14, h: 10 }, basin);
  solid(put, { x: 194, y: 164, w: 30, h: 14 }, basin);
  for (let dx = 3; dx < 27; dx++) put(194 + dx, 165, worn(SHRINE.water));
  for (let dx = 4; dx < 26; dx++) put(194 + dx, 166, worn(SHRINE.water));
  for (let dx = 6; dx < 24; dx++) put(194 + dx, 167, worn(SHRINE.water));

  skyLight(key, put, SHRINE.sun, SHRINE.moon, SHRINE_HORIZON);
  return buffer;
};

// ── the koi pond ────────────────────────────────────────────────────────────
// Water, mostly. The far bank is a strip near the top and the near bank a
// strip at the bottom; everything between is surface, with stepping stones
// crossing it.

export const POND_HORIZON = 62;

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
  blade: ramp([48, 82, 52], 0.8),
  reed: ramp([58, 82, 50], 0.9),
  water: [
    [22, 62, 72],
    [32, 88, 100],
    [48, 116, 126],
  ] as readonly [RGB, RGB, RGB],
  ice: [
    [150, 172, 184],
    [176, 196, 206],
    [202, 218, 226],
  ] as readonly [RGB, RGB, RGB],
  glint: [130, 176, 186] as RGB,
  pad: ramp([44, 98, 60]),
  bloom: ramp([232, 172, 200]),
  stone: ramp([126, 122, 114]),
  shadow: [22, 52, 60] as RGB,
  sun: [128, 152, 92] as RGB,
  moon: [62, 82, 96] as RGB,
};

/** Where the near bank takes over — low, so water owns the frame. */
const POND_SHORE = 176;

export const pondHorizonAt = (sx: number): number => 8 + Math.floor(Math.abs(((sx + 3) % 18) - 9) / 2);

export const composePond = (key: BackdropKey): Uint8ClampedArray => {
  const { buffer, put } = makeBuffer();
  const worn = (color: RGB): RGB => wear(color, key.condition);
  const tone = (r: Ramp): Ramp => ({ light: worn(r.light), mid: worn(r.mid), shade: worn(r.shade) });
  const winter = key.season === "winter";

  paintSky(key, put, POND_HORIZON);

  // The far bank: reeds in clumps rather than one continuous fringe.
  const reed = winter ? tone(WINTER_COVER) : tone(POND.reed);
  for (let x = 0; x < ROOM_WIDTH; x++) {
    const top = POND_HORIZON - pondHorizonAt(x);
    for (let y = top; y < POND_HORIZON; y++) put(x, y, y === top ? reed.light : reed.mid);
  }
  for (let x = 0; x < ROOM_WIDTH; x += 3) {
    if (hash(x * 41) < 0.5) tuft(put, x, POND_HORIZON, 3 + Math.round(hash(x * 7) * 5), reed, x);
  }

  // The near bank at the bottom of the frame.
  const bank = POND.bank[key.season];
  bands(put, POND_HORIZON, ROOM_HEIGHT, [{ until: ROOM_HEIGHT, color: worn(bank[0]) }], 1);

  // The water: flat bands with a dithered seam, not a stippled gradient.
  const surface = winter ? POND.ice : POND.water;
  bands(
    put,
    POND_HORIZON,
    POND_SHORE,
    [
      { until: POND_HORIZON + 34, color: worn(surface[2]) },
      { until: POND_HORIZON + 78, color: worn(surface[1]) },
      { until: POND_SHORE, color: worn(surface[0]) },
    ],
    14,
  );
  // Glints in short broken runs, and only on a few rows. Stippling every
  // ninth row across the whole pond turned still water into static.
  if (!winter) {
    for (let y = POND_HORIZON + 6; y < POND_SHORE; y += 7 + Math.floor(hash(y * 17) * 6)) {
      for (let x = 0; x < ROOM_WIDTH; x++) {
        if (hash(Math.floor(x / 4) * 313 + y * 13) > 0.14) continue;
        const run = 2 + Math.floor(hash(x * 29 + y) * 4);
        for (let dx = 0; dx < run; dx++) put(x + dx, y, worn(POND.glint));
      }
    }
  }

  // Stepping stones, each shaded and each on its own reflection.
  const stone = tone(POND.stone);
  for (let index = 0; index < 6; index++) {
    const cx = 26 + index * 41;
    const cy = POND_SHORE - 14 - Math.floor(hash(index * 61) * 52);
    const half = 7 + Math.floor(hash(index * 23) * 4);
    castShadow(put, cx, cy + 4, half + 1, worn(POND.shadow));
    for (let dy = -3; dy <= 3; dy++) {
      const span = Math.round(half * Math.sqrt(Math.max(0, 1 - (dy / 3.6) ** 2)));
      for (let dx = -span; dx <= span; dx++) {
        put(cx + dx, cy + dy, dy < -1 ? stone.light : dy > 1 || dx > span - 2 ? stone.shade : stone.mid);
      }
    }
  }

  // Lily pads, whole discs with a notch and a lit rim.
  if (!winter) {
    const pad = tone(POND.pad);
    const bloom = tone(POND.bloom);
    scatter(POND_HORIZON + 8, POND_SHORE - 8, 14, 0x11ce, (x, y, depth, index) => {
      const half = 3 + Math.round(depth * 5);
      const rows = 2 + Math.round(depth);
      for (let row = 0; row < rows; row++) {
        const shrink = row === 0 || row === rows - 1 ? 1 : 0;
        for (let dx = -half + shrink; dx <= half - shrink; dx++) {
          if (dx > half - 3 && row < rows - 1) continue;
          put(x + dx, y + row, row === 0 ? pad.light : dx > half - 3 ? pad.shade : pad.mid);
        }
      }
      if (index % 3 === 0) {
        put(x - 1, y - 1, bloom.light);
        put(x, y - 1, bloom.mid);
        put(x + 1, y - 1, bloom.shade);
        put(x, y - 2, bloom.light);
      }
    });
  }

  // Reeds standing out of the near edge.
  for (let index = 0; index < 26; index++) {
    const x = 3 + Math.floor(hash(index * 83) * (ROOM_WIDTH - 6));
    tuft(put, x, POND_SHORE + 2, 5 + Math.floor(hash(index * 41) * 8), reed, index);
  }
  const blade = winter ? tone(WINTER_COVER) : tone(POND.blade);
  scatter(POND_SHORE + 2, ROOM_HEIGHT - 2, 40, 0xb14d, (x, y, depth, index) => {
    tuft(put, x, y, 2 + Math.round(depth * 4), blade, index + x);
  });


  skyLight(key, put, POND.sun, POND.moon, POND_SHORE);
  return buffer;
};

/** Koi, drifting under the surface (SPEC §22.8). They are drawn over the
 *  composed scene rather than into it, so they cost nothing to cache; under
 *  reduced motion the clock is held at zero and they simply sit still. */
export const renderPondLive = (ctx: SceneContext, nowMs: number): void => {
  const fish = [
    { color: "#d9743c", y: POND_HORIZON + 22, period: 21_000, phase: 0.1, len: 7 },
    { color: "#e8e2d4", y: POND_HORIZON + 54, period: 27_000, phase: 0.5, len: 6 },
    { color: "#c8543c", y: POND_HORIZON + 88, period: 18_000, phase: 0.8, len: 9 },
  ];
  for (const koi of fish) {
    const drift = ((nowMs / koi.period + koi.phase) % 1 + 1) % 1;
    const x = Math.round(-12 + drift * (ROOM_WIDTH + 24));
    ctx.fillStyle = koi.color;
    ctx.fillRect(x, koi.y, koi.len, 2);
    // A tail that trails the body, so it reads as swimming rather than sliding.
    ctx.fillRect(x - 2, koi.y + (Math.floor(nowMs / 700 + koi.phase * 10) % 2 === 0 ? 0 : 1), 2, 1);
  }
};

// ── the blossom park ────────────────────────────────────────────────────────
// A branch hangs into the frame from above and an avenue recedes beneath it.
// The season is the whole point: the same place is four different colours.

export const BLOSSOM_HORIZON = 84;

/** The canopy, which is the whole point of the place: a different tree in
 *  every season, and bare enough in winter to see the sky through. */
const CANOPY: Record<Season, { light: RGB; shade: RGB }> = {
  spring: { light: [246, 190, 212], shade: [214, 140, 176] },
  summer: { light: [58, 104, 54], shade: [28, 62, 36] },
  autumn: { light: [216, 128, 60], shade: [154, 72, 40] },
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
  blade: ramp([50, 88, 54], 0.8),
  /** Every colour the crown can wear, so the readability check has the set. */
  canopy: Object.values(CANOPY).flatMap((season) => [season.light, season.shade]) as RGB[],
  trunk: ramp([80, 62, 52]),
  gravel: ramp([176, 168, 152]),
  bench: ramp([138, 100, 62]),
  fallen: ramp([228, 166, 192]),
  // Cast iron, not stone. A pale stacked-stone object standing alone on
  // mown grass beside a gravel path is a headstone, and once the eye reads
  // one the bench and the path become a cemetery too.
  iron: ramp([54, 58, 62]),
  lampGlow: ramp([246, 222, 150]),
  bedSoil: ramp([92, 66, 48]),
  bedRed: ramp([206, 78, 84]),
  bedGold: ramp([232, 186, 84]),
  bedWhite: ramp([238, 234, 226]),
  kerb: ramp([158, 152, 138]),
  shadow: [52, 72, 54] as RGB,
  sun: [156, 164, 100] as RGB,
  moon: [70, 84, 98] as RGB,
};

/**
 * The avenue: nine trees at irregular spacing with crowns of different
 * sizes, overlapping. The previous version repeated one arch across the
 * width on a fixed modulus, which read as an arcade or a clipped hedge —
 * and a row of identical domes behind a lone stone marker is a cemetery.
 */
const AVENUE = Array.from({ length: 9 }, (_, index) => ({
  x: 4 + index * 31 + Math.round(hash(index * 911) * 16),
  radius: 11 + Math.round(hash(index * 577) * 11),
}));

export const blossomHorizonAt = (sx: number): number => {
  let height = 6;
  for (const tree of AVENUE) {
    const from = Math.abs(sx - tree.x);
    if (from >= tree.radius) continue;
    height = Math.max(height, 7 + Math.round(Math.sqrt(tree.radius ** 2 - from ** 2) * 0.95));
  }
  return height;
};

export const composeBlossom = (key: BackdropKey): Uint8ClampedArray => {
  const { buffer, put } = makeBuffer();
  const worn = (color: RGB): RGB => wear(color, key.condition);
  const tone = (r: Ramp): Ramp => ({ light: worn(r.light), mid: worn(r.mid), shade: worn(r.shade) });
  const winter = key.season === "winter";
  const canopy = CANOPY[key.season];
  const crown: Ramp = { light: worn(canopy.light), mid: worn(canopy.shade), shade: worn(canopy.shade) };

  paintSky(key, put, BLOSSOM_HORIZON);

  // The avenue: a trunk under every crown, and crowns that overlap.
  const bark = tone(BLOSSOM.trunk);
  for (const tree of AVENUE) {
    for (let y = BLOSSOM_HORIZON - 11; y < BLOSSOM_HORIZON + 2; y++) {
      put(tree.x - 1, y, bark.light);
      put(tree.x, y, bark.mid);
      put(tree.x + 1, y, bark.shade);
    }
  }
  for (let x = 0; x < ROOM_WIDTH; x++) {
    const top = BLOSSOM_HORIZON - blossomHorizonAt(x);
    for (let y = top; y < BLOSSOM_HORIZON; y++) {
      if (winter && hash(x * 41 + y * 97) > 0.44) continue;
      // Lit on the upper left of each crown rather than along one flat band.
      const lit = y < top + 4 || hash(x * 53 + y * 29) < 0.14;
      put(x, y, lit ? crown.light : crown.mid);
    }
  }

  // Lawn as flat regions.
  const lawn = BLOSSOM.lawn[key.season];
  bands(
    put,
    BLOSSOM_HORIZON,
    ROOM_HEIGHT,
    [
      { until: BLOSSOM_HORIZON + 22, color: worn(lawn[2]) },
      { until: BLOSSOM_HORIZON + 58, color: worn(lawn[1]) },
      { until: ROOM_HEIGHT, color: worn(lawn[0]) },
    ],
    12,
  );

  // The gravel walk, its stones lit along the near kerb.
  const gravel = tone(BLOSSOM.gravel);
  for (let y = BLOSSOM_HORIZON; y < ROOM_HEIGHT; y++) {
    const depth = (y - BLOSSOM_HORIZON) / (ROOM_HEIGHT - BLOSSOM_HORIZON);
    const centre = 158 + depth * 26;
    const half = 5 + depth * 24;
    for (let x = Math.round(centre - half); x <= Math.round(centre + half); x++) {
      const offset = Math.abs(x - centre) / half;
      if (offset > 1) continue;
      const grit = hash(x * 41 + y * 17) < 0.24;
      const color = winter ? worn(SNOW_RAMP[1]) : offset > 0.86 ? gravel.shade : grit ? gravel.light : gravel.mid;
      if (offset <= 0.86 || threshold(x, y, 3) < 0.55) put(x, y, color);
      // A kerb, so the walk is laid rather than worn.
      if (offset > 0.93) put(x, y, tone(BLOSSOM.kerb).light);
    }
  }

  const blade = winter ? tone(WINTER_COVER) : tone(BLOSSOM.blade);
  scatter(BLOSSOM_HORIZON + 2, ROOM_HEIGHT - 2, 90, 0xb105, (x, y, depth, index) => {
    tuft(put, x, y, 2 + Math.round(depth * 4), blade, index + Math.round(x / 6));
  });
  if (key.season === "spring") {
    const fallen = tone(BLOSSOM.fallen);
    scatter(BLOSSOM_HORIZON + 6, ROOM_HEIGHT - 4, 54, 0x9e7a1, (x, y, depth) => {
      put(x, y, fallen.light);
      if (depth > 0.5) put(x + 1, y, fallen.shade);
    });
  }

  // Flower beds either side of the walk. Planting is what a park has and a
  // cemetery does not, and it puts strong colour on the ground.
  const soil = tone(BLOSSOM.bedSoil);
  const blooms = [tone(BLOSSOM.bedRed), tone(BLOSSOM.bedGold), tone(BLOSSOM.bedWhite)];
  const bed = (cx: number, cy: number, halfW: number, halfH: number, seed: number): void => {
    shadowStrip(put, cx - halfW, cy + halfH, halfW * 2, 3, worn(BLOSSOM.shadow));
    for (let dy = -halfH; dy <= halfH; dy++) {
      const span = Math.round(halfW * Math.sqrt(Math.max(0, 1 - (dy / (halfH + 0.5)) ** 2)));
      for (let dx = -span; dx <= span; dx++) {
        put(cx + dx, cy + dy, dy < -halfH + 2 ? soil.light : hash((cx + dx) * 53 + dy * 17) < 0.3 ? soil.shade : soil.mid);
      }
    }
    if (winter) return;
    for (let index = 0; index < halfW; index++) {
      const dx = -halfW + 2 + Math.floor(hash(index * 37 + seed) * (halfW * 2 - 4));
      const dy = -halfH + 1 + Math.floor(hash(index * 71 + seed) * (halfH * 2 - 1));
      tuft(put, cx + dx, cy + dy, 3, blooms[index % blooms.length]!, index + seed);
    }
  };
  // Laid out so nothing sits on anything else: the walk runs from about
  // x=154 to x=207 across the foreground, and the benches and the lamp own
  // the ground either side of it.
  bed(40, 120, 22, 5, 3);
  bed(228, 178, 26, 8, 11);
  bed(124, 176, 30, 9, 23);

  // A cast-iron lamp post — the park's own furniture, and unmistakably not
  // a grave marker: dark, slim, and topped with a light.
  const iron = tone(BLOSSOM.iron);
  const glow = tone(BLOSSOM.lampGlow);
  castShadow(put, 116, 152, 10, worn(BLOSSOM.shadow));
  solid(put, { x: 112, y: 146, w: 10, h: 6 }, iron);
  solid(put, { x: 114, y: 100, w: 5, h: 46 }, iron);
  solid(put, { x: 110, y: 86, w: 13, h: 14 }, iron);
  for (let y = 89; y < 97; y++) for (let x = 113; x < 120; x++) put(x, y, y < 91 ? glow.light : glow.mid);
  solid(put, { x: 108, y: 80, w: 17, h: 6 }, iron);
  put(116, 77, iron.mid);
  put(116, 78, iron.mid);
  put(116, 79, iron.light);

  const seat = tone(BLOSSOM.bench);
  const bench = { left: 22, right: 88, top: 158 };
  shadowStrip(put, bench.left, bench.top + 22, bench.right - bench.left, 4, worn(BLOSSOM.shadow));
  solid(put, { x: bench.left, y: bench.top, w: bench.right - bench.left, h: 6 }, seat);
  for (const legX of [bench.left + 5, bench.right - 11]) solid(put, { x: legX, y: bench.top + 6, w: 6, h: 16 }, seat);
  for (const railY of [bench.top - 18, bench.top - 11]) {
    solid(put, { x: bench.left + 3, y: railY, w: bench.right - bench.left - 6, h: 4 }, seat);
  }
  for (const postX of [bench.left + 3, bench.right - 9]) solid(put, { x: postX, y: bench.top - 18, w: 6, h: 18 }, seat);

  // A second bench further up the walk, smaller with distance, so the park
  // reads as somewhere people sit rather than somewhere one bench stands.
  const far = { left: 204, right: 246, top: 128 };
  shadowStrip(put, far.left, far.top + 13, far.right - far.left, 3, worn(BLOSSOM.shadow));
  solid(put, { x: far.left, y: far.top, w: far.right - far.left, h: 4 }, seat);
  for (const legX of [far.left + 3, far.right - 7]) solid(put, { x: legX, y: far.top + 4, w: 4, h: 9 }, seat);
  solid(put, { x: far.left + 2, y: far.top - 10, w: far.right - far.left - 4, h: 3 }, seat);
  for (const postX of [far.left + 2, far.right - 6]) solid(put, { x: postX, y: far.top - 10, w: 4, h: 10 }, seat);

  // The tree in the near corner and the bough it throws across the frame:
  // foreground above the pet, which no other venue has.
  for (let x = 0; x < 18; x++) {
    const furrow = hash(x * 97) < 0.3;
    for (let y = 0; y < ROOM_HEIGHT; y++) {
      put(x, y, x < 4 ? bark.light : x > 14 ? bark.shade : furrow ? bark.shade : bark.mid);
    }
  }
  const boughY = (x: number): number => 12 + Math.round((x / 200) * (x / 200) * 26);
  for (let x = 16; x < 226; x++) {
    const thick = Math.max(2, 6 - Math.round(x / 46));
    for (let y = boughY(x); y < boughY(x) + thick; y++) {
      put(x, y, y === boughY(x) ? bark.light : y === boughY(x) + thick - 1 ? bark.shade : bark.mid);
    }
  }
  for (let cluster = 0; cluster < 44; cluster++) {
    const cx = 14 + Math.floor(hash(cluster * 37) * 210);
    const top = boughY(cx) + 3;
    const wide = 4 + Math.floor(hash(cluster * 13) * 4);
    const deep = 6 + Math.floor(hash(cluster * 91) * 7);
    for (let dy = 0; dy < deep; dy++) {
      const half = Math.max(1, Math.round(wide * Math.sin(((dy + 0.6) / deep) * Math.PI)));
      for (let dx = -half; dx <= half; dx++) {
        if (winter && hash((cx + dx) * 7 + dy * 31) > 0.26) continue;
        put(cx + dx, top + dy, dy < 2 || dx < -half + 2 ? crown.light : crown.mid);
      }
    }
  }


  skyLight(key, put, BLOSSOM.sun, BLOSSOM.moon, BLOSSOM_HORIZON);
  return buffer;
};

/** Petals coming down, in spring only (SPEC §22.8). Held still by reduced
 *  motion like every other living touch. */
export const renderBlossomLive = (ctx: SceneContext, nowMs: number, key: BackdropKey): void => {
  if (key.season !== "spring") return;
  ctx.fillStyle = "#f2c2d8";
  for (let index = 0; index < 20; index++) {
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
// One enormous silhouette and a lake beneath it. Already the most distinct
// shape in the set, so the composition is left alone.

export const MOUNTAIN_HORIZON = 96;

export const MOUNTAIN = {
  shore: {
    spring: [
      [72, 78, 76],
      [96, 100, 94],
      [122, 122, 112],
    ],
    summer: [
      [78, 82, 76],
      [102, 104, 94],
      [130, 128, 114],
    ],
    autumn: [
      [74, 68, 58],
      [98, 88, 72],
      [124, 110, 90],
    ],
    winter: SNOW_RAMP,
  } as Record<Season, readonly [RGB, RGB, RGB]>,
  pebble: ramp([84, 82, 76]),
  boulder: ramp([104, 100, 96]),
  scrub: ramp([92, 104, 78], 0.8),
  boat: ramp([148, 130, 104]),
  post: ramp([124, 108, 88]),
  reed: ramp([104, 116, 82], 0.9),
  shadow: [58, 62, 62] as RGB,
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
  sun: [148, 144, 122] as RGB,
  moon: [72, 84, 104] as RGB,
};

const FUJI = { centre: 130, peak: 76, slope: 0.58, summit: 7, snowline: 34 } as const;

// Two ranks of ridges, scalloped rather than stepped: a silhouette built out
// of `Math.floor(x / n) % m` draws rectangular blocks, which read as a wall
// with crenellations instead of hills behind a lake.
const farRidgeAt = (sx: number): number => 12 + Math.floor(Math.abs(((sx + 13) % 46) - 23) / 3);
const nearRidgeAt = (sx: number): number => 6 + Math.floor(Math.abs(((sx + 31) % 34) - 17) / 4);

/** The ridges, and the cone standing well above them. */
export const mountainHorizonAt = (sx: number): number => {
  const fromCentre = Math.abs(sx - FUJI.centre);
  // A summit that is flat and a little wide, which is what stops the cone
  // reading as a triangle.
  const cone = FUJI.peak - Math.max(0, fromCentre - FUJI.summit) * FUJI.slope;
  return Math.max(farRidgeAt(sx), Math.round(cone));
};

/** Where the near shore takes over from the lake. */
const LAKE_BOTTOM = MOUNTAIN_HORIZON + 40;

export const composeMountain = (key: BackdropKey): Uint8ClampedArray => {
  const { buffer, put } = makeBuffer();
  const worn = (color: RGB): RGB => wear(color, key.condition);
  const winter = key.season === "winter";

  paintSky(key, put, MOUNTAIN_HORIZON);

  // The cone first, then the ridges in front of it: the near range overlaps
  // the mountain's foot, which is what puts it *behind* them.
  const snowline = winter ? 46 : FUJI.snowline;
  for (let x = 0; x < ROOM_WIDTH; x++) {
    const cone = mountainHorizonAt(x);
    // Snow lies lower in some gullies than others, so the line wanders by
    // column before it is dithered. A snowline that is only dithered is
    // still a ruled line — it just has a checkered edge.
    const wander = hash(x * 7) * 6 - 3;
    for (let y = MOUNTAIN_HORIZON - cone; y < MOUNTAIN_HORIZON; y++) {
      const capped = MOUNTAIN_HORIZON - y > snowline + wander - threshold(x, y, 1) * 5;
      // The sunward face, handed over across a dithered band rather than a
      // hard seam down the middle of the cone.
      const lit = (FUJI.centre + 7 - x) / 14 > threshold(x, y, 3);
      if (capped) put(x, y, worn(lit ? MOUNTAIN.snowCap : MOUNTAIN.snowShade));
      else put(x, y, worn(lit ? MOUNTAIN.rockLight : MOUNTAIN.rock));
    }
  }
  for (let x = 0; x < ROOM_WIDTH; x++) {
    for (let y = MOUNTAIN_HORIZON - farRidgeAt(x); y < MOUNTAIN_HORIZON; y++) put(x, y, worn(MOUNTAIN.ridgeFar));
    for (let y = MOUNTAIN_HORIZON - nearRidgeAt(x); y < MOUNTAIN_HORIZON; y++) put(x, y, worn(MOUNTAIN.ridgeNear));
  }

  const shore = MOUNTAIN.shore[key.season];
  bands(
    put,
    MOUNTAIN_HORIZON,
    ROOM_HEIGHT,
    [
      { until: LAKE_BOTTOM + 18, color: worn(shore[2]) },
      { until: LAKE_BOTTOM + 48, color: worn(shore[1]) },
      { until: ROOM_HEIGHT, color: worn(shore[0]) },
    ],
    12,
  );

  // The lake, and the mountain lying upside down in it.
  const water = MOUNTAIN.lake.map(worn);
  for (let y = MOUNTAIN_HORIZON; y < LAKE_BOTTOM; y++) {
    const t = (y - MOUNTAIN_HORIZON) / (LAKE_BOTTOM - MOUNTAIN_HORIZON);
    for (let x = 0; x < ROOM_WIDTH; x++) {
      let color = winter ? worn(MOUNTAIN.lakeIce) : pickRamp(water, t, x, y);
      // The lake is shallower than the mountain is tall, so the image is
      // squashed two-to-one: `mirrored` is the height up the cone this row
      // is showing.
      const depth = y - MOUNTAIN_HORIZON;
      const mirrored = depth * 2;
      if (!winter && mirrored < mountainHorizonAt(x)) {
        // Broken into bands and fading with distance from the shoreline, the
        // way a reflection on water that is moving at all actually behaves.
        const settled = depth % 5 !== 4 && threshold(x, y, 2) > depth / 30;
        if (settled) color = worn(mirrored > snowline ? MOUNTAIN.reflectSnow : MOUNTAIN.reflectRock);
      }
      put(x, y, color);
    }
  }

  // A shingle shore: boulders, gravel and hardy scrub, each thing grounded
  // by its own shadow rather than floating on a flat plane of colour.
  const tone = (r: Ramp): Ramp => ({ light: worn(r.light), mid: worn(r.mid), shade: worn(r.shade) });
  // Reeds at the waterline, so the lake has an edge rather than a cut.
  const reeds = winter ? tone(WINTER_COVER) : tone(MOUNTAIN.reed);
  for (let index = 0; index < 30; index++) {
    const x = 3 + Math.floor(hash(index * 149) * (ROOM_WIDTH - 6));
    tuft(put, x, LAKE_BOTTOM + 2, 4 + Math.floor(hash(index * 53) * 7), reeds, index);
  }

  const scrub = winter ? tone(WINTER_COVER) : tone(MOUNTAIN.scrub);
  scatter(LAKE_BOTTOM + 2, ROOM_HEIGHT - 2, 110, 0x5c2b, (x, y, depth, index) => {
    tuft(put, x, y, 2 + Math.round(depth * 5), scrub, index + x);
  });
  scatter(LAKE_BOTTOM + 2, ROOM_HEIGHT - 4, 70, 0x9e11, (x, y, depth) => {
    pebble(put, x, y, 1 + Math.round(depth * 3), tone(MOUNTAIN.pebble), worn(MOUNTAIN.shadow));
  });
  for (const [bx, by, half] of [[46, 182, 11], [214, 170, 8], [132, 196, 7], [92, 166, 6]] as const) {
    pebble(put, bx, by, half, tone(MOUNTAIN.boulder), worn(MOUNTAIN.shadow));
  }

  // A weathered marker post, leaning, with its guy rope — the one piece of
  // human scale on an otherwise geological shore.
  const post = tone(MOUNTAIN.post);
  shadowStrip(put, 176, 190, 12, 3, worn(MOUNTAIN.shadow));
  for (let dy = 0; dy < 34; dy++) {
    const x = 180 + Math.round(dy / 14);
    put(x, 190 - dy, post.light);
    put(x + 1, 190 - dy, post.mid);
    put(x + 2, 190 - dy, post.shade);
  }
  for (let dx = 0; dx < 14; dx++) put(168 + dx, 176 + Math.round(dx * 0.8), post.mid);


    // A boat out on the water and birds over the ridges: the lake is only as
  // big as the smallest thing you can see floating on it.
  if (!winter) {
    const hull = tone(MOUNTAIN.boat);
    const boatY = MOUNTAIN_HORIZON + 18;
    for (let dx = -8; dx <= 8; dx++) {
      const sheer = Math.round((dx / 8) ** 2 * 3);
      put(168 + dx, boatY + sheer, hull.light);
      put(168 + dx, boatY + sheer + 1, hull.mid);
      put(168 + dx, boatY + sheer + 2, hull.shade);
    }
    for (let dy = 0; dy < 5; dy++) put(165, boatY - 5 + dy, dy < 2 ? hull.light : hull.mid);
    for (let dx = -6; dx <= 6; dx += 3) put(168 + dx, boatY + 6, worn(MOUNTAIN.reflectRock));
  }
  if (!isDark(key.segment)) {
    for (const [gx, gy, span] of [[74, 32, 3], [86, 39, 2], [214, 26, 2]] as const) {
      for (let i = 0; i < span; i++) {
        put(gx - i, gy + i, worn(MOUNTAIN.ridgeNear));
        put(gx + i, gy + i, worn(MOUNTAIN.ridgeNear));
      }
    }
  }

  skyLight(key, put, MOUNTAIN.sun, MOUNTAIN.moon, LAKE_BOTTOM);
  return buffer;
};
