import { describe, expect, it } from "vitest";
import {
  BLEND_STEPS,
  DAY_SEGMENTS,
  seasonFor,
  skyMomentAt,
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
