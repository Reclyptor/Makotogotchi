import { describe, expect, it } from "vitest";
import { ambientAt, AMBIENT_EVENTS, isAmbientEvent } from "./ambient";
import { TICKS_PER_HOUR } from "./tuning";

const SEED = 0xc0ffee;
const SPAN = 400 * TICKS_PER_HOUR;

const sweep = (asleep: boolean): ReturnType<typeof ambientAt>[] =>
  Array.from({ length: SPAN }, (_, tick) => ambientAt(SEED, tick, asleep)).filter((event) => event !== null);

describe("shared rare events (SPEC §21.5)", () => {
  it("fires for the same seed and tick on every client", () => {
    for (let tick = 0; tick < 5000; tick++) {
      expect(ambientAt(SEED, tick, false)).toBe(ambientAt(SEED, tick, false));
    }
  });

  it("averages roughly one moment per hour", () => {
    const hours = SPAN / TICKS_PER_HOUR;
    const count = sweep(false).length;
    expect(count).toBeGreaterThan(hours * 0.7);
    expect(count).toBeLessThan(hours * 1.3);
  });

  it("only offers what the moment allows", () => {
    // Asleep is night: stars and noises, never a daytime butterfly or a dig.
    expect(new Set(sweep(true))).toEqual(new Set(["shooting-star", "mystery-noise"]));
    expect(new Set(sweep(false))).toEqual(new Set(["butterfly", "coin-dig", "mystery-noise"]));
  });

  it("weights the table: the heavier entries really do come up more often", () => {
    const awake = sweep(false);
    const count = (event: string): number => awake.filter((entry) => entry === event).length;
    expect(count("butterfly")).toBeGreaterThan(count("coin-dig"));
    expect(count("coin-dig")).toBeGreaterThan(count("mystery-noise"));
  });

  it("recognizes its own event names and nothing else", () => {
    for (const event of AMBIENT_EVENTS) expect(isAmbientEvent(event)).toBe(true);
    expect(isAmbientEvent("EVOLVED")).toBe(false);
    expect(isAmbientEvent(undefined)).toBe(false);
  });
});
