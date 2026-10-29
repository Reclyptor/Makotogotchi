// A garment is worn, not pasted on (SPEC §22.12): it is drawn from the pose's
// own silhouette, so these hold it to the pose rather than to a picture of one.
// The regions are read off the art, and checked against the art, because a
// generated table that has drifted from the sheet dresses a body that is no
// longer there.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { PNG } from "pngjs";
import { describe, expect, it } from "vitest";
import { BASE_CLIPS, IDLE_FLOURISH_CLIPS, ONE_SHOT_CLIPS, WALK_CLIP } from "../anim/clips";
import { SPRITE_FRAMES, SPRITE_MASKS, SPRITE_SHEET_URL, type FrameName } from "../atlas.generated";
import { overlayOffset } from "../engine/placement";
import { rasterOf } from "../../../scripts/head-parts";
import { regionOf } from "../../../scripts/garment-parts";
import { beardClipCells, cellEdge, garmentCells, garmentExtent, type Garment, type GarmentCell, type GarmentRegion } from "./garment";
import { GARMENT_REGIONS } from "./garment.generated";
import { TEST_GARMENT } from "./garment.testkit";
import { HEAD_ANCHORS } from "./head";
import { WIZARD_ROBE } from "./holidays/halloween";
import { SAGE_CLOAK } from "./sageCloak";

const SHEET = PNG.sync.read(readFileSync(new URL(`../../../public${SPRITE_SHEET_URL}`, import.meta.url)));
const REGIONS = Object.entries(GARMENT_REGIONS) as [FrameName, GarmentRegion][];

/** Frames with a body that wear no garment: under the dust bath's cloud or the ice pack. */
const BARE: readonly FrameName[] = ["dustbath1", "dustbath2", "dustbath3", "sick1", "sick2"];
const SEATED: readonly FrameName[] = ["meditate1", "meditate2"];

const petFrames = (): FrameName[] => [
  ...new Set([...Object.values(BASE_CLIPS), ...Object.values(ONE_SHOT_CLIPS), ...IDLE_FLOURISH_CLIPS, WALK_CLIP].flatMap((clip) => clip.frames)),
];

const cellOf = (region: GarmentRegion, x: number, y: number): string | undefined => region.rows[y - (region.neck - 1)]?.[x];
const keyOf = (cell: { x: number; y: number }): string => `${cell.x},${cell.y}`;
const same = (a: readonly number[], b: readonly number[]): boolean => a.every((channel, i) => channel === b[i]);

/** Where a frame's mouth starts, from the beard's anchor: what the extractor falls back on. */
const mouthTopOf = (name: FrameName): number => SPRITE_FRAMES[name].h + HEAD_ANCHORS[name]!.beard.y - SPRITE_FRAMES.sageBeard.h;

describe("the regions", () => {
  it("dress every awake frame that has a neckline", () => {
    const dressed = REGIONS.map(([name]) => name);
    const wanted = petFrames().filter((name) => {
      const anchor = HEAD_ANCHORS[name];
      return anchor && !anchor.nightcap && !BARE.includes(name);
    });
    expect([...dressed].sort()).toEqual([...wanted].sort());
  });

  it("hang the neckline above the last row of cloth, with a row for every one between", () => {
    for (const [name, region] of REGIONS) {
      expect(region.bottom, name).toBeGreaterThan(region.neck);
      expect(region.rows, name).toHaveLength(region.bottom - region.neck + 2);
    }
  });

  // The table is generated from the sheet, so it is recomputed from it: one
  // that was not regenerated after the art moved would dress a body that is gone.
  it("match the sheet they were generated from", () => {
    for (const [name, region] of REGIONS) {
      const mask = SPRITE_MASKS[name];
      const found = regionOf(rasterOf(SHEET, SPRITE_FRAMES[name]), mask ? rasterOf(SHEET, mask) : null, mouthTopOf(name), SEATED.includes(name));
      expect(found, name).toEqual(region);
    }
  });

  it("tell the three body shapes apart", () => {
    expect(GARMENT_REGIONS.idleSide1!.face).toBe("side");
    expect(GARMENT_REGIONS.idleFront1!.face).toBe("front");
    expect(GARMENT_REGIONS.meditate1!.face).toBe("sit");
    expect(GARMENT_REGIONS.bored1!.face).toBe("sitSide");
  });

  it("find an arm to leave bare in most frames, in the pixels or by the pose's standard one, and always under the collar", () => {
    expect(REGIONS.filter(([, region]) => region.paws.length > 0).length).toBeGreaterThan(REGIONS.length * 0.8);
    for (const [name, region] of REGIONS) {
      for (const { paw } of region.paws) expect(paw.y0, name).toBeGreaterThan(region.neck);
    }
  });

  it("read a native cut on its own grid, offset and all", () => {
    // Some frames were cut a few pixels in from the sheet's edge, so their
    // art cells do not start at pixel zero; painting them at the @1x cadence
    // would sit every cell a few pixels off.
    expect(REGIONS.some(([, region]) => region.ox > 0 || region.oy > 0)).toBe(true);
    for (const [name, region] of REGIONS) {
      expect(cellEdge(region.w, region.ox), name).toBeGreaterThanOrEqual(SPRITE_FRAMES[name].w);
    }
  });
});

