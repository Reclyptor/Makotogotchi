// The Sage's beard on a garment, and its own cloak, in the real room (SPEC
// §22.12). The unit tests hold the clip's arithmetic to the art; this holds what
// the browser actually paints to it. It drives the real Room in headless Chrome (e2e/harness/room.ts),
// draws a Sage and, on the very same room, an Elder, which is the Sage minus its
// beard: the pixels that differ are exactly the beard's. None of them may sit on
// the silhouette's edge, outside it, or within two columns of it from the
// collar's top line down.
//
// The pet in the full-stack specs is a hatchling, which has no beard, so nothing
// else in this suite can see this.

import { build } from "vite";
import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page, type TestInfo } from "@playwright/test";
import type { FrameName } from "@/game/atlas.generated";
import { cellEdge, type GarmentRegion } from "@/game/scene/garment";
import { GARMENT_REGIONS } from "@/game/scene/garment.generated";
import { PET_Y } from "@/game/scene/auraTypes";
import { HEAD_ANCHORS } from "@/game/scene/head";
import { SPRITE_FRAMES, SPRITE_SHEET_URL } from "@/game/atlas.generated";

const ORIGIN = "http://harness.test";
const PUBLIC = path.resolve(import.meta.dirname, "../public");
const SOURCE = path.resolve(import.meta.dirname, "../src");
const HARNESS = path.resolve(import.meta.dirname, "harness/room.ts");

/** The side poses a Sage walks and stands in: the ones whose moustache reaches the body's edge. */
const SIDE_POSES: readonly FrameName[] = ["idleSide1", "walk1", "walk2", "walk3", "walk4"];
const MARGIN_CELLS = 2;
const DAYTIME = 13;

type Painted = { width: number; height: number; pixels: number[]; scale: number; petX: number };
type RenderOptions = { stage: "SAGE" | "ELDER"; frame: FrameName; holidayId: "halloween" | null; hour: number };

let bundle = "";
test.beforeAll(async () => {
  const output = await build({
    configFile: false,
    logLevel: "silent",
    resolve: { alias: { "@": SOURCE } },
    build: { write: false, lib: { entry: HARNESS, formats: ["iife"], name: "RoomHarness", fileName: "room" } },
  });
  const chunks = (Array.isArray(output) ? output.flatMap((o) => o.output) : "output" in output ? output.output : []) as { type: string; code?: string }[];
  bundle = chunks.find((chunk) => chunk.type === "chunk")!.code!;
});

const openHarness = async (page: Page): Promise<void> => {
  await page.route(`${ORIGIN}/**`, async (route) => {
    const { pathname } = new URL(route.request().url());
    if (pathname === "/") return route.fulfill({ contentType: "text/html", body: '<!doctype html><body><script src="/room.js"></script></body>' });
    if (pathname === "/room.js") return route.fulfill({ contentType: "text/javascript", body: bundle });
    if (pathname === SPRITE_SHEET_URL) return route.fulfill({ contentType: "image/png", body: readFileSync(path.join(PUBLIC, SPRITE_SHEET_URL)) });
    return route.fulfill({ status: 404 });
  });
  await page.goto(`${ORIGIN}/`);
};

const paint = (page: Page, options: RenderOptions): Promise<Painted> =>
  page.evaluate((o) => (window as unknown as { renderRoom: (o: RenderOptions) => Promise<Painted> }).renderRoom(o), options);

/** The art cell a pixel of the frame falls in, past the frame's edge too. */
const cellAt = (region: GarmentRegion, px: number, py: number): { x: number; y: number } => {
  let x = 0;
  let y = 0;
  while (cellEdge(x + 1, region.ox) <= px) x++;
  while (cellEdge(x, region.ox) > px) x--;
  while (cellEdge(y + 1, region.oy) <= py) y++;
  while (cellEdge(y, region.oy) > py) y--;
  return { x, y };
};

const letterAt = (region: GarmentRegion, x: number, y: number): string =>
  x < 0 || x >= region.w || y < 0 ? "." : ([...region.head, ...region.rows][y]?.[x] ?? "o");

/** Every canvas pixel that is not the same in both paintings, as the frame's own pixel coordinates. */
const differing = (a: Painted, b: Painted, name: FrameName): { x: number; y: number }[] => {
  const frame = SPRITE_FRAMES[name];
  const left = Math.round(a.petX - frame.w / 2);
  const top = Math.round(PET_Y - frame.h);
  const found: { x: number; y: number }[] = [];
  for (let i = 0; i < a.pixels.length; i += 4) {
    if (a.pixels[i] === b.pixels[i] && a.pixels[i + 1] === b.pixels[i + 1] && a.pixels[i + 2] === b.pixels[i + 2]) continue;
    const pixel = i / 4;
    found.push({ x: (pixel % a.width) - left, y: Math.floor(pixel / a.width) - top });
  }
  return found;
};

