// The invariants that protect the design (SPEC §16.2). These are the reason
// the tuning constants can be changed safely.

import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { project } from "./project";
import { reduce } from "./reduce";
import { genesis } from "./genesis";
import { EventLog, TEST_GENERATION, testCtx } from "./testkit";
import {
  ACTION_MAGNITUDE,
  BUDGET_WINDOW_DAYS,
  CARE_ACTIONS,
  CARETAKER_WEEKLY_BUDGET_DAYS,
  DAILY_DECAY,
  diminishedMagnitude,
  NEED_KEYS,
  NEED_MAX,
  TICKS_PER_DAY,
  weeklyBudget,
  WEEKLY_BUDGET,
} from "./tuning";
import type { PetEvent } from "./events";

const ctx = testCtx();

/** Arbitrary event logs: hatch at a random tick, then random care actions. */
const arbitraryLog = fc
  .record({
    hatchTick: fc.integer({ min: 0, max: 500 }),
    cares: fc.array(
      fc.record({
        gap: fc.integer({ min: 0, max: 400 }),
        action: fc.constantFrom(...CARE_ACTIONS),
        caretaker: fc.constantFrom("ana", "bo", "cyn", "dev"),
      }),
      { maxLength: 60 },
    ),
  })
  .map(({ hatchTick, cares }) => {
    const log = new EventLog();
    log.hatched(hatchTick);
    let tick = hatchTick;
    for (const care of cares) {
      tick += care.gap;
      log.care(tick, care.action, care.caretaker);
    }
    return { events: log.events, endTick: tick };
  });

const fold = (events: readonly PetEvent[]) => {
  let state = genesis(TEST_GENERATION);
  for (const event of events) state = reduce(state, event, ctx).state;
  return state;
};

describe("simulation invariants", () => {
  it("projection is path-independent: any stop-over produces the identical state", () => {
    fc.assert(
      fc.property(
        arbitraryLog,
        fc.integer({ min: 0, max: 3000 }),
        fc.integer({ min: 0, max: 3000 }),
        ({ events, endTick }, gapA, gapB) => {
          const state = fold(events);
          const a = endTick + gapA;
          const b = a + gapB;
          const direct = project(state, b, ctx).state;
          const stopover = project(project(state, a, ctx).state, b, ctx).state;
          expect(stopover).toEqual(direct);
        },
      ),
      { numRuns: 60 },
    );
  });

  it("replay is deterministic: two independent folds agree exactly", () => {
    fc.assert(
      fc.property(arbitraryLog, ({ events }) => {
        const a = fold(events);
        const b = fold(events);
        expect(JSON.stringify(a)).toBe(JSON.stringify(b));
      }),
      { numRuns: 40 },
    );
  });

  it("needs and health stay bounded under any event sequence", () => {
    fc.assert(
      fc.property(arbitraryLog, fc.integer({ min: 0, max: 5 * TICKS_PER_DAY }), ({ events, endTick }, extra) => {
        let state = genesis(TEST_GENERATION);
        const check = () => {
          for (const need of NEED_KEYS) {
            expect(state.needs[need]).toBeGreaterThanOrEqual(0);
            expect(state.needs[need]).toBeLessThanOrEqual(NEED_MAX);
          }
          expect(state.healthRaw).toBeGreaterThanOrEqual(0);
        };
        for (const event of events) {
          state = reduce(state, event, ctx).state;
          check();
        }
        state = project(state, endTick + extra, ctx).state;
        check();
      }),
      { numRuns: 40 },
    );
  });

  it("diminishing returns are monotone for every magnitude action", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...Object.values(ACTION_MAGNITUDE)),
        fc.integer({ min: 0, max: NEED_MAX - 1 }),
        fc.integer({ min: 1, max: 100_000 }),
        (base, value, delta) => {
          const higher = Math.min(value + delta, NEED_MAX);
          expect(diminishedMagnitude(base, higher)).toBeLessThanOrEqual(diminishedMagnitude(base, value));
        },
      ),
      { numRuns: 300 },
    );
  });

  it("applied magnitude never overshoots the maximum", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...Object.values(ACTION_MAGNITUDE)),
        fc.integer({ min: 0, max: NEED_MAX }),
        (base, value) => {
          expect(value + diminishedMagnitude(base, value)).toBeLessThanOrEqual(NEED_MAX);
        },
      ),
      { numRuns: 300 },
    );
  });
});

// The budget's one structural bound (SPEC §1.2, §2.5). Everything else about
// it is tuning; this is the premise.
describe("the caretaker budget cannot let one person carry the pet", () => {
  it("caps a week's allowance below a week of decay", () => {
    expect(CARETAKER_WEEKLY_BUDGET_DAYS).toBeLessThan(BUDGET_WINDOW_DAYS);
  });

  it("leaves a lone caretaker short however perfectly they spend it", () => {
    // A week of nominal decay against everything one person is allowed to
    // restore in that week, need by need. Short on every one of them, or the
    // game has no reason to be multiplayer.
    for (const need of NEED_KEYS) {
      expect(WEEKLY_BUDGET[need]).toBeLessThan(BUDGET_WINDOW_DAYS * DAILY_DECAY[need]);
    }
  });

  it("stays short by the same margin at every community size", () => {
    // The allowance scales with the multiplier because the demand it covers
    // does (SPEC §2.5). Without that, the caretakers a week needs ran from
    // 1.75 at the baseline to 7.00 at the cap — the design's central ratio
    // quietly tightening as a community grew, felt first by the regulars.
    for (const permille of [1000, 1682, 2828, 4000]) {
      for (const need of NEED_KEYS) {
        const weekOfDecay = BUDGET_WINDOW_DAYS * Math.round((DAILY_DECAY[need] * permille) / 1000);
        const allowance = weeklyBudget(need, permille);
        expect(allowance).toBeLessThan(weekOfDecay);
        // Same ratio as the baseline, to within integer rounding.
        expect(weekOfDecay / allowance).toBeCloseTo(BUDGET_WINDOW_DAYS / CARETAKER_WEEKLY_BUDGET_DAYS, 2);
      }
    }
  });

  it("still lets one person burst-rescue a starving pet", () => {
    // The other half of §2.5: the budget must not be so tight that a single
    // caretaker cannot answer an emergency. One day's decay is the rescue.
    for (const need of NEED_KEYS) {
      expect(WEEKLY_BUDGET[need]).toBeGreaterThan(DAILY_DECAY[need]);
    }
  });
});
