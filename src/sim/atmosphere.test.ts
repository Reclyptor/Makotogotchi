import { describe, expect, it } from "vitest";
import {
  BLEND_STEPS,
  DAY_SEGMENTS,
  seasonFor,
  skyMomentAt,
  venueAt,
  WEATHERS,
  weatherFor,
  type Season,
  type Weather,
} from "./atmosphere";
import { SLEEP_HOUR, WAKE_HOUR } from "./tuning";

describe("sky moments", () => {
  it("walks the whole day without leaving the segment table", () => {
    for (let minutes = 0; minutes < 24 * 60; minutes++) {
      const moment = skyMomentAt(Math.floor(minutes / 60), minutes % 60);
      expect(DAY_SEGMENTS).toContain(moment.segment);
      expect(DAY_SEGMENTS).toContain(moment.next);
      expect(moment.blend).toBeGreaterThanOrEqual(0);
      expect(moment.blend).toBeLessThan(BLEND_STEPS);
      expect(moment.progress).toBeGreaterThanOrEqual(0);
      expect(moment.progress).toBeLessThan(1);
    }
  });

  it("agrees with the pet's sleep schedule", () => {
    // The pet wakes into morning light and goes to bed after dark.
    expect(skyMomentAt(WAKE_HOUR, 0).segment).toBe("morning");
    expect(skyMomentAt(WAKE_HOUR - 1, 0).segment).toBe("dawn");
    expect(skyMomentAt(SLEEP_HOUR, 0).segment).toBe("night");
    expect(skyMomentAt(2, 0).segment).toBe("night");
    expect(skyMomentAt(12, 0).segment).toBe("midday");
  });

  it("dissolves into the next segment only as a boundary approaches", () => {
    // Mid-segment is settled: the sky is not blending into anything.
    const settled = skyMomentAt(12, 0);
    expect(settled.blend).toBe(0);
    expect(settled.next).toBe(settled.segment);

    // Just before dusk begins at 18:00, afternoon is dissolving into it.
    const dissolving = skyMomentAt(17, 50);
    expect(dissolving.segment).toBe("afternoon");
    expect(dissolving.next).toBe("dusk");
    expect(dissolving.blend).toBeGreaterThan(0);

    // The dissolve advances monotonically toward the boundary.
    const earlier = skyMomentAt(17, 30).blend;
    const later = skyMomentAt(17, 55).blend;
    expect(later).toBeGreaterThan(earlier);
  });

  it("raises and lowers the sun across the daylight hours", () => {
    expect(skyMomentAt(2, 0).sunHeight).toBe(0);
    expect(skyMomentAt(23, 0).sunHeight).toBe(0);
    const noon = skyMomentAt(13, 0).sunHeight;
    expect(noon).toBeGreaterThan(0.9);
    expect(skyMomentAt(8, 0).sunHeight).toBeLessThan(noon);
    expect(skyMomentAt(19, 0).sunHeight).toBeLessThan(noon);
  });
});

describe("seasons and weather", () => {
  it("maps months to northern-hemisphere seasons", () => {
    const expected: Record<number, Season> = {
      1: "winter", 2: "winter", 3: "spring", 4: "spring", 5: "spring",
      6: "summer", 7: "summer", 8: "summer", 9: "autumn", 10: "autumn",
      11: "autumn", 12: "winter",
    };
    for (const [month, season] of Object.entries(expected)) {
      expect(seasonFor(Number(month))).toBe(season);
    }
  });

  it("is deterministic per day and stable within it", () => {
    for (let day = 0; day < 50; day++) {
      const first = weatherFor(1234, day, "spring");
      expect(weatherFor(1234, day, "spring")).toBe(first);
      expect(WEATHERS).toContain(first);
    }
  });

  it("never snows outside winter, and does snow in it", () => {
    const seen: Record<Season, Set<Weather>> = {
      spring: new Set(), summer: new Set(), autumn: new Set(), winter: new Set(),
    };
    for (let day = 0; day < 400; day++) {
      for (const season of ["spring", "summer", "autumn", "winter"] as const) {
        seen[season].add(weatherFor(99, day, season));
      }
    }
    expect(seen.spring.has("snow")).toBe(false);
    expect(seen.summer.has("snow")).toBe(false);
    expect(seen.autumn.has("snow")).toBe(false);
    expect(seen.winter.has("snow")).toBe(true);
    // Every season still offers variety rather than one fixed forecast.
    for (const season of ["spring", "summer", "autumn", "winter"] as const) {
      expect(seen[season].size).toBeGreaterThanOrEqual(3);
    }
  });

  it("gives different generations different weather", () => {
    const a = Array.from({ length: 30 }, (_, day) => weatherFor(1, day, "autumn"));
    const b = Array.from({ length: 30 }, (_, day) => weatherFor(2, day, "autumn"));
    expect(a.join()).not.toBe(b.join());
  });
});

describe("day-trip venues (SPEC §22.8)", () => {
  const OWNED = ["garden", "meadow"] as const;

  it("draws the same venue for the same seed and day on every client", () => {
    for (let day = 0; day < 500; day++) {
      expect(venueAt(0xc0ffee, day, OWNED)).toBe(venueAt(0xc0ffee, day, OWNED));
    }
  });

  it("stays home with nothing funded, and roughly half the time otherwise", () => {
    let home = 0;
    for (let day = 0; day < 2000; day++) {
      expect(venueAt(7, day, [])).toBe("home");
      if (venueAt(7, day, OWNED) === "home") home++;
    }
    expect(home).toBeGreaterThan(2000 * 0.44);
    expect(home).toBeLessThan(2000 * 0.56);
  });

  it("only ever picks owned venues, whatever order the pool arrives in", () => {
    for (let day = 0; day < 500; day++) {
      const venue = venueAt(21, day, OWNED);
      expect(["home", ...OWNED]).toContain(venue);
      expect(venueAt(21, day, ["meadow", "garden"])).toBe(venue);
      expect(venueAt(21, day, ["garden", "meadow", "not-a-venue"])).toBe(venue);
    }
  });

  it("a funded venue joins the rotation without disturbing home days", () => {
    for (let day = 0; day < 500; day++) {
      const before = venueAt(99, day, OWNED);
      const after = venueAt(99, day, [...OWNED, "beach"]);
      // The home-or-away draw is independent of the pool, so a mid-day
      // funding can move WHICH venue but never home-vs-away (SPEC §22.8).
      expect(before === "home").toBe(after === "home");
    }
  });
});