describe("a worn garment", () => {
  it("covers only the pose's own body fur: never an outline, a prop, a bare paw or the tail", () => {
    for (const [name, region] of REGIONS) {
      for (const cell of garmentCells(region, TEST_GARMENT).filter((candidate) => !candidate.piece)) {
        expect(cellOf(region, cell.x, cell.y), `${name} ${cell.x},${cell.y}`).toBe("f");
      }
    }
  });

  // The rule that went wrong once: a far arm the outline sets apart from the
  // body is fur of its own, and was left grey through the coat. Below the
  // neckline nothing stays fur but the tail, the slit's opening and a bare paw.
  it("leaves no fur showing below the neckline but the tail, the slit and the bare paws", () => {
    for (const [name, region] of REGIONS) {
      const covered = new Set(garmentCells(region, TEST_GARMENT).filter((cell) => !cell.piece).map(keyOf));
      const slit = region.face === "front" || region.face === "sit" ? TEST_GARMENT.slit!.front : TEST_GARMENT.slit!.side;
      region.rows.forEach((row, index) => {
        const y = region.neck - 1 + index;
        for (let x = 0; x < row.length; x++) {
          if (row[x] !== "f" || covered.has(`${x},${y}`)) continue;
          const bare = region.paws.some(({ paw }) => x >= paw.x0 && x <= paw.x1 && y >= paw.y0 && y <= paw.y1);
          const open = x - region.col0 >= slit[0] && x - region.col0 <= slit[1];
          expect(bare || open, `${name} ${x},${y} is fur`).toBe(true);
        }
      });
    }
  });

  it("dresses the arms an outline sets apart from the body", () => {
    // groom's raised far arm and the tea frames' arms are fur regions of their own.
    for (const name of ["groom1", "groom2", "cry2", "pekori", "tea1"] as const) {
      const region = GARMENT_REGIONS[name]!;
      const covered = new Set(garmentCells(region, { ...TEST_GARMENT, slit: null, cuffs: false, tails: false }).map(keyOf));
      const left = region.rows.flatMap((row, index) => [...row].flatMap((c, x) => (c === "f" && x < region.col0 + 4 ? [`${x},${region.neck - 1 + index}`] : [])));
      expect(left.length, name).toBeGreaterThan(0);
      for (const cell of left) expect(covered.has(cell), `${name} ${cell}`).toBe(true);
    }
  });

  it("leaves only the tail as fur: tall, at the back, on the right", () => {
    const tailed = REGIONS.filter(([, region]) => region.rows.some((row) => row.includes("t")));
    expect(tailed.length).toBeGreaterThan(20);
    for (const [name, region] of tailed) {
      const cells = region.rows.flatMap((row, index) => [...row].flatMap((c, x) => (c === "t" ? [{ x, y: index }] : [])));
      expect(Math.min(...cells.map((cell) => cell.x)), name).toBeGreaterThanOrEqual(region.w / 2);
      expect(Math.max(...cells.map((cell) => cell.y)) - Math.min(...cells.map((cell) => cell.y)) + 1, name).toBeGreaterThanOrEqual(5);
      const covered = new Set(garmentCells(region, { ...TEST_GARMENT, tails: false }).map(keyOf));
      for (const cell of cells) expect(covered.has(`${cell.x},${region.neck - 1 + cell.y}`), `${name} tail ${cell.x},${cell.y}`).toBe(false);
    }
  });

  it("leaves every paw bare under its cuff, and shows the fur through an open front", () => {
    for (const [name, region] of REGIONS) {
      // Tails are extra pieces past the silhouette, painted over whatever is there.
      const covered = new Set(garmentCells(region, TEST_GARMENT).filter((cell) => !cell.piece).map(keyOf));
      for (const { paw } of region.paws) {
        for (let y = paw.y0; y <= paw.y1; y++) for (let x = paw.x0; x <= paw.x1; x++) expect(covered.has(`${x},${y}`), `${name} paw ${x},${y}`).toBe(false);
      }
    }
    const region = GARMENT_REGIONS.idleFront1!;
    const covered = new Set(garmentCells(region, TEST_GARMENT).map(keyOf));
    for (const y of [region.neck + 2, region.neck + 4]) {
      for (const column of [8, 10, 12]) expect(covered.has(`${region.col0 + column},${y}`), `slit ${column},${y}`).toBe(false);
    }
  });

  it("puts a cuff above a bare paw", () => {
    const region = GARMENT_REGIONS.idleFront1!;
    const trim = garmentCells(region, TEST_GARMENT).filter((cell) => same(cell.color, TEST_GARMENT.ramp.trim));
    const cuffRows = region.paws.flatMap((arm) => (arm.cuff ? [arm.cuff.y0] : []));
    expect(cuffRows.length).toBeGreaterThan(0);
    expect(trim.some((cell) => cuffRows.includes(cell.y))).toBe(true);
  });

  it("closes the front and runs the sleeves to the paw on a garment that has neither", () => {
    const plain: Garment = { ...TEST_GARMENT, slit: null, cuffs: false, tails: false };
    const region = GARMENT_REGIONS.idleFront1!;
    const cells = garmentCells(region, plain);
    const covered = new Set(cells.map(keyOf));
    expect(covered.has(`${region.col0 + 10},${region.neck + 3}`)).toBe(true);
    const paw = region.paws[0]!.paw;
    expect(covered.has(`${paw.x0},${paw.y0}`)).toBe(true);
    expect(cells.every((cell) => !cell.piece)).toBe(true);
  });

  it("runs a closed seam of trim down the centre with no fur showing, and closes it above a seated lap", () => {
    const caped: Garment = { ...TEST_GARMENT, slit: null, seam: { side: 9, front: 10 }, tails: false };
    const front = GARMENT_REGIONS.idleFront1!;
    const seamCells = garmentCells(front, caped).filter((cell) => cell.x === front.col0 + 10 && same(cell.color, caped.ramp.trim));
    expect(seamCells.length).toBeGreaterThan(5);
    const sit = GARMENT_REGIONS.meditate1!;
    const lap = garmentCells(sit, caped).filter((cell) => cell.x === sit.col0 + 10 && cell.y > sit.bottom - 5 && same(cell.color, caped.ramp.trim));
    expect(lap).toEqual([]);
  });

  it("draws the collar on the neckline and its black line on the row above", () => {
    const region = GARMENT_REGIONS.idleSide1!;
    const cells = garmentCells(region, TEST_GARMENT);
    const rowOf = (y: number): GarmentCell[] => cells.filter((cell) => cell.y === y);
    expect(rowOf(region.neck).every((cell) => same(cell.color, TEST_GARMENT.ramp.collar) || same(cell.color, TEST_GARMENT.ramp.trim))).toBe(true);
    expect(rowOf(region.neck - 1).every((cell) => same(cell.color, TEST_GARMENT.ramp.line))).toBe(true);
    expect(cells.some((cell) => cell.y < region.neck - 1)).toBe(false);
  });

  it("lays a hem pattern on the last rows of cloth, a row higher when seated if it says so", () => {
    const stripes: Garment = { ...TEST_GARMENT, slit: null, cuffs: false, tails: false, hemPattern: ["t"] };
    const stand = GARMENT_REGIONS.idleFront1!;
    const hemRow = garmentCells(stand, stripes).filter((cell) => cell.y === stand.bottom);
    expect(hemRow.length).toBeGreaterThan(0);
    expect(hemRow.every((cell) => same(cell.color, stripes.ramp.trim))).toBe(true);

    const sit = GARMENT_REGIONS.meditate1!;
    const lifted = garmentCells(sit, { ...stripes, seatedHemLift: 1 });
    expect(lifted.filter((cell) => cell.y === sit.bottom).every((cell) => !same(cell.color, stripes.ramp.trim))).toBe(true);
    expect(lifted.filter((cell) => cell.y === sit.bottom - 1).every((cell) => same(cell.color, stripes.ramp.trim))).toBe(true);
  });

  it("belts the waist two rows above the hem with a buckle in the middle, over cloth only", () => {
    const belted: Garment = { ...TEST_GARMENT, slit: null, tails: false, belt: { belt: [9, 9, 9], buckle: [250, 250, 1] } };
    const region = GARMENT_REGIONS.idleFront1!;
    const waist = garmentCells(region, belted).filter((cell) => cell.y === region.bottom - 2);
    expect(waist.filter((cell) => same(cell.color, [250, 250, 1]))).toHaveLength(1);
    expect(waist.filter((cell) => same(cell.color, [9, 9, 9])).length).toBeGreaterThan(3);
    const above = garmentCells(region, belted).filter((cell) => cell.y !== region.bottom - 2);
    expect(above.some((cell) => same(cell.color, [9, 9, 9]))).toBe(false);
  });

  describe("with a floor-length skirt", () => {
    const skirted: Garment = { ...TEST_GARMENT, tails: false, skirt: true };
    const hemLineOf = (region: GarmentRegion): number => (region.face === "sit" || region.face === "sitSide" ? region.h - 1 : region.bottom + 1);

    it("falls as one closed shape from the waist to a line of outline on the hem, and nothing below it", () => {
      for (const [name, region] of REGIONS) {
        const pieces = garmentCells(region, skirted).filter((cell) => cell.piece);
        const hem = hemLineOf(region);
        expect(pieces.length, name).toBeGreaterThan(0);
        expect(Math.max(...pieces.map((cell) => cell.y)), name).toBe(hem);
        const line = pieces.filter((cell) => cell.y === hem);
        expect(line.every((cell) => same(cell.color, skirted.ramp.line)), name).toBe(true);
        // Closed: the hem line runs unbroken from edge to edge.
        const xs = line.map((cell) => cell.x).sort((a, b) => a - b);
        for (let i = 1; i < xs.length; i++) expect(xs[i]! - xs[i - 1]!, `${name} hem line`).toBe(1);
        // Only cloth and outline: the ramp's own two colours.
        for (const cell of pieces) expect(same(cell.color, skirted.ramp.cloth) || same(cell.color, skirted.ramp.line), name).toBe(true);
      }
    });

    it("covers the legs: every cell between the edges is cloth on the rows above the hem", () => {
      const region = GARMENT_REGIONS.idleFront1!;
      const hem = hemLineOf(region);
      const cells = garmentCells(region, skirted);
      const colorAt = (x: number, y: number) => cells.filter((cell) => cell.x === x && cell.y === y).at(-1)?.color;
      for (const column of [2, 6, 10, 14, 18]) {
        expect(same(colorAt(region.col0 + column, hem - 1) ?? [], skirted.ramp.cloth), `column ${column}`).toBe(true);
      }
    });

    it("hangs the hem pattern on the skirt too", () => {
      const starry: Garment = { ...skirted, hemPattern: ["t"] };
      const region = GARMENT_REGIONS.idleFront1!;
      const hem = hemLineOf(region);
      const skirtRows = garmentCells(region, starry).filter((cell) => cell.piece && cell.y === hem - 1 && !same(cell.color, starry.ramp.line));
      expect(skirtRows.length).toBeGreaterThan(0);
      expect(skirtRows.every((cell) => same(cell.color, starry.ramp.trim))).toBe(true);
    });

    it("leaves the wizard robe's cells as they were: it has no slit to keep open", () => {
      const digest = createHash("sha256");
      for (const [name, region] of REGIONS) digest.update(name).update(JSON.stringify(garmentCells(region, WIZARD_ROBE)));
      expect(digest.digest("hex")).toBe("594de4d58a132f2227de0f5fab6d019882265adfe812fd3f618b5ab9136c3924");
    });

    describe("over an open front", () => {
      const slitOf = (region: GarmentRegion): readonly [number, number] => (region.face === "front" || region.face === "sit" ? SAGE_CLOAK.slit!.front : SAGE_CLOAK.slit!.side);
      const sealedLap = (region: GarmentRegion, y: number): boolean => (region.face === "sit" ? y > region.bottom - 5 : false);

      it("keeps the slit's fur in view on every row above the last row of cloth", () => {
        for (const [name, region] of REGIONS) {
          const [from, to] = slitOf(region);
          const painted = new Set(garmentCells(region, SAGE_CLOAK).map(keyOf));
          let open = 0;
          for (let y = region.neck; y < region.bottom; y++) {
            if (sealedLap(region, y)) continue;
            for (let x = region.col0 + from; x <= region.col0 + to; x++) {
              if (cellOf(region, x, y) !== "f") continue;
              open++;
              expect(painted.has(keyOf({ x, y })), `${name} ${x},${y}`).toBe(false);
            }
          }
          expect(open, name).toBeGreaterThan(0);
        }
      });

      it("still closes the hem line across the slit, and the legs on either side of it", () => {
        for (const [name, region] of REGIONS) {
          const [from, to] = slitOf(region);
          const hem = hemLineOf(region);
          const cells = garmentCells(region, SAGE_CLOAK);
          const lineAt = (x: number) => cells.some((cell) => cell.piece && cell.x === x && cell.y === hem && same(cell.color, SAGE_CLOAK.ramp.line));
          for (let x = region.col0 + from; x <= region.col0 + to; x++) expect(lineAt(x), `${name} ${x}`).toBe(true);
          expect(cells.some((cell) => cell.piece && cell.y < hem && cell.x < region.col0 + from), name).toBe(true);
        }
      });
    });

    it("stays inside the canvas it is drawn on, on every frame", () => {
      for (const [name, region] of REGIONS) {
        const extent = garmentExtent(SPRITE_FRAMES[name], region);
        for (const cell of garmentCells(region, skirted).filter((candidate) => candidate.piece)) {
          expect(cellEdge(cell.x, region.ox), `${name} ${cell.x}`).toBeGreaterThanOrEqual(extent.x);
          expect(cellEdge(cell.x + 1, region.ox), `${name} ${cell.x}`).toBeLessThanOrEqual(extent.x + extent.w);
        }
      }
    });
  });

  it("keeps its tails inside the canvas it is drawn on", () => {
    for (const [name, region] of REGIONS) {
      const extent = garmentExtent(SPRITE_FRAMES[name], region);
      for (const cell of garmentCells(region, TEST_GARMENT).filter((candidate) => candidate.piece)) {
        expect(cellEdge(cell.x, region.ox), `${name} ${cell.x}`).toBeGreaterThanOrEqual(extent.x);
        expect(cellEdge(cell.x + 1, region.ox), `${name} ${cell.x}`).toBeLessThanOrEqual(extent.x + extent.w);
        // A standing hem may drop below the frame's last row; the canvas crops it.
        if (cell.y < region.h) expect(cellEdge(cell.y + 1, region.oy), `${name} row ${cell.y}`).toBeLessThanOrEqual(extent.h);
      }
    }
  });

  it("is the same cells every time, so the digest sees a still room", () => {
    for (const [, region] of REGIONS) {
      expect(garmentCells(region, TEST_GARMENT)).toEqual(garmentCells(region, TEST_GARMENT));
    }
  });
});

