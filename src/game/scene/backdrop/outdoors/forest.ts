import { type Season } from "@/sim/atmosphere";
import { ROOM_HEIGHT, ROOM_WIDTH, isDark, skyRamp, threshold, wear, type BackdropKey } from "../compose";
import { type RGB } from "../theme";
import { bands, castShadow, haze, pebble, ramp, roots, scatter, tuft } from "../paint";
import { SNOW_RAMP, WINTER_COVER, hash, makeBuffer, paintSky, skyLight } from "./shared";

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
