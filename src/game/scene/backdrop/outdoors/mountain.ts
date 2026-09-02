import { type Season } from "@/sim/atmosphere";
import { ROOM_HEIGHT, ROOM_WIDTH, isDark, pickRamp, threshold, wear, type BackdropKey } from "../compose";
import { type RGB } from "../theme";
import { bands, pebble, ramp, scatter, shadowStrip, tuft, type Ramp } from "../paint";
import { SNOW_RAMP, WINTER_COVER, hash, makeBuffer, paintSky, skyLight } from "./shared";

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
