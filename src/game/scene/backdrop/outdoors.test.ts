// The outdoor venues hold the room's own promises (SPEC §22.6, §22.8):
// every ground pixel is a named venue colour, seasons genuinely change the
// place, winter buries it, and the whole scene is deterministic across every
// hour, weather, and season.

import { describe, expect, it } from "vitest";
import { skyMomentAt, SEASONS, WEATHERS, type Season } from "@/sim/atmosphere";
import { ROOM_HEIGHT, ROOM_WIDTH, type BackdropKey } from "./compose";
import {
  BEACH,
  beachHorizonAt,
  BLOSSOM,
  blossomHorizonAt,
  composeBeach,
  composeBlossom,
  composeForest,
  composeGarden,
  composeMeadow,
  composeMountain,
  composePond,
  composeShrine,
  FOREST,
  forestHorizonAt,
  GARDEN,
  gardenHorizonAt,
  HORIZON_Y,
  MEADOW,
  meadowHorizonAt,
  MOUNTAIN,
  mountainHorizonAt,
  POND,
  pondHorizonAt,
  SHRINE,
  shrineHorizonAt,
} from "./outdoors";
import { hex, type RGB } from "./theme";

const keyAt = (hour: number, extra: Partial<BackdropKey> = {}): BackdropKey => {
  const moment = skyMomentAt(hour, 0);
  return {
    venueId: "garden",
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

const SNOW = [
  [186, 196, 214],
  [204, 214, 228],
  [222, 230, 242],
] as const;

const VENUES = [
  {
    id: "garden",
    compose: composeGarden,
    horizonAt: gardenHorizonAt,
    growing: GARDEN.grass,
    named: [
      ...Object.values(GARDEN.grass).flat(),
      ...SNOW,
      GARDEN.blade,
      GARDEN.hedge,
      GARDEN.hedgeLight,
      GARDEN.fence,
      GARDEN.fenceLight,
      GARDEN.path,
      GARDEN.pathEdge,
      GARDEN.soil,
      GARDEN.soilDark,
      GARDEN.leaf,
      GARDEN.fruit,
      GARDEN.bloomPink,
      GARDEN.bloomGold,
      GARDEN.sunPatch,
      GARDEN.moonPatch,
    ],
  },
  {
    id: "meadow",
    compose: composeMeadow,
    horizonAt: meadowHorizonAt,
    growing: MEADOW.grass,
    named: [
      ...Object.values(MEADOW.grass).flat(),
      ...SNOW,
      MEADOW.blade,
      MEADOW.hillFar,
      MEADOW.treeline,
      MEADOW.poppy,
      MEADOW.daisy,
      MEADOW.violet,
      MEADOW.stalk,
      MEADOW.sunPatch,
      MEADOW.moonPatch,
    ],
  },
  {
    id: "beach",
    compose: composeBeach,
    horizonAt: beachHorizonAt,
    growing: BEACH.sand,
    named: [
      ...Object.values(BEACH.sand).flat(),
      ...SNOW,
      BEACH.pebble,
      ...BEACH.sea,
      BEACH.sparkle,
      BEACH.foam,
      BEACH.sunPatch,
      BEACH.moonPatch,
    ],
  },
  {
    id: "forest",
    compose: composeForest,
    horizonAt: forestHorizonAt,
    growing: FOREST.floor,
    named: [
      ...Object.values(FOREST.floor).flat(),
      ...SNOW,
      FOREST.fern,
      FOREST.canopy,
      FOREST.canopyLight,
      FOREST.trunk,
      FOREST.trunkLight,
      FOREST.stumpTop,
      FOREST.stumpRing,
      FOREST.stumpSide,
      FOREST.stumpShadow,
      FOREST.sunPatch,
      FOREST.moonPatch,
    ],
  },
  {
    id: "shrine",
    compose: composeShrine,
    horizonAt: shrineHorizonAt,
    growing: SHRINE.stone,
    named: [
      ...Object.values(SHRINE.stone).flat(),
      ...SNOW,
      SHRINE.moss,
      SHRINE.cedar,
      SHRINE.cedarLight,
      SHRINE.vermilion,
      SHRINE.vermilionDark,
      SHRINE.tread,
      SHRINE.riser,
      SHRINE.lantern,
      SHRINE.lanternLight,
      SHRINE.lanternDark,
      SHRINE.sunPatch,
      SHRINE.moonPatch,
    ],
  },
  {
    id: "pond",
    compose: composePond,
    horizonAt: pondHorizonAt,
    growing: POND.bank,
    named: [
      ...Object.values(POND.bank).flat(),
      ...SNOW,
      POND.blade,
      POND.reed,
      POND.reedLight,
      ...POND.water,
      ...POND.ice,
      POND.glint,
      POND.pad,
      POND.padLight,
      POND.bloom,
      POND.sunPatch,
      POND.moonPatch,
    ],
  },
  {
    id: "blossom",
    compose: composeBlossom,
    horizonAt: blossomHorizonAt,
    growing: BLOSSOM.lawn,
    named: [
      ...Object.values(BLOSSOM.lawn).flat(),
      ...SNOW,
      BLOSSOM.blade,
      ...BLOSSOM.canopy,
      BLOSSOM.trunk,
      BLOSSOM.trunkLight,
      BLOSSOM.gravel,
      BLOSSOM.gravelEdge,
      BLOSSOM.bench,
      BLOSSOM.benchDark,
      BLOSSOM.fallen,
      BLOSSOM.sunPatch,
      BLOSSOM.moonPatch,
    ],
  },
  {
    id: "mountain",
    compose: composeMountain,
    horizonAt: mountainHorizonAt,
    growing: MOUNTAIN.shore,
    named: [
      ...Object.values(MOUNTAIN.shore).flat(),
      ...SNOW,
      MOUNTAIN.pebble,
      ...MOUNTAIN.lake,
      MOUNTAIN.lakeIce,
      MOUNTAIN.reflectSnow,
      MOUNTAIN.reflectRock,
      MOUNTAIN.sunPatch,
      MOUNTAIN.moonPatch,
    ],
  },
] as const;

describe.each(VENUES)("the $id venue", ({ compose, horizonAt, growing, named }) => {
  it("fills every pixel opaquely at every hour, weather, and season", () => {
    for (const hour of [3, 9, 13, 20]) {
      for (const weather of WEATHERS) {
        for (const season of SEASONS) {
          const buffer = compose(keyAt(hour, { weather, season }));
          expect(buffer.length).toBe(ROOM_WIDTH * ROOM_HEIGHT * 4);
          for (let i = 3; i < buffer.length; i += 4) {
            if (buffer[i] !== 255) throw new Error(`transparent pixel at ${(i - 3) / 4} (${hour}h ${weather} ${season})`);
          }
        }
      }
    }
  });

  it("is deterministic — the same day twice is the same pixels", () => {
    expect(Array.from(compose(keyAt(9)))).toEqual(Array.from(compose(keyAt(9))));
  });

  it("paints the ground only in colours the venue named", () => {
    const allowed = new Set(named.map((color) => hex(color as RGB)));
    for (const season of SEASONS) {
      const buffer = compose(keyAt(13, { season }));
      const strays = new Set<string>();
      for (let y = HORIZON_Y; y < ROOM_HEIGHT; y++) {
        for (let x = 0; x < ROOM_WIDTH; x++) {
          const color = hex(pixelAt(buffer, x, y));
          if (!allowed.has(color)) strays.add(`${color} @${x},${y} (${season})`);
        }
      }
      expect([...strays]).toEqual([]);
    }
  });

  it("changes with the seasons, and winter buries the growing ground entirely", () => {
    const groundRow = (season: Season): string => {
      const buffer = compose(keyAt(13, { season }));
      const row: string[] = [];
      for (let x = 70; x < 120; x++) row.push(hex(pixelAt(buffer, x, ROOM_HEIGHT - 10)));
      return row.join(",");
    };
    expect(new Set([groundRow("summer"), groundRow("autumn"), groundRow("winter")]).size).toBe(3);

    const winter = compose(keyAt(13, { season: "winter" }));
    const growingSeasons = ["spring", "summer", "autumn"] as const;
    const growingGround = new Set(growingSeasons.flatMap((season) => [...growing[season]]).map((color) => hex(color as RGB)));
    for (let y = HORIZON_Y; y < ROOM_HEIGHT; y += 7) {
      for (let x = 0; x < ROOM_WIDTH; x += 7) {
        expect(growingGround.has(hex(pixelAt(winter, x, y)))).toBe(false);
      }
    }
  });

  it("keeps its horizon inside the sky and varied enough to read as a place", () => {
    const heights = new Set<number>();
    for (let x = 0; x < ROOM_WIDTH; x++) {
      const height = horizonAt(x);
      expect(height).toBeGreaterThanOrEqual(4);
      expect(height).toBeLessThan(HORIZON_Y);
      heights.add(height);
    }
    expect(heights.size).toBeGreaterThan(1);
  });

  it("wears down as the pet's condition worsens", () => {
    const brightness = (condition: BackdropKey["condition"]): number => {
      const buffer = compose(keyAt(13, { condition }));
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
});

describe("the venues differ", () => {
  it("every venue is somewhere else — no two days out look the same", () => {
    // Cheap to get wrong when a new venue is copied from an old one and its
    // distinguishing features are then drawn off-screen or under the ground.
    const scenes = new Map<string, string>();
    for (const venue of VENUES) {
      const fingerprint = Array.from(venue.compose(keyAt(13))).join(",");
      const twin = [...scenes].find(([, other]) => other === fingerprint)?.[0];
      if (twin !== undefined) throw new Error(`${venue.id} draws exactly what ${twin} draws`);
      scenes.set(venue.id, fingerprint);
    }
    expect(scenes.size).toBe(VENUES.length);
  });

  it("gives each venue its own skyline rather than one shared silhouette", () => {
    const skylines = VENUES.map((venue) =>
      Array.from({ length: ROOM_WIDTH }, (_, x) => venue.horizonAt(x)).join(","),
    );
    expect(new Set(skylines).size).toBe(VENUES.length);
  });
});
