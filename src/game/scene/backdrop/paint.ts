// The drawing vocabulary the venues are built from (SPEC §22.6).
//
// These exist because the first two passes at the outdoor scenes broke the
// same craft rules over and over, each venue in its own way. Encoding the
// rules as primitives is what stops that: a venue composes `solid` and
// `tuft` and `castShadow` and gets form shading, hue-shifted ramps, cast
// shadows and clustered texture for free, rather than each scene
// re-deciding them and re-deciding them wrong.
//
// The four rules that were being broken, and what fixes each:
//
//   • **Pillow shading.** Objects were lit by distance from their outline —
//     a 1px highlight along the top edge whatever the form. `solid` shades
//     by face instead: one light direction, a lit face, a mid face and a
//     shadow face.
//   • **No hue travel.** Ramps were one hue made lighter and darker, which
//     reads as dirty. `ramp` drifts shadows cooler and highlights warmer.
//   • **Dither everywhere.** A gradient stippled edge to edge is noise with
//     nowhere for the eye to rest. `band` keeps each region flat and
//     dithers only the seam between regions.
//   • **Orphan pixels.** Texture was single scattered pixels, which read as
//     rendering faults. `tuft` and `scatter` place 2–4px clusters.

import { mix, type RGB } from "./theme";
import { ROOM_WIDTH, threshold } from "./compose";

export type Put = (x: number, y: number, color: RGB) => void;

/** A three-value form ramp: the lit face, the body, and the shadow face. */
export type Ramp = { light: RGB; mid: RGB; shade: RGB };

const COOL: RGB = [70, 96, 150];
const WARM: RGB = [255, 214, 150];

/**
 * A form ramp from one base colour. Shadows drift toward a cool blue and
 * highlights toward a warm cream rather than simply scaling the value —
 * a ramp with no hue travel is what makes pixel art look muddy.
 */
const round = (color: RGB): RGB => [Math.round(color[0]), Math.round(color[1]), Math.round(color[2])];

export const ramp = (base: RGB, spread = 1): Ramp => ({
  // Rounded, because these end up in a Uint8ClampedArray either way: a
  // palette entry carrying 236.4 never byte-matches the 236 that lands in
  // the buffer, and the readability check compares the two.
  light: round(mix(base, WARM, 0.26 * spread)),
  mid: round(base),
  shade: round(mix(base, COOL, 0.3 * spread)),
});

/** Push a colour toward the sky with distance — atmospheric perspective is
 *  most of what separates a far hill from a near one. */
export const haze = (color: RGB, sky: RGB, amount: number): RGB => round(mix(color, sky, amount));

/**
 * A deeper, cooler version for the darkest accents — hollows, cast shade.
 * Used to author palette constants, never called mid-render: every colour a
 * venue can paint below its horizon has to be declared, so the readability
 * check can enumerate them (SPEC §22.6).
 */
export const deepen = (color: RGB, amount = 0.4): RGB => round(mix(mix(color, COOL, amount), [0, 0, 0], amount * 0.5));

/** Every colour a ramp can paint, for palette enumeration. */
export const tones = (tone: Ramp): RGB[] => [tone.light, tone.mid, tone.shade];

export type Rect = { x: number; y: number; w: number; h: number };

/**
 * A shaded rectangular solid, lit from the upper left. Three faces, not a
 * fill with a highlight stripe: the top two rows are the lit plane, the
 * left column catches the same light, and the right and bottom edges fall
 * into shadow. `inset` leaves the interior flat so the eye has somewhere to
 * rest instead of reading every pixel as detail.
 */
