import { type Season } from "@/sim/atmosphere";
import { ROOM_HEIGHT, ROOM_WIDTH, isDark, skyRamp, threshold, wear, type BackdropKey } from "../compose";
import { type RGB } from "../theme";
import { bands, haze, ramp, scatter, shadowStrip, solid, tuft, type Ramp } from "../paint";
import { type SceneContext } from "../../../engine/digest";
import { WINTER_COVER, hash, makeBuffer, paintSky, skyLight } from "./shared";

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
