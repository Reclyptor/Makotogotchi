// The prop masks (SPEC §21.9): that the packer indexes the ones under art/
// and packs their pixels, and that the atlas clips an overlay by a mask in
// the frame's own pixels. A mask's sheet rectangle once indexed nothing but
// transparency — the packer placed it and never copied it — and the beard
// went on covering the cup with every test green, so the packed pixels are
// checked against the art itself. The mouth masks (also §21.9) are found in
// the frames' own pixels, so they are checked against the detection that
// made them.

import { readdirSync, readFileSync } from "node:fs";
import { PNG } from "pngjs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Atlas } from "./atlas";
import { drawRect, overlayOffset } from "./placement";
import type { SceneContext } from "./digest";
import { SPRITE_FRAMES, SPRITE_MASKS, SPRITE_MOUTHS, SPRITE_SHEET_URL, type FrameName } from "../atlas.generated";
import { mouthPixels, rasterOf } from "../../../scripts/head-parts";
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

describe("the packed mouths", () => {
  const sheet = PNG.sync.read(readFileSync(new URL(`../../../public${SPRITE_SHEET_URL}`, import.meta.url)));
  const frames = Object.keys(SPRITE_FRAMES) as FrameName[];
  const alphaAt = (frame: { x: number; y: number }, x: number, y: number): number =>
    sheet.data[((frame.y + y) * sheet.width + frame.x + x) * 4 + 3]!;

  it("index exactly the frames whose art has a mouth", () => {
    const withMouth = frames.filter((name) => mouthPixels(rasterOf(sheet, SPRITE_FRAMES[name])) !== null);
    expect(withMouth.length).toBeGreaterThan(0);
    expect(Object.keys(SPRITE_MOUTHS).sort()).toEqual(withMouth.sort());
  });

  it("are each the size of their frame, opaque on the mouth's pixels and nowhere else", () => {
    for (const [name, mouth] of Object.entries(SPRITE_MOUTHS)) {
      const frame = SPRITE_FRAMES[name as FrameName];
      expect({ w: mouth.w, h: mouth.h }, name).toEqual({ w: frame.w, h: frame.h });
      const pixels = mouthPixels(rasterOf(sheet, frame))!;
      for (let y = 0; y < mouth.h; y++) {
        for (let x = 0; x < mouth.w; x++) {
          if ((alphaAt(mouth, x, y) > 0) !== pixels.has(y * mouth.w + x)) expect.fail(`${name} mouth differs from its frame at ${x},${y}`);
        }
      }
    }
  });

  it("leave no beard pixel on a mouth pixel, on any frame the beard hangs from", () => {
    const beard = SPRITE_FRAMES.sageBeard;
    for (const name of frames) {
      const mouth = SPRITE_MOUTHS[name];
      const anchor = HEAD_ANCHORS[name]?.beard;
      if (!mouth || !anchor) continue;
      const prop = SPRITE_MASKS[name];
      const offset = overlayOffset(SPRITE_FRAMES[name], beard, anchor.x, anchor.y);
      for (let y = 0; y < mouth.h; y++) {
        for (let x = 0; x < mouth.w; x++) {
          if (alphaAt(mouth, x, y) === 0) continue;
          const bx = x - offset.x;
          const by = y - offset.y;
          const inBeard = bx >= 0 && by >= 0 && bx < beard.w && by < beard.h;
          // The overlay is erased wherever either mask is opaque, so what is left is the beard outside both.
          const erased = alphaAt(mouth, x, y) > 0 || (prop !== undefined && alphaAt(prop, x, y) > 0);
          if (inBeard && alphaAt(beard, bx, by) > 0 && !erased) expect.fail(`${name}: beard on its mouth at ${x},${y}`);
        }
      }
    }
  });
});