export const solid = (put: Put, rect: Rect, tone: Ramp): void => {
  for (let y = rect.y; y < rect.y + rect.h; y++) {
    for (let x = rect.x; x < rect.x + rect.w; x++) {
      const fromTop = y - rect.y;
      const fromLeft = x - rect.x;
      const fromRight = rect.x + rect.w - 1 - x;
      const fromBottom = rect.y + rect.h - 1 - y;
      const lit = fromTop < 2 || fromLeft < 2;
      const dark = fromRight < 2 || fromBottom < 1;
      put(x, y, dark && !lit ? tone.shade : lit ? tone.light : tone.mid);
    }
  }
};

/**
 * The shadow an object throws on the ground. Nothing grounds a prop like
 * this — without it every object in the scene looks pasted on rather than
 * standing in it. Squashed, offset away from the light, and dithered at the
 * rim so it has no hard edge.
 */
export const castShadow = (put: Put, cx: number, groundY: number, halfW: number, shade: RGB): void => {
  const halfH = Math.max(1, Math.round(halfW * 0.34));
  for (let dy = -halfH; dy <= halfH; dy++) {
    for (let dx = -halfW; dx <= halfW; dx++) {
      const d = (dx / halfW) ** 2 + (dy / halfH) ** 2;
      if (d > 1) continue;
      // The rim breaks up rather than ending on a hard ellipse.
      if (d > 0.55 && threshold(cx + dx, groundY + dy, 2) < (d - 0.55) / 0.45) continue;
      put(cx + dx + Math.round(halfW * 0.28), groundY + dy, shade);
    }
  }
};

/**
 * The shadow a broad flat object throws: a shallow strip hugging its near
 * edge, offset away from the light. `castShadow`'s ellipse is for compact
 * objects — scaled to something as wide as a garden bed it becomes sixty
 * rows tall and swallows the ground it was meant to sit on.
 */
export const shadowStrip = (put: Put, x: number, y: number, w: number, depth: number, shade: RGB): void => {
  for (let dy = 0; dy < depth; dy++) {
    const inset = Math.round((dy / depth) * 3);
    for (let dx = inset; dx < w + 3 - inset; dx++) {
      if (threshold(x + dx, y + dy, 2) < (dy / depth) * 0.8) continue;
      put(x + dx + 2, y + dy, shade);
    }
  }
};

export type Band = { until: number; color: RGB };

/**
 * Ground laid down as flat regions with dithered seams, rather than one
 * gradient stippled from top to bottom. Large flat areas are what let the
 * detail read; a surface that is dithered everywhere is a field of noise
 * with props sitting on it.
 *
 * `seam` is how many rows either side of a boundary get the transition.
 */
export const bands = (put: Put, from: number, to: number, list: readonly Band[], seam = 5): void => {
  for (let y = from; y < to; y++) {
    let index = list.findIndex((entry) => y < entry.until);
    if (index === -1) index = list.length - 1;
    const current = list[index]!;
    const next = list[Math.min(index + 1, list.length - 1)]!;
    const untilSeam = current.until - y;
    for (let x = 0; x < ROOM_WIDTH; x++) {
      const blending = untilSeam <= seam && next !== current;
      const color = blending && threshold(x, y, 1) < (seam - untilSeam) / seam ? next.color : current.color;
      put(x, y, color);
    }
  }
};

/**
 * A clump of ground cover — grass, ferns, leaf litter. Always a cluster of
 * a few pixels, never a lone one: a single scattered pixel reads as a dead
 * pixel rather than as a plant.
 *
 * `variant` picks between four silhouettes. One shape repeated across a
 * field is the defect this replaces — two hundred identical triangles read
 * as tiling, not as undergrowth, and the eye finds the repeat instantly.
 */
