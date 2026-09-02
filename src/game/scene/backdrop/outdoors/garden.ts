import { type Season } from "@/sim/atmosphere";
import { ROOM_HEIGHT, ROOM_WIDTH, wear, type BackdropKey } from "../compose";
import { type RGB } from "../theme";
import { bands, pebble, ramp, scatter, shadowStrip, solid, tuft, type Ramp } from "../paint";
import { SNOW_RAMP, WINTER_COVER, hash, makeBuffer, paintSky, skyLight } from "./shared";

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