describe("an overlay behind a prop", () => {
  it("is placed in the frame's own pixels where the room hangs it", () => {
    // Measured off the art: the beard's 94×55 rectangle on the 115×138 front idle frame.
    const { beard } = HEAD_ANCHORS.idleFront1!;
    expect(overlayOffset(SPRITE_FRAMES.idleFront1, SPRITE_FRAMES.sageBeard, beard.x, beard.y)).toEqual({ x: 10, y: 55 });
  });

  it("is erased wherever the frame's mask is opaque, then wherever its mouth is, and lands where the plain draw would", () => {
    const strip = fakeCanvas();
    vi.stubGlobal("document", { createElement: () => strip.canvas });
    const atlas = loadedAtlas();
    const { ctx, blits } = blitContext();
    const { beard } = HEAD_ANCHORS.tea1!;
    atlas.drawOver(ctx, "sageBeard", beard.x, beard.y, "tea1");

    const overlay = SPRITE_FRAMES.sageBeard;
    const mask = SPRITE_MASKS.tea1!;
    const offset = overlayOffset(SPRITE_FRAMES.tea1, overlay, beard.x, beard.y);
    const mouth = SPRITE_MOUTHS.tea1!;
    const slot = Object.keys(SPRITE_MASKS).indexOf("tea1") * overlay.w;
    expect(strip.drawn).toEqual([
      { args: [SHEET_IMAGE, overlay.x, overlay.y, overlay.w, overlay.h, slot, 0, overlay.w, overlay.h], composite: "source-over" },
      { args: [SHEET_IMAGE, mask.x, mask.y, mask.w, mask.h, slot - offset.x, -offset.y, mask.w, mask.h], composite: "destination-out" },
      { args: [SHEET_IMAGE, mouth.x, mouth.y, mouth.w, mouth.h, slot - offset.x, -offset.y, mouth.w, mouth.h], composite: "destination-out" },
    ]);
    const { dx, dy, dw, dh } = drawRect(overlay, beard.x, beard.y, 1);
    expect(blits).toEqual([[strip.canvas, slot, 0, overlay.w, overlay.h, dx, dy, dw, dh]]);

    // Composed once: the next paint is a blit and nothing more.
    atlas.drawOver(ctx, "sageBeard", beard.x, beard.y, "tea1");
    expect(strip.drawn).toHaveLength(3);
    expect(blits).toHaveLength(2);
  });

  it("is erased by the frame's own mouth, and by the prop's mask beside it", () => {
    const strip = fakeCanvas();
    vi.stubGlobal("document", { createElement: () => strip.canvas });
    const { ctx } = blitContext();
    const { beard } = HEAD_ANCHORS.idleFront1!;
    loadedAtlas().drawOver(ctx, "sageBeard", beard.x, beard.y, "idleFront1");
    const mouth = SPRITE_MOUTHS.idleFront1!;
    const offset = overlayOffset(SPRITE_FRAMES.idleFront1, SPRITE_FRAMES.sageBeard, beard.x, beard.y);
    const slot = [...new Set([...Object.keys(SPRITE_MASKS), ...Object.keys(SPRITE_MOUTHS)])].indexOf("idleFront1") * SPRITE_FRAMES.sageBeard.w;
    expect(strip.drawn.filter((entry) => entry.composite === "destination-out")).toEqual([
      { args: [SHEET_IMAGE, mouth.x, mouth.y, mouth.w, mouth.h, slot - offset.x, -offset.y, mouth.w, mouth.h], composite: "destination-out" },
    ]);

  });

  it("is drawn straight from the sheet on a frame with nothing in front of the head and no mouth", () => {
    const strip = fakeCanvas();
    vi.stubGlobal("document", { createElement: () => strip.canvas });
    const { ctx, blits } = blitContext();
    const beard = { x: 0, y: 0 };
    expect(SPRITE_MASKS.clone5).toBeUndefined();
    expect(SPRITE_MOUTHS.clone5).toBeUndefined();
    loadedAtlas().drawOver(ctx, "sageBeard", beard.x, beard.y, "clone5");
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

// The Sage's cane (SPEC §21.9) is packed like the beard, and gripped at an
// anchor inside the frame that holds it.
describe("the Sage's cane", () => {
  it("is packed beside the beard", () => {
    expect(SPRITE_FRAMES.sageCane.w).toBeGreaterThan(0);
    expect(SPRITE_FRAMES.sageCane.h).toBeGreaterThan(0);
  });

  it("is gripped inside every frame that holds it", () => {
    for (const [frame, anchor] of Object.entries(HEAD_ANCHORS)) {
      if (!anchor?.cane) continue;
      const { w, h } = SPRITE_FRAMES[frame as FrameName];
      expect(Math.abs(anchor.cane.x), frame).toBeLessThanOrEqual(w / 2);
      expect(anchor.cane.y, frame).toBeLessThanOrEqual(0);
      expect(anchor.cane.y, frame).toBeGreaterThanOrEqual(-h);
    }
  });
});
