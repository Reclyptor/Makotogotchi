import { describe, expect, it } from "vitest";
import {
  BALLOT_MAX_EXTRA_TICKETS,
  BLEND_STEPS,
  DAY_SEGMENTS,
  rotationPool,
  seasonFor,
  skyMomentAt,
  ticketsFor,
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

  it("draws the same venue for the same seed, day and ballot on every client", () => {
    for (let day = 0; day < 500; day++) {
      expect(venueAt(0xc0ffee, day, OWNED, { meadow: 3 })).toBe(venueAt(0xc0ffee, day, OWNED, { meadow: 3 }));
    }
  });

  it("stays home every single day until somebody votes", () => {
    // The whole rule, and the one that replaced the home-or-away roll: an
    // outing is not something that happens to a room (SPEC §22.9).
    for (let day = 0; day < 2000; day++) {
      expect(venueAt(7, day, [])).toBe("home");
      expect(venueAt(7, day, OWNED)).toBe("home");
      expect(venueAt(7, day, OWNED, {})).toBe("home");
      expect(venueAt(7, day, OWNED, { garden: 0 })).toBe("home");
    }
  });

  it("goes out every day once a venue is backed, and to the one that was backed", () => {
    for (let day = 0; day < 500; day++) {
      expect(venueAt(7, day, OWNED, { meadow: 1 })).toBe("meadow");
    }
  });

  it("only ever picks owned venues, whatever order the pool arrives in", () => {
    const ballot = { garden: 4, meadow: 4 };
    for (let day = 0; day < 500; day++) {
      const venue = venueAt(21, day, OWNED, ballot);
      expect([...OWNED]).toContain(venue);
      expect(venueAt(21, day, ["meadow", "garden"], ballot)).toBe(venue);
      expect(venueAt(21, day, ["garden", "meadow", "not-a-venue"], ballot)).toBe(venue);
    }
  });

  it("will not send Makoto somewhere the room never unlocked", () => {
    // A ballot naming an unfunded venue is ignored rather than obeyed — the
    // pool is checked as well as the tickets.
    for (let day = 0; day < 500; day++) {
      expect(venueAt(99, day, OWNED, { mountain: 30 })).toBe("home");
      expect(venueAt(99, day, OWNED, { mountain: 30, meadow: 2 })).toBe("meadow");
    }
  });
});

describe("the venue ballot (SPEC §22.9)", () => {
  const OWNED = ["garden", "meadow", "beach"] as const;

  it("is a race, not a tally — the favourite wins most days, never all", () => {
    let underdog = 0;
    for (let day = 0; day < 2000; day++) {
      const venue = venueAt(9, day, OWNED, { meadow: BALLOT_MAX_EXTRA_TICKETS, garden: 1 });
      expect(["meadow", "garden"]).toContain(venue);
      if (venue === "garden") underdog++;
    }
    // One ticket against thirty: a long shot, but never a wasted coin.
    expect(underdog).toBeGreaterThan(0);
    expect(underdog / 2000).toBeLessThan(0.1);
  });

  it("splits evenly when two venues are backed equally", () => {
    let garden = 0;
    for (let day = 0; day < 2000; day++) {
      if (venueAt(5, day, OWNED, { garden: 10, meadow: 10 }) === "garden") garden++;
    }
    expect(garden).toBeGreaterThan(2000 * 0.44);
    expect(garden).toBeLessThan(2000 * 0.56);
  });

  it("caps a venue so coins alone cannot buy a certain day", () => {
    let outvoted = 0;
    for (let day = 0; day < 2000; day++) {
      // However much is thrown at the meadow, it is clamped to the ceiling,
      // so a single ticket on the garden keeps its ~1-in-31 chance.
      if (venueAt(13, day, OWNED, { meadow: 10_000, garden: 1 }) === "garden") outvoted++;
    }
    expect(outvoted).toBeGreaterThan(0);
  });

  it("clamps every shape the wire can carry, so two viewers cannot disagree", () => {
    for (let day = 0; day < 200; day++) {
      const capped = venueAt(11, day, OWNED, { meadow: BALLOT_MAX_EXTRA_TICKETS, garden: 1 });
      expect(venueAt(11, day, OWNED, { meadow: 9999, garden: 1 })).toBe(capped);
      // Anything that is not a positive count is no vote at all, so the day
      // stays at home rather than becoming an outing nobody paid for.
      expect(venueAt(11, day, OWNED, { garden: -5 })).toBe("home");
      expect(venueAt(11, day, OWNED, { garden: Number.NaN })).toBe("home");
      expect(venueAt(11, day, OWNED, { garden: Number.POSITIVE_INFINITY })).toBe("home");
      expect(venueAt(11, day, OWNED, { garden: 0.9 })).toBe("home");
      expect(venueAt(11, day, OWNED, { "not-a-venue": 30 })).toBe("home");
      expect(venueAt(11, day, OWNED, { garden: 2.7 })).toBe(venueAt(11, day, OWNED, { garden: 2 }));
    }
  });

  it("picks a day's tickets by matching the day, not by position", () => {
    const ballots = [
      { forDay: 20_000, tickets: { garden: 4 } },
      { forDay: 20_001, tickets: { meadow: 7 } },
    ];
    expect(ticketsFor(ballots, 20_001)).toEqual({ meadow: 7 });
    // A day nobody voted on is an empty ballot, not the nearest one.
    expect(ticketsFor(ballots, 20_002)).toEqual({});
    expect(ticketsFor([], 20_000)).toEqual({});
  });
});

describe("the rotation pool", () => {
  it("is the free venues plus whatever the room funded, in catalog order", () => {
    expect(rotationPool([])).toEqual(["garden", "meadow"]);
    expect(rotationPool(["mountain", "beach"])).toEqual(["garden", "meadow", "beach", "mountain"]);
  });

  it("ignores decor that is not a venue, and never lists home", () => {
    expect(rotationPool(["plant", "kotatsu", "theme_cabin", "home"])).toEqual(["garden", "meadow"]);
  });

  it("cannot be made to list a venue twice", () => {
    const pool = rotationPool(["garden", "garden", "pond", "pond"]);
    expect(pool).toEqual(["garden", "meadow", "pond"]);
  });
});
