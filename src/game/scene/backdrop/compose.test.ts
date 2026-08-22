// The backdrop is pure arithmetic over a palette, so its promises (SPEC
// §22.6) are testable rather than a matter of taste.

import { describe, expect, it } from "vitest";
import { composeBackdrop, GLASS, keyOf, ROOM_HEIGHT, ROOM_WIDTH, type BackdropKey } from "./compose";
import { venueSpec } from "./venues";
import { COZY, hex, type RGB } from "./theme";
import { skyMomentAt } from "@/sim/atmosphere";

const keyAt = (hour: number, extra: Partial<BackdropKey> = {}): BackdropKey => {
  const moment = skyMomentAt(hour, 0);
  return {
    venueId: "home",
    themeId: "cozy",
    segment: moment.segment,
    next: moment.next,
    blend: moment.blend,
    weather: "clear",
    season: "summer",
    sunStep: Math.round(moment.sunHeight * 8),
    condition: "well",
    ...extra,
  };
};

const pixelAt = (buffer: Uint8ClampedArray, x: number, y: number): RGB => {
  const i = (y * ROOM_WIDTH + x) * 4;
  return [buffer[i]!, buffer[i + 1]!, buffer[i + 2]!];
};

const insideGlass = (x: number, y: number): boolean =>
  x >= GLASS.x && x < GLASS.x + GLASS.w && y >= GLASS.y && y < GLASS.y + GLASS.h;

describe("backdrop composition", () => {
  it("fills every pixel opaquely, at the room's size", () => {
    const buffer = composeBackdrop(keyAt(13));
    expect(buffer.length).toBe(ROOM_WIDTH * ROOM_HEIGHT * 4);
    for (let i = 3; i < buffer.length; i += 4) expect(buffer[i]).toBe(255);
  });

  it("is deterministic — the same room twice is the same pixels", () => {
    expect(Array.from(composeBackdrop(keyAt(9)))).toEqual(Array.from(composeBackdrop(keyAt(9))));
  });

  it("paints the room itself only in colours the theme named", () => {
    // Outside the glass, every pixel must come from a theme ramp. Gradients
    // are dithered between named colours, never blended into new ones.
    const named = new Set(
      [
        ...COZY.wall,
        COZY.stripe,
        COZY.rail.body,
        COZY.rail.highlight,
        COZY.wainscot.panel,
        COZY.wainscot.groove,
        COZY.wainscot.highlight,
        COZY.wainscot.base,
        ...COZY.floor,
        COZY.seam,
        COZY.sunPool,
        COZY.moonPool,
        COZY.rug.border,
        COZY.rug.field,
        COZY.rug.motif,
        COZY.rug.fringe,
        COZY.frame.dark,
        COZY.frame.mid,
        COZY.frame.light,
      ].map(hex),
    );
    const buffer = composeBackdrop(keyAt(13));
    const strays = new Set<string>();
    for (let y = 0; y < ROOM_HEIGHT; y++) {
      for (let x = 0; x < ROOM_WIDTH; x++) {
        if (insideGlass(x, y)) continue;
        const color = hex(pixelAt(buffer, x, y));
        if (!named.has(color)) strays.add(`${color} @${x},${y}`);
      }
    }
    expect([...strays]).toEqual([]);
  });

  it("gives every hour of the day its own sky", () => {
    const sample = (hour: number): string => {
      const buffer = composeBackdrop(keyAt(hour));
      // A row high in the pane, away from the skyline and the mullions.
      const row: string[] = [];
      for (let x = GLASS.x + 2; x < GLASS.x + 20; x++) row.push(hex(pixelAt(buffer, x, GLASS.y + 4)));
      return row.join(",");
    };
    const hours = [3, 6, 9, 13, 17, 20];
    const skies = new Set(hours.map(sample));
    expect(skies.size).toBe(hours.length);
  });

  it("wears the room down as the pet's condition worsens", () => {
    const brightness = (condition: BackdropKey["condition"]): number => {
      const buffer = composeBackdrop(keyAt(13, { condition }));
      let total = 0;
      for (let x = 0; x < ROOM_WIDTH; x += 3) {
        const [r, g, b] = pixelAt(buffer, x, ROOM_HEIGHT - 20);
        total += r + g + b;
      }
      return total;
    };
    expect(brightness("poor")).toBeLessThan(brightness("well"));
    expect(brightness("critical")).toBeLessThan(brightness("poor"));
  });

  it("dispatches home through the venue registry pixel-identically (SPEC §22.8)", () => {
    // The refactor's contract: the home venue IS the untouched composer, so
    // every hour and weather renders byte-for-byte what it did before.
    for (const hour of [3, 13]) {
      for (const weather of ["clear", "rain"] as const) {
        const key = keyAt(hour, { weather });
        expect(Array.from(venueSpec("home").compose(key))).toEqual(Array.from(composeBackdrop(key)));
      }
    }
    // Unknown or not-yet-drawn venues fall back to home, never to a blank.
    expect(venueSpec("not-a-venue").id).toBe("home");
    expect(venueSpec("meadow").compose(keyAt(13))).toEqual(composeBackdrop(keyAt(13)));
    // The cache key tells venues apart.
    expect(keyOf(keyAt(13))).not.toBe(keyOf(keyAt(13, { venueId: "meadow" })));
  });

  it("throws more light across the floor at noon than at midnight", () => {
    const litPixels = (hour: number): number => {
      const buffer = composeBackdrop(keyAt(hour));
      const pool = hex(COZY.sunPool);
      let count = 0;
      for (let y = 130; y < ROOM_HEIGHT; y++) {
        for (let x = 0; x < ROOM_WIDTH; x++) if (hex(pixelAt(buffer, x, y)) === pool) count++;
      }
      return count;
    };
    expect(litPixels(13)).toBeGreaterThan(litPixels(3));
  });
});