/**
 * What differs between a Sage and an Elder, less the stick the Sage leans on:
 * the cane (or the costume's staff) stands in front of the beard and is the
 * Sage's alone too, so its rectangle is not the beard's to answer for.
 */
const withoutStick = (found: { x: number; y: number }[], frame: FrameName, stick: FrameName): { x: number; y: number }[] => {
  const grip = HEAD_ANCHORS[frame]!.cane!;
  const { w, h } = SPRITE_FRAMES[stick];
  const left = Math.floor(SPRITE_FRAMES[frame].w / 2) + grip.x - Math.floor(w / 2);
  const top = SPRITE_FRAMES[frame].h + grip.y - h;
  return found.filter(({ x, y }) => x < left || x >= left + w || y < top || y >= top + h);
};

/** The beard pixels that break the rule: on an edge, in the air, or inside the margin from the collar's top line. */
const violations = (region: GarmentRegion, beard: { x: number; y: number }[]): string[] =>
  beard.flatMap(({ x: px, y: py }) => {
    const cell = cellAt(region, px, py);
    const letter = letterAt(region, cell.x, cell.y);
    const onEdge =
      letter === "k" && [-1, 0, 1].some((dy) => [-1, 0, 1].some((dx) => (dx !== 0 || dy !== 0) && letterAt(region, cell.x + dx, cell.y + dy) === "."));
    const problems: string[] = [];
    if (letter === ".") problems.push("in the air");
    if (onEdge) problems.push("on the silhouette's edge");
    if (cell.y >= region.neck - 1) {
      const row = [...region.head, ...region.rows][cell.y]!;
      const left = row.search(/[^.]/);
      const right = row.length - 1 - [...row].reverse().join("").search(/[^.]/);
      if (cell.x <= left + MARGIN_CELLS || cell.x >= right - MARGIN_CELLS) problems.push("within the margin");
    }
    return problems.length > 0 ? [`frame pixel ${px},${py} (cell ${cell.x},${cell.y}) ${problems.join(", ")}`] : [];
  });

const keep = async (page: Page, testInfo: TestInfo, name: string, frame: FrameName): Promise<void> => {
  // The body, at 8x: the crop is the frame's own rectangle as the canvas paints it.
  const dir = process.env.E2E_SCREENSHOT_DIR ?? testInfo.outputDir;
  const box = (await page.locator("canvas").boundingBox())!;
  const f = SPRITE_FRAMES[frame];
  const scale = box.width / 260;
  await page.screenshot({
    path: `${dir}/${name}`,
    clip: {
      x: box.x + Math.round(130 - f.w / 2) * scale,
      y: box.y + Math.round(PET_Y - f.h) * scale,
      width: f.w * scale,
      height: f.h * scale,
    },
  });
};

test.describe("a Sage in costume, in the real room", () => {
  test.use({ deviceScaleFactor: 8 });

  for (const frame of SIDE_POSES) {
    test(`keeps its moustache off the cloth's edge on ${frame}`, async ({ page }, testInfo) => {
      await openHarness(page);
      const region = GARMENT_REGIONS[frame]!;
      const options = { frame, holidayId: "halloween", hour: DAYTIME } as const;

      const sage = await paint(page, { ...options, stage: "SAGE" });
      const elder = await paint(page, { ...options, stage: "ELDER" });
      const beard = withoutStick(differing(sage, elder, frame), frame, "wizardStaff");
      expect(beard.length, "the Sage's beard is painted").toBeGreaterThan(50);
      expect(violations(region, beard)).toEqual([]);

      if (frame === "idleSide1") {
        await paint(page, { ...options, stage: "SAGE" });
        await keep(page, testInfo, "live-sage-8x.png", frame);
      }
    });
  }
});

test.describe("a Sage in its own cloak, in the real room", () => {
  test.use({ deviceScaleFactor: 8 });

  // The cloak's cloth, to tell the coat from the fur and the floor in the crops.
  const CLOAK_RED = [176, 44, 36];

  for (const frame of ["idleSide1", "walk1", "meditate1"] as const) {
    test(`wears the cloak on ${frame}`, async ({ page }, testInfo) => {
      await openHarness(page);
      const options = { frame, holidayId: null, hour: DAYTIME } as const;
      const sage = await paint(page, { ...options, stage: "SAGE" });
      const elder = await paint(page, { ...options, stage: "ELDER" });
      const dressed = differing(sage, elder, frame).filter(({ x, y }) => {
        const i = ((y + Math.round(PET_Y - SPRITE_FRAMES[frame].h)) * sage.width + x + Math.round(sage.petX - SPRITE_FRAMES[frame].w / 2)) * 4;
        return CLOAK_RED.every((channel, c) => sage.pixels[i + c] === channel);
      });
      expect(dressed.length, "the cloak's cloth is painted").toBeGreaterThan(200);

      await paint(page, { ...options, stage: "SAGE" });
      await keep(page, testInfo, `live-cloak-${frame}-8x.png`, frame);
    });
  }
});
