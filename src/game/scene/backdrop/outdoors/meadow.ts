import { type Season } from "@/sim/atmosphere";
import { ROOM_HEIGHT, ROOM_WIDTH, isDark, skyRamp, threshold, wear, type BackdropKey } from "../compose";
import { type RGB } from "../theme";
import { bands, haze, pebble, ramp, scatter, tuft, type Ramp } from "../paint";
import { SNOW_RAMP, WINTER_COVER, column, hash, makeBuffer, paintSky, skyLight } from "./shared";

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
