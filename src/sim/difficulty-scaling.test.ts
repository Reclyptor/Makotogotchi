// Dynamic difficulty (SPEC §23). The multiplier is a published contract —
// people can see it in the UI — so its exact values are asserted, not just
// its shape.

import { describe, expect, it } from "vitest";
import { careMultiplier, careMultiplierPermille, DIFFICULTY_BASELINE, worthRecording } from "./difficulty";
import { decayRates } from "./tuning";
import { NEED_KEYS } from "./tuning";

describe("the care multiplier", () => {
  it("matches the table published in the spec", () => {
    const expected: Record<number, number> = {
      0: 1, 1: 1, 2: 1, 3: 1.355, 4: 1.682, 5: 1.988, 6: 2.28, 7: 2.559, 8: 2.828, 9: 3,
    };
    for (const [population, multiplier] of Object.entries(expected)) {
      expect(careMultiplier(Number(population))).toBeCloseTo(multiplier, 3);
    }
  });

  it("never drops below the baseline, however small the community", () => {
    // One person alone must not get an easier pet than two (SPEC §2.5).
    for (const population of [0, 1, 2]) expect(careMultiplier(population)).toBe(1);
  });

  it("stops climbing at three times, however large", () => {
    for (const population of [9, 20, 500, 1_000_000]) expect(careMultiplier(population)).toBe(3);
  });

  it("rises monotonically with the community", () => {
    for (let population = 1; population <= 40; population++) {
      expect(careMultiplierPermille(population)).toBeGreaterThanOrEqual(careMultiplierPermille(population - 1));
    }
  });

  it("treats a missing population as the baseline, so old histories replay unchanged", () => {
    expect(careMultiplierPermille(undefined)).toBe(1000);
    expect(careMultiplierPermille(Number.NaN)).toBe(1000);
    expect(careMultiplier(DIFFICULTY_BASELINE)).toBe(1);
  });
});

describe("recording thresholds", () => {
  it("records a move of a tenth or more, and ignores smaller ones", () => {
    expect(worthRecording(2, 3)).toBe(true); // 1.00× → 1.355×
    expect(worthRecording(2, 2)).toBe(false);
    expect(worthRecording(9, 40)).toBe(false); // both capped at 3×
    expect(worthRecording(undefined, 2)).toBe(false); // baseline is already assumed
    expect(worthRecording(undefined, 5)).toBe(true);
  });

  it("records a shrinking community too, so difficulty comes back down", () => {
    expect(worthRecording(8, 3)).toBe(true);
    expect(worthRecording(6, 2)).toBe(true);
  });
});

describe("decay scaling", () => {
  it("leaves the table untouched at the baseline", () => {
    expect(decayRates("PUP", null, "WAKE", 1000)).toEqual(decayRates("PUP", null, "WAKE"));
  });

  it("scales every need in proportion", () => {
    const base = decayRates("PUP", null, "WAKE");
    const doubled = decayRates("PUP", null, "WAKE", 2000);
    for (const need of NEED_KEYS) expect(doubled[need]).toBe(Math.round(base[need] * 2));
  });

  it("never scales sleep's energy recovery, which is not decay", () => {
    // Energy decay is zero while asleep; recovery is applied separately, so
    // no multiplier can turn a night's rest into a drain.
    for (const permille of [1000, 2000, 3000]) {
      expect(decayRates("PUP", null, "SLEEP", permille).energy).toBe(0);
    }
  });

  it("keeps every scaled rate an exact integer", () => {
    for (const permille of [1355, 1682, 1988, 2280, 2559, 2828, 3000]) {
      const rates = decayRates("ELDER", "FRAIL", "WAKE", permille);
      for (const need of NEED_KEYS) expect(Number.isInteger(rates[need])).toBe(true);
    }
  });
});
