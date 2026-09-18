// Dynamic difficulty (SPEC §23). The multiplier is a published contract —
// people can see it in the UI — so its exact values are asserted, not just
// its shape.
//
// Everything here speaks in presence: thousandths of a caretaker (§23.1), so
// `whole(9)` is the nine caretakers the published table was written for.

import { describe, expect, it } from "vitest";
import {
  careMultiplier,
  careMultiplierPermille,
  DIFFICULTY_BASELINE,
  presencePermilleOf,
  PRESENCE_SCALE,
  worthRecording,
} from "./difficulty";
import {
  decayRates,
  ENERGY_SLEEP_RECOVERY,
  MULTIPLIED_NEEDS,
  NEED_KEYS,
  NEED_MAX,
  SLEEP_HOUR,
  TICKS_PER_DAY,
  TICKS_PER_HOUR,
  WAKE_HOUR,
} from "./tuning";

const whole = (caretakers: number): number => caretakers * PRESENCE_SCALE;

describe("the care multiplier", () => {
  it("matches the table published in the spec", () => {
    const expected: Record<number, number> = {
      0: 1, 1: 1, 2: 1, 3: 1.355, 4: 1.682, 5: 1.988, 6: 2.28, 7: 2.559, 8: 2.828, 9: 3.09, 10: 3.344, 11: 3.591, 12: 3.834, 13: 4,
    };
    for (const [population, multiplier] of Object.entries(expected)) {
      expect(careMultiplier(whole(Number(population)))).toBeCloseTo(multiplier, 3);
    }
  });

  it("never drops below the baseline, however small the community", () => {
    // One person alone must not get an easier pet than two (SPEC §2.5).
    for (const population of [0, 1, 2]) expect(careMultiplier(whole(population))).toBe(1);
  });

  it("stops climbing at four times, however large", () => {
    for (const population of [13, 20, 500, 100_000]) expect(careMultiplier(whole(population))).toBe(4);
  });

  it("rises monotonically with the community, in sevenths as well as wholes", () => {
    // A seventh of a caretaker is the smallest step presence can take: one
    // person, one day. The curve has to be monotonic at that resolution, or a
    // caretaker turning up could make the pet easier.
    const step = Math.round(PRESENCE_SCALE / 7);
    for (let presence = step; presence <= whole(40); presence += step) {
      expect(careMultiplierPermille(presence)).toBeGreaterThanOrEqual(careMultiplierPermille(presence - step));
    }
  });

  it("interpolates between whole caretakers instead of throwing the fraction away", () => {
    // Half way from four caretakers (1.682×) to five (1.988×).
    expect(careMultiplierPermille(whole(4) + PRESENCE_SCALE / 2)).toBe(1835);
    // Every whole caretaker still lands exactly on its table entry, which is
    // what makes a history recorded before presence weighting replay to the
    // multiplier it was lived at.
    expect(careMultiplierPermille(whole(9))).toBe(3090);
    expect(careMultiplierPermille(whole(4))).toBe(1682);
  });

  it("treats a missing population as the baseline, so old histories replay unchanged", () => {
    expect(careMultiplierPermille(undefined)).toBe(1000);
    expect(careMultiplierPermille(Number.NaN)).toBe(1000);
    expect(careMultiplier(whole(DIFFICULTY_BASELINE))).toBe(1);
  });
});

describe("reading presence off a state (SPEC §23.1)", () => {
  it("prefers the recorded presence", () => {
    expect(presencePermilleOf({ population: 53, populationPermille: 7_571 })).toBe(7_571);
  });

  it("converts a pre-presence history straight across, because it counted whole weeks", () => {
    // The old rule credited every caretaker with the entire window, so nine
    // caretakers meant nine caretakers' worth of week — and replays as that.
    expect(presencePermilleOf({ population: 9 })).toBe(whole(9));
    expect(careMultiplierPermille(presencePermilleOf({ population: 9 }))).toBe(3090);
  });

  it("reads a history from before §23 as the baseline", () => {
    expect(presencePermilleOf({})).toBe(whole(DIFFICULTY_BASELINE));
  });
});

describe("recording thresholds", () => {
  it("records a move of a tenth or more, and ignores smaller ones", () => {
    expect(worthRecording(whole(2), whole(3))).toBe(true); // 1.00× → 1.355×
    expect(worthRecording(whole(2), whole(2))).toBe(false);
    expect(worthRecording(whole(13), whole(40))).toBe(false); // both capped at 4×
    expect(worthRecording(undefined, whole(2))).toBe(false); // baseline is already assumed
    expect(worthRecording(undefined, whole(5))).toBe(true);
  });

  it("ignores a fraction of a caretaker arriving, which is most measurements", () => {
    // Hourly measurement against a seventh-of-a-caretaker resolution would
    // otherwise write an event nearly every hour (SPEC §23.2).
    expect(worthRecording(whole(6), whole(6) + Math.round(PRESENCE_SCALE / 7))).toBe(false);
  });

  it("records a shrinking community too, so difficulty comes back down", () => {
    expect(worthRecording(whole(8), whole(3))).toBe(true);
    expect(worthRecording(whole(6), whole(2))).toBe(true);
  });
});

describe("decay scaling", () => {
  it("leaves the table untouched at the baseline", () => {
    expect(decayRates("PUP", null, "WAKE", 1000)).toEqual(decayRates("PUP", null, "WAKE"));
  });

  it("scales every need a crowd can actually supply, in proportion", () => {
    const base = decayRates("PUP", null, "WAKE");
    const doubled = decayRates("PUP", null, "WAKE", 2000);
    for (const need of MULTIPLIED_NEEDS) expect(doubled[need]).toBe(Math.round(base[need] * 2));
  });

  it("leaves energy alone, because nobody can make a pet sleep harder", () => {
    // SPEC §2.7: LULLABY is the only care action that touches energy, it is
    // gated below 25%, and it puts the pet to sleep rather than waking it —
    // so a room of fifty supplies no more rest than a room of two.
    const base = decayRates("PUP", null, "WAKE");
    for (const permille of [1355, 2280, 2828, 4000]) {
      expect(decayRates("PUP", null, "WAKE", permille).energy).toBe(base.energy);
    }
    expect(MULTIPLIED_NEEDS).not.toContain("energy");
    expect([...MULTIPLIED_NEEDS].sort()).toEqual(NEED_KEYS.filter((need) => need !== "energy").sort());
  });

  /**
   * The invariant the exemption exists to protect, stated as arithmetic
   * rather than as a scenario: a waking day must never cost more energy than
   * the pet can hold, or it has to nap whatever the night was worth — and a
   * sleeping pet refuses FEED, PLAY and CLEAN (§2.5), so a forced nap spends
   * the very care windows the crowd multiplier was raised to fill.
   */
  it("never lets a waking day cost more energy than a pet can hold", () => {
    const awakeTicks = (SLEEP_HOUR - WAKE_HOUR) * TICKS_PER_HOUR;
    const nightTicks = TICKS_PER_DAY - awakeTicks;
    for (const permille of [1000, 1682, 2559, 2828, 3344, 4000]) {
      const spent = decayRates("PUP", null, "WAKE", permille).energy * awakeTicks;
      expect(spent).toBeLessThanOrEqual(NEED_MAX);
      // And a night must repay a whole day of it, at every community size.
      const repaid = ENERGY_SLEEP_RECOVERY * nightTicks - decayRates("PUP", null, "SLEEP", permille).energy * nightTicks;
      expect(repaid).toBeGreaterThan(spent);
    }
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