export const tuft = (put: Put, x: number, y: number, size: number, tone: Ramp, variant = 0): void => {
  const tall = Math.max(2, size);
  const blade = (dx: number, height: number, lean: number): void => {
    for (let dy = 0; dy < height; dy++) {
      const offset = Math.round((lean * dy) / Math.max(1, height));
      const value = dy === height - 1 ? tone.light : lean > 0 ? tone.shade : tone.mid;
      put(x + dx + offset, y - dy, value);
    }
  };
  switch (variant & 3) {
    case 0: // a splayed clump, blades falling either way
      blade(0, tall, 0);
      blade(-1, Math.max(2, tall - 2), -1);
      blade(1, Math.max(2, tall - 1), 1);
      break;
    case 1: // leaning, as if combed by wind
      blade(0, tall, 2);
      blade(-1, Math.max(2, tall - 3), 1);
      break;
    case 2: // a low, wide cushion
      for (let dx = -Math.max(1, Math.round(tall / 2)); dx <= Math.max(1, Math.round(tall / 2)); dx++) {
        const height = Math.max(1, Math.round(tall / 2) - Math.abs(dx) + 1);
        for (let dy = 0; dy < height; dy++) put(x + dx, y - dy, dy === height - 1 ? tone.light : tone.mid);
      }
      break;
    default: // two tall blades with a gap, the sparsest reading
      blade(-1, tall, -1);
      blade(2, Math.max(2, tall - 1), 1);
  }
};

/**
 * Roots flaring out of a trunk into the ground. Straight full-width bars
 * stacked down the trunk read as a staircase; these taper and break up, so
 * the trunk looks planted.
 */
export const roots = (put: Put, trunkX: number, width: number, groundY: number, tone: Ramp, seed: number): void => {
  for (const side of [-1, 1] as const) {
    for (let index = 0; index < 3; index++) {
      let h = Math.imul((index * 7919) ^ (seed + side * 31), 2654435761);
      h ^= h >>> 13;
      const reach = 6 + ((h >>> 0) % 11);
      const drop = 2 + ((h >>> 5) % 5) + index * 3;
      const from = side < 0 ? trunkX : trunkX + width - 1;
      for (let step = 0; step < reach; step++) {
        const t = step / reach;
        const x = from + side * step;
        const y = groundY - drop + Math.round(t * t * drop);
        const thick = Math.max(1, Math.round((1 - t) * 3));
        for (let dy = 0; dy < thick; dy++) put(x, y + dy, dy === 0 ? tone.mid : tone.shade);
      }
    }
  }
};

/** A small rounded stone, three tones, sitting on its own shadow. */
export const pebble = (put: Put, x: number, y: number, halfW: number, tone: Ramp, shadow?: RGB): void => {
  if (shadow) castShadow(put, x, y + 1, halfW + 1, shadow);
  const halfH = Math.max(1, Math.round(halfW * 0.7));
  for (let dy = -halfH; dy <= halfH; dy++) {
    const span = Math.round(halfW * Math.sqrt(Math.max(0, 1 - (dy / (halfH + 0.5)) ** 2)));
    for (let dx = -span; dx <= span; dx++) {
      const lit = dy < 0 && dx < span - 1;
      put(x + dx, y + dy, lit && dy <= -halfH + 1 ? tone.light : dx > span - 2 || dy === halfH ? tone.shade : tone.mid);
    }
  }
};

/**
 * Scatter clusters across a band with near-field density: things nearer the
 * viewer are larger and more numerous, which is the cheapest perspective
 * cue a flat ground can get.
 */
export const scatter = (
  from: number,
  to: number,
  count: number,
  seed: number,
  place: (x: number, y: number, size: number, index: number) => void,
): void => {
  for (let index = 0; index < count; index++) {
    let h = Math.imul((index * 2654435761) ^ seed, 2246822519);
    h ^= h >>> 13;
    const rx = ((h >>> 0) % 100_000) / 100_000;
    let g = Math.imul((index * 40503) ^ (seed + 7), 2654435761);
    g ^= g >>> 15;
    const ry = ((g >>> 0) % 100_000) / 100_000;
    // Bias toward the foreground, where the detail actually reads.
    const depth = ry ** 0.7;
    const y = Math.round(from + depth * (to - from));
    place(Math.round(rx * ROOM_WIDTH), y, depth, index);
  }
};