// A Sage's moustache droops to the shoulders and used to leave white specks on
// the cloth's silhouette. Below the collar the beard keeps to the middle of the
// cloth: nothing outside the silhouette, nothing within two columns of its edge.
describe("the beard over a garment", () => {
  const BEARD = SPRITE_FRAMES.sageBeard;
  const BROWS = SPRITE_FRAMES.elderBrows;
  const pixelAt = (sprite: { x: number; y: number }, x: number, y: number): boolean => SHEET.data[((sprite.y + y) * SHEET.width + sprite.x + x) * 4 + 3]! > 0;

  /** The art cell a frame pixel falls in. */
  const cellAt = (region: GarmentRegion, px: number, py: number): { x: number; y: number } => {
    let x = 0;
    let y = 0;
    // A pixel left of or above the frame falls in the cells past its edge.
    while (cellEdge(x + 1, region.ox) <= px) x++;
    while (cellEdge(x, region.ox) > px) x--;
    while (cellEdge(y + 1, region.oy) <= py) y++;
    while (cellEdge(y, region.oy) > py) y--;
    return { x, y };
  };
  /** The silhouette's first and last opaque cell on a row of the region. */
  const edgesOf = (region: GarmentRegion, y: number): { left: number; right: number } => {
    const row = region.rows[y - (region.neck - 1)]!;
    return { left: row.search(/[^.]/), right: row.length - 1 - [...row].reverse().join("").search(/[^.]/) };
  };

  const allRows = (region: GarmentRegion): string[] => [...region.head, ...region.rows];
  const letterAt = (region: GarmentRegion, x: number, y: number): string => (x < 0 || x >= region.w || y < 0 ? "." : (allRows(region)[y]?.[x] ?? "o"));
  const onEdge = (region: GarmentRegion, x: number, y: number): boolean =>
    letterAt(region, x, y) === "k" && [-1, 0, 1].some((dy) => [-1, 0, 1].some((dx) => (dx !== 0 || dy !== 0) && letterAt(region, x + dx, y + dy) === "."));

  it("leaves no beard pixel on the silhouette's edge or in the air at any row, nor within two columns of it from the collar's top line down", () => {
    // Collected and asserted once: a thousand pixels a frame, 45 frames, is too
    // many `expect`s to run inside the suite's time limit under load.
    const problems: string[] = [];
    for (const [name, region] of REGIONS) {
      const anchor = HEAD_ANCHORS[name]!;
      const offset = overlayOffset(SPRITE_FRAMES[name], BEARD, anchor.beard.x, anchor.beard.y);
      const clipped = new Set(beardClipCells(region).map(keyOf));
      let drawn = 0;
      for (let by = 0; by < BEARD.h; by++) {
        for (let bx = 0; bx < BEARD.w; bx++) {
          if (!pixelAt(BEARD, bx, by)) continue;
          const cell = cellAt(region, offset.x + bx, offset.y + by);
          if (cell.y > region.bottom || clipped.has(keyOf(cell))) continue;
          const at = `${name} beard pixel ${bx},${by} at ${cell.x},${cell.y}`;
          if (letterAt(region, cell.x, cell.y) === ".") problems.push(`${at} is in the air`);
          if (onEdge(region, cell.x, cell.y)) problems.push(`${at} is on the edge`);
          if (cell.y >= region.neck - 1) {
            const { left, right } = edgesOf(region, cell.y);
            if (cell.x <= left + 2 || cell.x >= right - 2) problems.push(`${at} is in the margin`);
          }
          drawn++;
        }
      }
      // The centre of the beard is still there.
      if (drawn === 0) problems.push(`${name} has no beard left`);
    }
    expect(problems).toEqual([]);
  });

  it("leaves no beard pixel outside the frame, the overhang included", () => {
    for (const [name, region] of REGIONS) {
      const anchor = HEAD_ANCHORS[name]!;
      const frame = SPRITE_FRAMES[name];
      const offset = overlayOffset(frame, BEARD, anchor.beard.x, anchor.beard.y);
      const clipped = new Set(beardClipCells(region).map(keyOf));
      for (let by = 0; by < BEARD.h; by++) {
        for (let bx = 0; bx < BEARD.w; bx++) {
          if (!pixelAt(BEARD, bx, by)) continue;
          const px = offset.x + bx;
          if (px >= 0 && px < frame.w) continue;
          const cell = cellAt(region, px, offset.y + by);
          expect(clipped.has(keyOf(cell)), `${name} beard pixel ${bx},${by} at frame x ${px}`).toBe(true);
        }
      }
    }
  });

  it("cuts the overhang on the side poses, where the tip hangs past the frame", () => {
    for (const name of ["idleSide1", "walk1", "walk2", "walk3", "walk4"] as const) {
      const anchor = HEAD_ANCHORS[name]!;
      const offset = overlayOffset(SPRITE_FRAMES[name], BEARD, anchor.beard.x, anchor.beard.y);
      expect(offset.x, name).toBeLessThan(0);
      const region = GARMENT_REGIONS[name]!;
      const clipped = new Set(beardClipCells(region).map(keyOf));
      const overhang = [];
      for (let by = 0; by < BEARD.h; by++) {
        for (let bx = 0; bx < BEARD.w; bx++) if (pixelAt(BEARD, bx, by) && offset.x + bx < 0) overhang.push(cellAt(region, offset.x + bx, offset.y + by));
      }
      expect(overhang.length, name).toBeGreaterThan(0);
      for (const cell of overhang) expect(clipped.has(keyOf(cell)), `${name} overhang cell ${cell.x},${cell.y}`).toBe(true);
    }
  });

  it("cuts the moustache ends a bowed or turned head puts on the head's own outline", () => {
    for (const name of ["pekori", "sneeze2"] as const) {
      const region = GARMENT_REGIONS[name]!;
      expect(beardClipCells(region).some((cell) => cell.y < region.neck && onEdge(region, cell.x, cell.y)), name).toBe(true);
    }
  });

  it("keeps the brows above the collar, where this rule does not reach them", () => {
    for (const [name, region] of REGIONS) {
      const anchor = HEAD_ANCHORS[name]!;
      const offset = overlayOffset(SPRITE_FRAMES[name], BROWS, anchor.brows.x, anchor.brows.y);
      for (let by = 0; by < BROWS.h; by++) {
        for (let bx = 0; bx < BROWS.w; bx++) {
          if (pixelAt(BROWS, bx, by)) expect(cellAt(region, offset.x + bx, offset.y + by).y, `${name} brow ${bx},${by}`).toBeLessThan(region.neck);
        }
      }
    }
  });

  it("clips the same beard cells whatever the garment hangs below the waist", () => {
    // The clip follows the pose's own silhouette, not the cloth: a skirt that
    // widens the hem leaves the margin where it was.
    for (const [name, region] of REGIONS) {
      const clip = beardClipCells(region);
      garmentCells(region, { ...TEST_GARMENT, skirt: true, tails: true });
      expect(beardClipCells(region), name).toEqual(clip);
    }
  });

  it("holds the two-column margin from the collar's top line down, and not above it", () => {
    const region = GARMENT_REGIONS.idleFront1!;
    const clipped = new Set(beardClipCells(region).map(keyOf));
    // The collar's top line is the first row of the margin, as well as the band under it.
    for (const y of [region.neck - 1, region.neck + 3]) {
      const { left, right } = edgesOf(region, y);
      expect(clipped.has(`${left + 2},${y}`), `row ${y}`).toBe(true);
      expect(clipped.has(`${left + 3},${y}`), `row ${y}`).toBe(false);
      expect(clipped.has(`${right - 2},${y}`), `row ${y}`).toBe(true);
    }
    // Above the collar only the edge itself is cut: two cells in from the head's outline stay.
    const above = region.neck - 3;
    const row = region.head[above]!;
    const headLeft = row.search(/[^.]/);
    expect(clipped.has(`${headLeft + 2},${above}`)).toBe(false);
  });

  it("leaves no beard pixel in the margin on the collar's top line of a side pose", () => {
    const region = GARMENT_REGIONS.idleSide1!;
    const anchor = HEAD_ANCHORS.idleSide1!;
    const offset = overlayOffset(SPRITE_FRAMES.idleSide1, BEARD, anchor.beard.x, anchor.beard.y);
    const clipped = new Set(beardClipCells(region).map(keyOf));
    const y = region.neck - 1;
    const { left, right } = edgesOf(region, y);
    for (let by = 0; by < BEARD.h; by++) {
      for (let bx = 0; bx < BEARD.w; bx++) {
        if (!pixelAt(BEARD, bx, by)) continue;
        const cell = cellAt(region, offset.x + bx, offset.y + by);
        if (cell.y !== y || clipped.has(keyOf(cell))) continue;
        expect(cell.x, `beard pixel ${bx},${by}`).toBeGreaterThan(left + 2);
        expect(cell.x, `beard pixel ${bx},${by}`).toBeLessThan(right - 2);
      }
    }
  });
});
