import { type Season } from "@/sim/atmosphere";
import { ROOM_HEIGHT, ROOM_WIDTH, wear, type BackdropKey } from "../compose";
import { type RGB } from "../theme";
import { bands, castShadow, ramp, scatter, solid, tuft, type Ramp } from "../paint";
import { SNOW_RAMP, WINTER_COVER, column, makeBuffer, paintSky, skyLight } from "./shared";

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
