import { describe, expect, it } from "vitest";
import { genesis } from "./genesis";
import { isSpectacleMood, spectacleMood, SPECTACLE_MOODS } from "./secret";
import { TEST_GENERATION } from "./testkit";
import type { PetState } from "./model";

const stateWith = (fields: Partial<PetState>): PetState => ({ ...genesis(TEST_GENERATION), ...fields });

const EGG = stateWith({ bornAtTick: null, diedAtTick: null, asleep: false });
const AWAKE = stateWith({ bornAtTick: 0, diedAtTick: null, asleep: false });
const ASLEEP = stateWith({ bornAtTick: 0, diedAtTick: null, asleep: true });
const DEAD = stateWith({ bornAtTick: 0, diedAtTick: 900, asleep: false });

describe("spectacle mood (SPEC §26.3)", () => {
  it("parties for a waking pet and for the egg", () => {
    expect(spectacleMood(AWAKE)).toBe("party");
    expect(spectacleMood(EGG)).toBe("party");
  });

  it("gives a sleeping pet the stars rather than a smash cut", () => {
    expect(spectacleMood(ASLEEP)).toBe("stars");
  });

  it("gives death the stars whatever the hour", () => {
    // The memorial never parties — not while the room happens to be awake,
    // and not on the tick the pet would otherwise have been sleeping.
    expect(spectacleMood(DEAD)).toBe("stars");
    expect(spectacleMood({ ...DEAD, asleep: true })).toBe("stars");
  });

  it("prefers death over sleep when both would apply", () => {
    expect(spectacleMood({ ...ASLEEP, diedAtTick: 900 })).toBe("stars");
  });

  it("is pure — the same state always yields the same mood", () => {
    for (const state of [EGG, AWAKE, ASLEEP, DEAD]) {
      expect(spectacleMood(state)).toBe(spectacleMood(state));
    }
  });

  it("only ever returns a mood the renderer knows how to draw", () => {
    for (const state of [EGG, AWAKE, ASLEEP, DEAD]) {
      expect(SPECTACLE_MOODS).toContain(spectacleMood(state));
    }
  });
});

describe("isSpectacleMood", () => {
  it("accepts the two moods and nothing else", () => {
    expect(isSpectacleMood("party")).toBe(true);
    expect(isSpectacleMood("stars")).toBe(true);
    expect(isSpectacleMood("confetti")).toBe(false);
    expect(isSpectacleMood("")).toBe(false);
    expect(isSpectacleMood(undefined)).toBe(false);
    expect(isSpectacleMood(null)).toBe(false);
    expect(isSpectacleMood(0)).toBe(false);
  });
});
