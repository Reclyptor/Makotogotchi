// Every holiday's scene is wired in whole (SPEC §22.11): its art on the sheet,
// and a costume that is worn on the pose rather than pasted on.

import { describe, expect, it } from "vitest";
import { HOLIDAYS } from "@/sim/holidays";
import { SPRITE_FRAMES } from "../../atlas.generated";
import { drawRect } from "../../engine/placement";
import { ROOM_HEIGHT, ROOM_WIDTH } from "../backdrop";
import { garmentCells } from "../garment";
import { GARMENT_REGIONS } from "../garment.generated";
import { holidayScene } from ".";

const IDS = HOLIDAYS.map((holiday) => holiday.id);
const REGIONS = Object.values(GARMENT_REGIONS);

describe.each(IDS)("%s", (id) => {
  const scene = holidayScene(id);

  it("has a scene that names itself", () => {
    expect(scene.id).toBe(id);
    expect(scene.theme.id).toBe(id);
  });

  it("gives a Sage a staff of its own to lean on in place of the cane, at least as tall", () => {
    const { staff } = scene.costume;
    expect(staff, "the costume's staff").toBeDefined();
    expect(staff).not.toBe("sageCane");
    expect(SPRITE_FRAMES[staff!].h).toBeGreaterThanOrEqual(SPRITE_FRAMES.sageCane.h);
  });

  it("draws only art that is on the sheet, inside the room", () => {
    const frames = [...scene.props.map((prop) => prop.frame), scene.costume.hat, ...(scene.costume.staff ? [scene.costume.staff] : [])];
    for (const frame of frames) expect(SPRITE_FRAMES[frame], frame).toBeDefined();
    for (const prop of scene.props) {
      // Where the room puts it: bottom-centre, snapped to whole pixels.
      const { dx, dy, dw, dh } = drawRect(SPRITE_FRAMES[prop.frame], prop.x, prop.y, 1);
      expect(dx, prop.frame).toBeGreaterThanOrEqual(0);
      expect(dx + dw, prop.frame).toBeLessThanOrEqual(ROOM_WIDTH);
      expect(dy, prop.frame).toBeGreaterThanOrEqual(0);
      expect(dy + dh, prop.frame).toBeLessThanOrEqual(ROOM_HEIGHT);
    }
  });

  it("wears a garment that dresses only the pose's own body fur, on every frame", () => {
    const garment = scene.costume.robe;
    for (const region of REGIONS) {
      for (const cell of garmentCells(region, garment).filter((candidate) => !candidate.piece)) {
        expect(region.rows[cell.y - (region.neck - 1)]?.[cell.x], `${cell.x},${cell.y}`).toBe("f");
      }
    }
  });

  it("leaves the tail and the bare paws as fur", () => {
    const garment = scene.costume.robe;
    for (const region of REGIONS) {
      const covered = new Set(garmentCells(region, garment).filter((cell) => !cell.piece).map((cell) => `${cell.x},${cell.y}`));
      region.rows.forEach((row, index) => {
        for (let x = 0; x < row.length; x++) {
          if (row[x] === "t") expect(covered.has(`${x},${region.neck - 1 + index}`)).toBe(false);
        }
      });
      if (!garment.cuffs) continue;
      for (const { paw } of region.paws) {
        for (let y = paw.y0; y <= paw.y1; y++) for (let x = paw.x0; x <= paw.x1; x++) expect(covered.has(`${x},${y}`), `paw ${x},${y}`).toBe(false);
      }
    }
  });
});

describe("the window", () => {
  it("has fireworks only where a holiday gives them a palette", () => {
    expect(holidayScene("newYear").window.fireworks!.length).toBeGreaterThan(1);
    for (const id of IDS.filter((candidate) => candidate !== "newYear")) expect(holidayScene(id).window.fireworks).toBeUndefined();
  });
});
