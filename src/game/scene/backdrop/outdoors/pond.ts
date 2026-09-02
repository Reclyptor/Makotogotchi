import { type Season } from "@/sim/atmosphere";
import { ROOM_HEIGHT, ROOM_WIDTH, wear, type BackdropKey } from "../compose";
import { type RGB } from "../theme";
import { bands, castShadow, ramp, scatter, tuft, type Ramp } from "../paint";
import { type SceneContext } from "../../../engine/digest";
import { SNOW_RAMP, WINTER_COVER, hash, makeBuffer, paintSky, skyLight } from "./shared";

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
