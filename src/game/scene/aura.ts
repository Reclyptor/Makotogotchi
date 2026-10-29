// Style A, "Atom Ki": the aura of the second meditation day (SPEC §2.8,
// §21.9). What it is made of, where every piece of it stands, and how it is
// drawn; the room injects it as the painter it calls around the pet sprite
// and owns nothing else about it, so the look lives in one place.
//
// Two things make it up. A flame of energy behind the seated pet — four
// sprite frames, art/pet/auraFlame1..4@1x.png, whose licks roll upward and
// whose tongues over the ears and head rise and fall. And six motes on three
// tilted orbits around the body, like electrons around a nucleus: each ring
// is an ellipse seen a little from above, so the lower arc passes in front of
// the pet and the upper arc behind, and a mote slips out from behind one
// shoulder, crosses the chest, and vanishes behind the other.
//
// Everything is placed in the pet's own art cells, the packer's 5.5-px
// cadence (scripts/atlas.ts), so the aura's pixels are the same size as
// Makoto's and sit on the same grid. The flame's canvas pads the meditate
// frames by an even number of cells on every side, which is what lets a
// bottom-centre blit of it land cell for cell on the pet.
//
// Both halves draw where the room puts the pet: x = 0 its centre column,
// y = 0 the room's top, the foot at PET_Y, inside the pet's mirror but at
// unit scale, so everything here is laid down at `scale` as the sprite is.
// Time is one AURA_PERIOD_MS cycle that every sub-period divides, so the
// loop closes without a seam; under reduced motion the cycle's start is the
// still frame.

import type { SceneContext } from "../engine/digest";
import { drawRect } from "../engine/placement";
import { SPRITE_FRAMES, type FrameName } from "../atlas.generated";
import { PET_Y, type AuraPainter } from "./auraTypes";

type AuraLayer = "behind" | "front";

/** One cycle of the whole aura; the flame and every ring come round in it. */
export const AURA_PERIOD_MS = 16800;

/** One logical art pixel in room pixels at scale 1: the packer's 5.5 cadence. */
const CELL = 5.5;

/** Where cell `cell` of a @1x frame begins, in room pixels from the
 *  frame's top-left at `scale` — the same rounding the packer upscales by. */
const cellEdge = (cell: number, scale: number): number => Math.round(cell * CELL * scale);

const phaseAt = (nowMs: number, reducedMotion: boolean): number =>
  reducedMotion ? 0 : (((nowMs / AURA_PERIOD_MS) % 1) + 1) % 1;

// ── the flame ───────────────────────────────────────────────────────────────

const FLAME_FRAMES = ["auraFlame1", "auraFlame2", "auraFlame3", "auraFlame4"] as const satisfies readonly FrameName[];

/** How long each flame frame holds; four of them make one flicker. */
const FLAME_MS = 140;

/**
 * Room pixels, at scale 1, that the flame's bottom-centre sits below the
 * foot anchor: two cells of energy pooled under the seat. Even, so the
 * blit's rounding keeps the flame on the pet's grid.
 */
const FLAME_DROP = 11;

const flameFrameAt = (phase: number): FrameName => {
  const step = Math.floor((phase * AURA_PERIOD_MS) / FLAME_MS) % FLAME_FRAMES.length;
  return FLAME_FRAMES[step] ?? FLAME_FRAMES[0];
};

// ── the motes ───────────────────────────────────────────────────────────────

// A white, nearly colourless ki — think a mystic's aura rather than a blue
// flame: white licks against the outline, an off-white body, and only the
// very edge carrying a faint cool tint, which is what separates it from the
// white beard and belly. The flame sprites are painted in the same three;
// the fourth, deeper value is for motes on the far side.
export const AURA_TONES = {
  dim: "#b4cfe6",
  mid: "#ecf3fa",
  core: "#ffffff",
  shadow: "#8eb0cc",
} as const;

/**
 * A mote's tones at either depth: the centre of its head, the four arms of
 * the plus around it, and the three tail cells behind it, nearest first. The
 * arms are what keep a head readable across the belly's white, where its
 * centre vanishes, and across the flame, where a far mote's centre does.
 */
const MOTE_TONES: Record<AuraLayer, { centre: string; arms: string; tail: readonly [string, string, string] }> = {
  front: { centre: AURA_TONES.core, arms: AURA_TONES.dim, tail: [AURA_TONES.mid, AURA_TONES.dim, AURA_TONES.shadow] },
  behind: { centre: AURA_TONES.mid, arms: AURA_TONES.shadow, tail: [AURA_TONES.dim, AURA_TONES.shadow, AURA_TONES.shadow] },
};

const ARMS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const;

