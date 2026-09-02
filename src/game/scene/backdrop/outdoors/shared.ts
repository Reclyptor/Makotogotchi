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

import { BLEND_STEPS } from "@/sim/atmosphere";
import {
  isDark,
  pickRamp,
  ROOM_HEIGHT,
  ROOM_WIDTH,
  skyRamp,
  threshold,
  wear,
  type BackdropKey,
} from "../compose";
import type { RGB } from "../theme";
import { ramp } from "../paint";

/** The open ground span the pet may wander (before its own size insets). */
export const OUTDOOR_SPAN = { left: 20, right: ROOM_WIDTH - 20 } as const;

/** A small deterministic hash for feature placement — same field for every
 *  viewer, forever. */
export const hash = (n: number): number => {
  let h = Math.imul(n ^ 0x9e3779b9, 2654435761);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
};

/** Winter buries every outdoor ground the same way (SPEC §22.8). */
export const SNOW_RAMP: readonly [RGB, RGB, RGB] = [
  [186, 196, 214],
  [204, 214, 228],
  [222, 230, 242],
];

/** What ground cover looks like once snow has taken it: one declared ramp
 *  every venue reuses, rather than each deriving its own mid-render. */
export const WINTER_COVER = ramp(SNOW_RAMP[1], 0.8);

export type Put = (x: number, y: number, color: RGB) => void;

/** The full-bleed sky, with the same segment dissolve the window carries. */
export const paintSky = (key: BackdropKey, put: Put, horizonY: number): void => {
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
export const skyLight = (key: BackdropKey, put: Put, warm: RGB, cool: RGB, horizonY: number, to = ROOM_HEIGHT): void => {
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

export const makeBuffer = (): { buffer: Uint8ClampedArray; put: Put } => {
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
export const column = (put: Put, x: number, from: number, to: number, color: RGB): void => {
  for (let y = from; y < to; y++) put(x, y, color);
};
