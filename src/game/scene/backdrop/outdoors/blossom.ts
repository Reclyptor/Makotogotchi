import { type Season } from "@/sim/atmosphere";
import { ROOM_HEIGHT, ROOM_WIDTH, threshold, wear, type BackdropKey } from "../compose";
import { type RGB } from "../theme";
import { bands, castShadow, ramp, scatter, shadowStrip, solid, tuft, type Ramp } from "../paint";
import { type SceneContext } from "../../../engine/digest";
import { SNOW_RAMP, WINTER_COVER, hash, makeBuffer, paintSky, skyLight } from "./shared";

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
