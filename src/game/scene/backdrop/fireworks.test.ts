// New Year's Eve's fireworks in the window (SPEC §22.11): bursts in the scene's
// palette that move live and are held, as one burst in the first colour, under
// reduced motion. The room around them is the ordinary room, so they ride the
// backdrop's key rather than a holiday.

import { describe, expect, it } from "vitest";
import { celestialAt, skyMomentAt } from "@/sim/atmosphere";
import { holidayScene } from "../holidays";
import { Backdrop } from "./index";
import type { BackdropKey } from "./compose";
import { hex } from "./theme";

const PALETTE = holidayScene("newYear").window.fireworks!;
const NIGHT = 23;

const keyAt = (fireworks: boolean): BackdropKey => {
  const moment = skyMomentAt(NIGHT, 30);
  return {
    venueId: "home",
    themeId: "cozy",
    holidayId: null,
    fireworks,
    segment: moment.segment,
    next: moment.next,
    blend: moment.blend,
    weather: "clear",
    season: "winter",
    sunStep: 0,
    condition: "well",
  };
};

/** Every colour a rectangle was filled with, with where and at what opacity. */
const paint = (fireworks: boolean, nowMs: number, reducedMotion = false) => {
  const fills: { color: string; x: number; y: number; alpha: number }[] = [];
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
      fills.push({ color: String(this.fillStyle), x, y, alpha: this.globalAlpha });
    },
  };
  new Backdrop().render(ctx as unknown as CanvasRenderingContext2D, keyAt(fireworks), celestialAt(NIGHT, 30), 7, nowMs, reducedMotion);
  return fills.filter((fill) => PALETTE.some((colour) => hex(colour) === fill.color));
};

describe("the Eve's fireworks", () => {
  it("light the pane in the palette's colours, and nothing when they are not lit", () => {
    expect(paint(true, 9_000).length).toBeGreaterThan(0);
    expect(paint(false, 9_000)).toEqual([]);
  });

  it("move live", () => {
    expect(paint(true, 9_000)).not.toEqual(paint(true, 11_000));
  });

  it("are held still under reduced motion: one burst, in the first colour", () => {
    const early = paint(true, 9_000, true);
    expect(early).toEqual(paint(true, 40_000, true));
    expect(early.length).toBeGreaterThan(0);
    expect(new Set(early.map((fill) => fill.color))).toEqual(new Set([hex(PALETTE[0]!)]));
  });

  it("keep within the glass", () => {
    for (const now of [1_000, 5_000, 9_000, 13_000]) {
      for (const fill of paint(true, now)) {
        expect(fill.x, `x at ${now}`).toBeGreaterThanOrEqual(152);
        expect(fill.x, `x at ${now}`).toBeLessThanOrEqual(216);
        expect(fill.y, `y at ${now}`).toBeLessThanOrEqual(66);
      }
    }
  });

  it("fade as they spread", () => {
    const alphas = [5_300, 6_200, 7_200].map((now) => Math.max(0, ...paint(true, now).map((fill) => fill.alpha)));
    expect(alphas.some((alpha) => alpha < 1)).toBe(true);
  });
});
