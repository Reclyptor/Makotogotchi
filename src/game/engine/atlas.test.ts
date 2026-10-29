// The prop masks (SPEC §21.9): that the packer indexes the ones under art/
// and packs their pixels, and that the atlas clips an overlay by a mask in
// the frame's own pixels. A mask's sheet rectangle once indexed nothing but
// transparency — the packer placed it and never copied it — and the beard
// went on covering the cup with every test green, so the packed pixels are
// checked against the art itself.

import { readdirSync, readFileSync } from "node:fs";
import { PNG } from "pngjs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Atlas } from "./atlas";
import { drawRect, overlayOffset } from "./placement";
import type { SceneContext } from "./digest";
import { SPRITE_FRAMES, SPRITE_MASKS, SPRITE_SHEET_URL, type FrameName } from "../atlas.generated";
import { HEAD_ANCHORS } from "../scene/head";

const PET_ART = new URL("../../../art/pet/", import.meta.url);
const MASK_FILE = /^([a-zA-Z][a-zA-Z0-9]*)\.mask\.png$/;

/** A canvas whose 2D context records what was drawn on it, and with what compositing. */
const fakeCanvas = () => {
  const drawn: { args: unknown[]; composite: string }[] = [];
  const stack: string[] = [];
  const ctx = {
    globalCompositeOperation: "source-over",
    save() {
      stack.push(this.globalCompositeOperation);
    },
    restore() {
      this.globalCompositeOperation = stack.pop() ?? "source-over";
    },
    beginPath: () => {},
    rect: () => {},
    clip: () => {},
    clearRect: () => {},
    drawImage(...args: unknown[]) {
      drawn.push({ args, composite: this.globalCompositeOperation });
    },
  };
  return { canvas: { width: 0, height: 0, getContext: () => ctx }, drawn };
};

/** The room's context, reduced to the blits landing on it. */
const blitContext = () => {
  const blits: unknown[][] = [];
  return { ctx: { drawImage: (...args: unknown[]) => void blits.push(args) } as unknown as SceneContext, blits };
};

const SHEET_IMAGE = { sheet: true };
const loadedAtlas = (): Atlas => {
  const atlas = new Atlas();
  (atlas as unknown as { image: unknown }).image = SHEET_IMAGE;
  return atlas;
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the packed masks", () => {
  it("index exactly the frames with a mask beside them under art/pet", () => {
    const files = readdirSync(PET_ART).flatMap((file) => MASK_FILE.exec(file)?.[1] ?? []);
    expect(files.length).toBeGreaterThan(0);
    expect(Object.keys(SPRITE_MASKS).sort()).toEqual(files.sort());
  });

  it("are each the size of their frame, and carry the art's pixels onto the sheet", () => {
    const sheet = PNG.sync.read(readFileSync(new URL(`../../../public${SPRITE_SHEET_URL}`, import.meta.url)));
    for (const [name, mask] of Object.entries(SPRITE_MASKS)) {
      const frame = SPRITE_FRAMES[name as FrameName];
      expect({ w: mask.w, h: mask.h }, name).toEqual({ w: frame.w, h: frame.h });
      const art = PNG.sync.read(readFileSync(new URL(`${name}.mask.png`, PET_ART)));
      let opaque = 0;
      for (let y = 0; y < mask.h; y++) {
        for (let x = 0; x < mask.w; x++) {
          const packed = sheet.data[((mask.y + y) * sheet.width + mask.x + x) * 4 + 3]!;
          const drawn = art.data[(y * art.width + x) * 4 + 3]!;
          if (packed !== drawn) expect.fail(`${name} mask differs from its art at ${x},${y}`);
          if (drawn > 0) opaque += 1;
        }
      }
      expect(opaque, `${name} hides nothing`).toBeGreaterThan(0);
    }
  });
});

describe("an overlay behind a prop", () => {
  it("is placed in the frame's own pixels where the room hangs it", () => {
    // Measured off the art: the beard's 61×55 rectangle on the 115×138 front idle frame.
    const { beard } = HEAD_ANCHORS.idleFront1!;
    expect(overlayOffset(SPRITE_FRAMES.idleFront1, SPRITE_FRAMES.sageBeard, beard.x, beard.y)).toEqual({ x: 27, y: 55 });
  });

  it("is erased wherever the frame's mask is opaque, and lands where the plain draw would", () => {
    const strip = fakeCanvas();
    vi.stubGlobal("document", { createElement: () => strip.canvas });
    const atlas = loadedAtlas();
    const { ctx, blits } = blitContext();
    const { beard } = HEAD_ANCHORS.tea1!;
    atlas.drawOver(ctx, "sageBeard", beard.x, beard.y, "tea1");

    const overlay = SPRITE_FRAMES.sageBeard;
    const mask = SPRITE_MASKS.tea1!;
    const offset = overlayOffset(SPRITE_FRAMES.tea1, overlay, beard.x, beard.y);
    const slot = Object.keys(SPRITE_MASKS).indexOf("tea1") * overlay.w;
    expect(strip.drawn).toEqual([
      { args: [SHEET_IMAGE, overlay.x, overlay.y, overlay.w, overlay.h, slot, 0, overlay.w, overlay.h], composite: "source-over" },
      { args: [SHEET_IMAGE, mask.x, mask.y, mask.w, mask.h, slot - offset.x, -offset.y, mask.w, mask.h], composite: "destination-out" },
    ]);
    const { dx, dy, dw, dh } = drawRect(overlay, beard.x, beard.y, 1);
    expect(blits).toEqual([[strip.canvas, slot, 0, overlay.w, overlay.h, dx, dy, dw, dh]]);

    // Composed once: the next paint is a blit and nothing more.
    atlas.drawOver(ctx, "sageBeard", beard.x, beard.y, "tea1");
    expect(strip.drawn).toHaveLength(2);
    expect(blits).toHaveLength(2);
  });

  it("is drawn straight from the sheet on a frame with nothing in front of the head", () => {
    const strip = fakeCanvas();
    vi.stubGlobal("document", { createElement: () => strip.canvas });
    const { ctx, blits } = blitContext();
    const { beard } = HEAD_ANCHORS.idleFront1!;
    loadedAtlas().drawOver(ctx, "sageBeard", beard.x, beard.y, "idleFront1");
    const overlay = SPRITE_FRAMES.sageBeard;
    const { dx, dy, dw, dh } = drawRect(overlay, beard.x, beard.y, 1);
    expect(strip.drawn).toEqual([]);
    expect(blits).toEqual([[SHEET_IMAGE, overlay.x, overlay.y, overlay.w, overlay.h, dx, dy, dw, dh]]);
  });

  it("still lands, over the prop, where there is no canvas to compose on", () => {
    const { ctx, blits } = blitContext();
    const { beard } = HEAD_ANCHORS.tea1!;
    loadedAtlas().drawOver(ctx, "sageBeard", beard.x, beard.y, "tea1");
    expect(blits).toHaveLength(1);
    expect(blits[0]![0]).toBe(SHEET_IMAGE);
  });
});
