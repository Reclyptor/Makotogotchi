// The portraits are generated, so what is worth testing is that the generated
// grids and the code that reads them still agree — the seam a re-run of
// `npm run art:ancestors` can break — and the wall's own rules: which slot
// holds what, and what fits on a plate (SPEC §22.10).

import { describe, expect, it } from "vitest";
import { compile, engraving, FamilyWall, MOULDING, plaqueCapacity, WALL_SLOTS } from "./ancestors";
import { ANCESTOR_PALETTE, ANCESTOR_PICTURES } from "./ancestors.generated";
import { ROOM_WIDTH } from "./backdrop";
import type { SceneContext } from "../engine/digest";

const layingContext = () => {
  const laid: { dx: number; dy: number; width: number; height: number; data: Uint8ClampedArray }[] = [];
  const fills: { x: number; y: number; w: number; h: number; colour: string }[] = [];
  const ctx = {
    fillStyle: "",
    fillRect(x: number, y: number, w: number, h: number) {
      fills.push({ x, y, w, h, colour: this.fillStyle });
    },
    createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }) as ImageData,
    putImageData: (image: ImageData, dx: number, dy: number) => {
      laid.push({ dx, dy, width: image.width, height: image.height, data: image.data });
    },
    drawImage: () => {
      throw new Error("there is no canvas under test to blit from");
    },
  };
  return { ctx: ctx as unknown as SceneContext, laid, fills };
};

describe("the generated portraits", () => {
  it("come at every size the wall hangs, square, on the shared palette", () => {
    for (const slot of WALL_SLOTS) {
      const picture = ANCESTOR_PICTURES.find((candidate) => candidate.size === slot.art);
      expect(picture, `${slot.art}px`).toBeDefined();
      expect(picture!.rows.length).toBe(slot.art);
      for (const row of picture!.rows) {
        expect(row.length).toBe(slot.art);
        for (const letter of row) expect(ANCESTOR_PALETTE[letter], `'${letter}'`).toBeDefined();
      }
    }
  });

  it("fade toward sepia the further back the slot hangs, and not at all in front", () => {
    const parent = compile(WALL_SLOTS[0]!);
    const picture = ANCESTOR_PICTURES.find((candidate) => candidate.size === WALL_SLOTS[0]!.art)!;
    const first = ANCESTOR_PALETTE[picture.rows[0]![0]!]!;
    expect([...parent.subarray(0, 3)]).toEqual([...first]);
    // Sepia pulls blue down relative to red; a deeper fade pulls it further.
    const ratio = (pixels: Uint8ClampedArray): number => pixels[2]! / pixels[0]!;
    expect(ratio(compile(WALL_SLOTS[1]!))).toBeLessThan(ratio(parent));
    expect(ratio(compile(WALL_SLOTS[4]!))).toBeLessThan(ratio(compile(WALL_SLOTS[1]!)));
  });
});

describe("the wall's slots", () => {
  it("shrink with distance and stay inside the room", () => {
    for (let index = 1; index < WALL_SLOTS.length; index++) {
      expect(WALL_SLOTS[index]!.art).toBeLessThanOrEqual(WALL_SLOTS[index - 1]!.art);
      expect(WALL_SLOTS[index]!.fade).toBeGreaterThan(WALL_SLOTS[index - 1]!.fade);
    }
    for (const slot of WALL_SLOTS) {
      const outer = slot.art + MOULDING * 2;
      const plateLeft = slot.x + Math.round((outer - slot.plaque) / 2);
      expect(plateLeft).toBeGreaterThanOrEqual(0);
      expect(plateLeft + slot.plaque).toBeLessThanOrEqual(ROOM_WIDTH);
    }
  });

  it("are as many as the server sends (FAMILY_WALL_SLOTS in server/shop.ts)", () => {
    expect(WALL_SLOTS).toHaveLength(5);
  });

  it("hold the number of characters the spec promises", () => {
    expect(WALL_SLOTS.map((slot) => plaqueCapacity(slot.plaque))).toEqual([8, 12, 7, 6, 6]);
  });
});

describe("the plaque", () => {
  it("engraves the name in capitals, folded to the font's alphabet", () => {
    expect(engraving("Makoto", WALL_SLOTS[0]!)).toBe("MAKOTO");
    expect(engraving("Émilie", WALL_SLOTS[0]!)).toBe("EMILIE");
  });

  it("cuts a long name to what the slot's plate can hold", () => {
    expect(engraving("Makotonosuke IV", WALL_SLOTS[1]!)).toBe("MAKOTONOSUKE");
    expect(engraving("Makotonosuke IV", WALL_SLOTS[0]!)).toBe("MAKOTONO");
    expect(engraving("Makotonosuke IV", WALL_SLOTS[4]!)).toBe("MAKOTO");
  });
});

describe("the wall", () => {
  it("lays each picture inside its frame and plates it below", () => {
    const { ctx, laid, fills } = layingContext();
    new FamilyWall().render(ctx, [{ ordinal: 2, name: "Makoto" }]);
    const slot = WALL_SLOTS[0]!;
    expect(laid).toHaveLength(1);
    expect(laid[0]).toMatchObject({ dx: slot.x + MOULDING, dy: slot.y + MOULDING, width: slot.art, height: slot.art });
    const outer = slot.art + MOULDING * 2;
    // The frame face, then the plate under it.
    expect(fills[0]).toMatchObject({ x: slot.x, y: slot.y, w: outer, h: outer });
    const plate = fills.find((fill) => fill.y === slot.y + outer + 2 && fill.h === 7);
    expect(plate).toBeDefined();
    expect(plate!.w).toBeGreaterThanOrEqual(outer);
    expect(plate!.w).toBeLessThanOrEqual(slot.plaque);
  });

  it("hangs the grandparent's plate over its frame, clear of the pet's head", () => {
    const { ctx, fills } = layingContext();
    new FamilyWall().render(ctx, [
      { ordinal: 3, name: "Makoto" },
      { ordinal: 2, name: "Mochi" },
    ]);
    const slot = WALL_SLOTS[1]!;
    expect(slot.plate).toBe("above");
    const plate = fills.find((fill) => fill.h === 7 && fill.y < slot.y);
    expect(plate).toMatchObject({ y: slot.y - 2 - 7 });
    expect(plate!.y).toBeGreaterThanOrEqual(0);
  });

  it("caches the picture: the second frame lays the same bytes", () => {
    const wall = new FamilyWall();
    const first = layingContext();
    wall.render(first.ctx, [{ ordinal: 2, name: "Makoto" }]);
    const second = layingContext();
    wall.render(second.ctx, [{ ordinal: 2, name: "Makoto" }]);
    expect(second.laid[0]!.data).toEqual(first.laid[0]!.data);
  });
});
