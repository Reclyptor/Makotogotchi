// The invariants that protect the design (SPEC §16.2). These are the reason
// the tuning constants can be changed safely.

import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { project } from "./project";
import { reduce, diminishedMagnitude } from "./reduce";
import { genesis } from "./genesis";
import { EventLog, TEST_GENERATION, testCtx } from "./testkit";
import { ACTION_MAGNITUDE, CARE_ACTIONS, NEED_KEYS, NEED_MAX, TICKS_PER_DAY } from "./tuning";
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
