// The family wall (SPEC §22.10): every Makoto that has died, framed on the
// home wall with a plaque, largest and most recent first, fading toward
// sepia the further back it hangs. The picture is the generated portrait
// (scripts/art/ancestors.ts); the frames and plates are furniture, drawn as
// rects the way the picture's moulding is (§22.3).

import type { SceneContext } from "../engine/digest";
import { lay, makeCanvas } from "../engine/offscreen";
import { drawTiny, TINY_HEIGHT, TINY_PITCH, tinyGlyphs } from "../engine/tinyfont";
import { ANCESTOR_PALETTE, ANCESTOR_PICTURES } from "./ancestors.generated";

/** A sealed generation as the wall needs it: which one, and what it was called. */
export type Ancestor = { ordinal: number; name: string };

export type WallSlot = {
  /** The picture's size; the frame adds MOULDING on every side. */
  art: number;
  /** The frame's outer top-left corner. */
  x: number;
  y: number;
  /** The widest plate this slot's stretch of wall allows. */
  plaque: number;
  /** How far the picture is blended toward sepia, 0 to 1. */
  fade: number;
  /** Where the plate hangs. Below unless the pet's head would cover it there. */
  plate?: "above";
};

export const MOULDING = 2;
/** The plate's padding around the engraving, and its height. */
const PLATE_PAD = 2;
export const PLATE_HEIGHT = TINY_HEIGHT + 2;
/** Between the frame's bottom edge and the plate. */
const PLATE_GAP = 2;

/**
 * Where each ancestor hangs, parent first (SPEC §22.10's table). The pet
 * stands in front of the middle of the wall, so the pictures keep to the
 * side columns and the strip above her head: the parent high beside the
 * window, the grandparent between the picture and the window — at her head
 * height, so its plate goes over the frame where nothing reaches — and the
 * rest down the two edges.
 */
export const WALL_SLOTS: readonly WallSlot[] = [
  { art: 32, x: 222, y: 6, plaque: 36, fade: 0 },
  { art: 24, x: 108, y: 13, plaque: 52, fade: 0.3, plate: "above" },
  { art: 20, x: 8, y: 14, plaque: 32, fade: 0.5 },
  { art: 16, x: 10, y: 52, plaque: 28, fade: 0.65 },
  { art: 16, x: 230, y: 54, plaque: 28, fade: 0.8 },
];

/** How many characters a plate this wide can carry. */
export const plaqueCapacity = (plaqueWidth: number): number => Math.floor((plaqueWidth - PLATE_PAD * 2 + 1) / TINY_PITCH);

/** The engraving: the name in capitals, cut to what the slot's plate can hold. */
export const engraving = (name: string, slot: WallSlot): string =>
  tinyGlyphs(name).slice(0, plaqueCapacity(slot.plaque)).join("");

const plateWidth = (text: string, slot: WallSlot): number => {
  const glyphs = tinyGlyphs(text).length;
  const engraved = glyphs === 0 ? 0 : glyphs * TINY_PITCH - 1 + PLATE_PAD * 2;
  return Math.max(slot.art + MOULDING * 2, engraved);
};

type RGB = readonly [number, number, number];

/** A colour part-way toward the same colour as an old photograph would hold it. */
const sepia = (colour: RGB, fade: number): RGB => {
  const light = 0.3 * colour[0] + 0.59 * colour[1] + 0.11 * colour[2];
  const aged: RGB = [Math.min(255, light * 1.07 + 20), Math.min(255, light * 0.93 + 8), light * 0.68];
  return [0, 1, 2].map((channel) => Math.round(colour[channel]! + (aged[channel]! - colour[channel]!) * fade)) as unknown as RGB;
};

/**
 * The picture for a slot as RGBA, faded for that slot. A ragged row or a
 * letter with no colour means the generated file and this reader have come
 * apart; it throws here, where ancestors.test.ts reads every slot on every
 * run, rather than hanging a picture with a hole in it.
 */
