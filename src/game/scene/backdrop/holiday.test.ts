// What a holiday adds to the window (SPEC §22.11): bats across the night pane
// and a tinted moon, held still under reduced motion like the rest of the sky.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { celestialAt, skyMomentAt } from "@/sim/atmosphere";
import type { HolidayScene } from "../holidays/scene";
import { Backdrop } from "./index";
import type { BackdropKey } from "./compose";
import { hex, type RGB } from "./theme";

const MOON: RGB = [255, 160, 60];
const BAT_COLOR = "#17102a";

const scene = vi.hoisted(() => ({ window: { bats: true, moon: null as RGB | null } }));

vi.mock("../holidays", async () => {
  const { CABIN: theme } = await import("./theme");
  const { TEST_GARMENT } = await import("../garment.testkit");
  const holiday = (): HolidayScene => ({
    id: "halloween",
    theme,
    props: [],
    costume: { hat: "coffeeMug", robe: TEST_GARMENT },
    window: scene.window,
  });
  return { holidayScene: holiday };
});

beforeEach(() => {
  scene.window = { bats: true, moon: null };
});

const keyAt = (hour: number, holidayId: BackdropKey["holidayId"] = "halloween"): BackdropKey => {
  const moment = skyMomentAt(hour, 0);
  return {
    venueId: "home",
    themeId: "cozy",
    holidayId,
    fireworks: false,
    segment: moment.segment,
    next: moment.next,
    blend: moment.blend,
    weather: "clear",
    season: "summer",
    sunStep: Math.round(moment.sunHeight * 8),
    condition: "well",
  };
};

/** Every colour a rectangle was filled with, with where. */
const paint = (hour: number, nowMs: number, reducedMotion = false, holidayId: BackdropKey["holidayId"] = "halloween") => {
  const fills: { color: string; x: number; y: number }[] = [];
  const ctx = {
    fillStyle: "",
    globalAlpha: 1,
    imageSmoothingEnabled: false,
    save: () => {},
    restore: () => {},
    beginPath: () => {},
    rect: () => {},
    clip: () => {},
    drawImage: () => {},
    createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
    putImageData: () => {},
    fillRect(x: number, y: number) {
      fills.push({ color: String(this.fillStyle), x, y });
    },
  };
  new Backdrop().render(ctx as unknown as CanvasRenderingContext2D, keyAt(hour, holidayId), celestialAt(hour, 0), 7, nowMs, reducedMotion);
  return fills;
};

const bats = (fills: ReturnType<typeof paint>) => fills.filter((fill) => fill.color === BAT_COLOR);

describe("a holiday's window", () => {
  it("sends bats across the pane at night", () => {
    expect(bats(paint(1, 5_000)).length).toBeGreaterThan(0);
  });

  it("flies them, and holds them still under reduced motion", () => {
    expect(bats(paint(1, 5_000))).not.toEqual(bats(paint(1, 9_000)));
    expect(bats(paint(1, 5_000, true))).toEqual(bats(paint(1, 9_000, true)));
  });

  it("keeps them out of the daytime sky, and off a scene without them", () => {
    expect(bats(paint(13, 5_000))).toEqual([]);
    scene.window = { bats: false, moon: null };
    expect(bats(paint(1, 5_000))).toEqual([]);
  });

  it("draws no bats on an ordinary night", () => {
    expect(bats(paint(1, 5_000, false, null))).toEqual([]);
  });

  it("tints the moon only when the scene says so", () => {
    expect(paint(1, 5_000).some((fill) => fill.color === hex(MOON))).toBe(false);
    scene.window = { bats: false, moon: MOON };
    expect(paint(1, 5_000).some((fill) => fill.color === hex(MOON))).toBe(true);
    expect(paint(1, 5_000, false, null).some((fill) => fill.color === hex(MOON))).toBe(false);
  });
});