type Ring = {
  /** Semi-axes in cells: along the ring's own line, and across it as the tilt foreshortens it. */
  a: number;
  b: number;
  /** The ring's line, as an angle from horizontal; the lower side is the near side. */
  tilt: number;
  /** Turns per AURA_PERIOD_MS cycle — a whole number, so the loop closes. */
  turns: number;
  direction: 1 | -1;
  /** Where the first mote rests at phase 0; the second sits half a turn behind. */
  phase: number;
};

/** The orbits' common centre: the chest of the seated pose, in meditate1's cells. */
const CENTRE = { x: 12.5, y: 16.5 };

// Wide enough that every orbit swings well clear of the flame at its ends,
// so a mote is seen against the room before it crosses the body. Periods of
// 2800, 3360 and 4200 ms.
const RINGS: readonly Ring[] = [
  { a: 20, b: 5, tilt: -0.5, turns: 6, direction: 1, phase: 0.9 },
  { a: 20, b: 5, tilt: 0.5, turns: 5, direction: -1, phase: 2.6 },
  { a: 21, b: 6.5, tilt: 0, turns: 4, direction: 1, phase: 4.4 },
];

const MOTES_PER_RING = 2;
/** Cells drawn behind each head, as earlier points on the same orbit. */
const TRAIL = 3;
const TRAIL_STEP = 0.2;

export type AuraVisitor = (cellX: number, cellY: number, color: string) => void;

/**
 * Walks every mote cell at `phase` that sits on `layer`: each mote's tail
 * cells, then the arms of its head, then the head's centre, so what is drawn
 * last wins the cell. Cells are in the meditate frame's own grid — column and
 * row from its top-left, negative or past its edge where an orbit swings
 * wide — and each carries its own depth, so a mote half way out from behind a
 * shoulder has its head in front and its tail still behind.
 */
export const eachMoteCell = (phase: number, layer: AuraLayer, visit: AuraVisitor): void => {
  const tones = MOTE_TONES[layer];
  for (const ring of RINGS) {
    const turn = phase * ring.turns * Math.PI * 2 * ring.direction;
    const cos = Math.cos(ring.tilt);
    const sin = Math.sin(ring.tilt);
    for (let mote = 0; mote < MOTES_PER_RING; mote++) {
      const head = ring.phase + turn + mote * Math.PI;
      let lastX = NaN;
      let lastY = NaN;
      for (let back = TRAIL; back >= 0; back--) {
        const angle = head - back * TRAIL_STEP * ring.direction;
        if ((Math.sin(angle) > 0 ? "front" : "behind") !== layer) continue;
        const along = Math.cos(angle) * ring.a;
        const across = Math.sin(angle) * ring.b;
        const cellX = Math.floor(CENTRE.x + along * cos - across * sin);
        const cellY = Math.floor(CENTRE.y + along * sin + across * cos);
        if (cellX === lastX && cellY === lastY) continue;
        lastX = cellX;
        lastY = cellY;
        if (back > 0) {
          visit(cellX, cellY, tones.tail[back - 1]!);
          continue;
        }
        for (const [dx, dy] of ARMS) visit(cellX + dx, cellY + dy, tones.arms);
        visit(cellX, cellY, tones.centre);
      }
    }
  }
};

/** The motes of one depth, as cells of the meditate frame's grid where the room put it. */
const drawMotes = (ctx: SceneContext, layer: AuraLayer, phase: number, scale: number): void => {
  // Both breaths share a canvas, so either frame's rectangle is the grid's.
  const origin = drawRect(SPRITE_FRAMES.meditate1, 0, PET_Y, scale);
  eachMoteCell(phase, layer, (cellX, cellY, color) => {
    const x = origin.dx + cellEdge(cellX, scale);
    const y = origin.dy + cellEdge(cellY, scale);
    ctx.fillStyle = color;
    ctx.fillRect(x, y, origin.dx + cellEdge(cellX + 1, scale) - x, origin.dy + cellEdge(cellY + 1, scale) - y);
  });
};

export const AURA: AuraPainter = {
  /** The half behind the pet: the flame, and the motes on the far side of their orbits. */
  behind: (ctx, atlas, _frame, nowMs, scale, reducedMotion) => {
    const phase = phaseAt(nowMs, reducedMotion);
    atlas.draw(ctx, flameFrameAt(phase), 0, PET_Y + FLAME_DROP * scale, scale);
    drawMotes(ctx, "behind", phase, scale);
  },
  /** The half in front of the pet and whatever its head wears: the near-side motes. */
  front: (ctx, _atlas, _frame, nowMs, scale, reducedMotion) => {
    drawMotes(ctx, "front", phaseAt(nowMs, reducedMotion), scale);
  },
};