export const compile = (slot: WallSlot): Uint8ClampedArray => {
  const picture = ANCESTOR_PICTURES.find((candidate) => candidate.size === slot.art);
  if (!picture) throw new Error(`no ancestor portrait is generated at ${slot.art} pixels`);
  const faded = new Map<string, RGB>();
  const buffer = new Uint8ClampedArray(slot.art * slot.art * 4);
  picture.rows.forEach((row, y) => {
    if (row.length !== slot.art) throw new Error(`ancestor portrait ${slot.art} row ${y} is ${row.length} wide`);
    for (let x = 0; x < slot.art; x++) {
      const letter = row[x]!;
      let colour = faded.get(letter);
      if (!colour) {
        const base = ANCESTOR_PALETTE[letter];
        if (!base) throw new Error(`ancestor portrait uses '${letter}' at ${x},${y}, which is not in the palette`);
        colour = sepia(base, slot.fade);
        faded.set(letter, colour);
      }
      buffer.set([colour[0], colour[1], colour[2], 255], (y * slot.art + x) * 4);
    }
  });
  return buffer;
};

/** The picture's moulding (SPEC §22.3), lit along its top and left. */
const FRAME = { face: "#6a5238", light: "#8a6d4a", shade: "#4a3828" } as const;
const PLATE = { brass: "#b08c46", light: "#d6b464", engraving: "#46321a" } as const;

/**
 * The wall itself. Pictures are compiled and cached per slot on first use —
 * the room paints twice a frame (§10.1), and a 32-pixel picture is a
 * thousand rectangles if it is not one blit.
 */
export class FamilyWall {
  private readonly pixels = new Map<number, Uint8ClampedArray>();
  private readonly canvases = new Map<number, HTMLCanvasElement | null>();

  render(ctx: SceneContext, ancestors: readonly Ancestor[]): void {
    WALL_SLOTS.forEach((slot, index) => {
      const ancestor = ancestors[index];
      if (!ancestor) return;
      this.renderFrame(ctx, slot);
      this.renderPicture(ctx, slot, index);
      this.renderPlate(ctx, slot, ancestor.name);
    });
  }

  private renderFrame(ctx: SceneContext, slot: WallSlot): void {
    const outer = slot.art + MOULDING * 2;
    const px = (x: number, y: number, w: number, h: number, colour: string): void => {
      ctx.fillStyle = colour;
      ctx.fillRect(x, y, w, h);
    };
    px(slot.x, slot.y, outer, outer, FRAME.face);
    px(slot.x, slot.y, outer, 1, FRAME.light);
    px(slot.x, slot.y, 1, outer, FRAME.light);
    px(slot.x, slot.y + outer - 1, outer, 1, FRAME.shade);
    px(slot.x + outer - 1, slot.y, 1, outer, FRAME.shade);
  }

  private renderPicture(ctx: SceneContext, slot: WallSlot, index: number): void {
    const x = slot.x + MOULDING;
    const y = slot.y + MOULDING;
    let pixels = this.pixels.get(index);
    if (!pixels) {
      pixels = compile(slot);
      this.pixels.set(index, pixels);
    }
    if (!this.canvases.has(index)) {
      const canvas = makeCanvas(slot.art, slot.art);
      const target = canvas?.getContext("2d");
      if (canvas && target) lay(target, pixels, slot.art, slot.art);
      this.canvases.set(index, canvas && target ? canvas : null);
    }
    const canvas = this.canvases.get(index);
    if (canvas) {
      ctx.drawImage(canvas, x, y);
      return;
    }
    // No document to cache onto (the tests), or a browser out of contexts —
    // the picture still has to land.
    lay(ctx, pixels, slot.art, slot.art, x, y);
  }

  private renderPlate(ctx: SceneContext, slot: WallSlot, name: string): void {
    const text = engraving(name, slot);
    const outer = slot.art + MOULDING * 2;
    const width = plateWidth(text, slot);
    const x = slot.x + Math.round((outer - width) / 2);
    const y = slot.plate === "above" ? slot.y - PLATE_GAP - PLATE_HEIGHT : slot.y + outer + PLATE_GAP;
    ctx.fillStyle = PLATE.brass;
    ctx.fillRect(x, y, width, PLATE_HEIGHT);
    ctx.fillStyle = PLATE.light;
    ctx.fillRect(x, y, width, 1);
    drawTiny(ctx, text, x + Math.round((width - (tinyGlyphs(text).length * TINY_PITCH - 1)) / 2), y + 1, PLATE.engraving);
  }
}
