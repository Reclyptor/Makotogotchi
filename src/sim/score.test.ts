// What a caretaker can still do, and why an allowed action would do nothing
// (SPEC §2.5, §2.6, §11.2). Both are read-only views of the budget the
// reducer writes, and both exist because the UI had no way to tell a spent
// allowance from a full pet and said the wrong thing about one of them.

import { describe, expect, it } from "vitest";
import { project } from "./project";
import { allowanceRemaining, budgetRemaining, caretakerRecord, findCaretaker, zeroApplyReason } from "./score";
import { hatchedState, testCtx } from "./testkit";
import { NEED_KEYS, NEED_MAX, WEEKLY_BUDGET } from "./tuning";

const ctx = testCtx();
const at = (tick: number) => project(hatchedState(ctx), tick, ctx).state;

/** A state where `who` has spent their whole weekly allowance for `need`. */
const spend = (tick: number, who: string, need: (typeof NEED_KEYS)[number], fraction = 1) => {
  const state = at(tick);
  const record = caretakerRecord(state, who);
  record.budget[need] = [{ day: 0, applied: Math.round(WEEKLY_BUDGET[need] * fraction) }];
  return state;
};

describe("findCaretaker", () => {
  it("finds a record without conjuring one for a stranger", () => {
    const state = spend(1000, "emilio", "hunger");
    expect(findCaretaker(state, "emilio")?.id).toBe("emilio");
    const before = state.caretakers.length;
    expect(findCaretaker(state, "nobody")).toBeNull();
    // The read-only lookup must not leave a record behind, or merely asking
    // what someone has left would enrol them in the fold.
    expect(state.caretakers).toHaveLength(before);
  });
});

describe("allowanceRemaining (SPEC §2.5)", () => {
  it("reads 100% across the board for a caretaker who has done nothing", () => {
    expect(allowanceRemaining(at(1000), "newcomer", 1000)).toEqual({ hunger: 100, energy: 100, hygiene: 100, joy: 100 });
  });

  it("falls with what has been spent, need by need", () => {
    const state = spend(1000, "emilio", "hunger", 0.75);
    const left = allowanceRemaining(state, "emilio", 1000);
    expect(left.hunger).toBe(25);
    // Spending one need leaves the others untouched — the budget is per need.
    expect(left.joy).toBe(100);
    expect(left.hygiene).toBe(100);
    expect(left.energy).toBe(100);
  });

  it("bottoms out at zero and never goes negative", () => {
    const state = spend(1000, "emilio", "joy", 2);
    expect(allowanceRemaining(state, "emilio", 1000).joy).toBe(0);
  });

  it("agrees with budgetRemaining, which is the one source", () => {
    const state = spend(1000, "emilio", "hygiene", 0.4);
    const record = findCaretaker(state, "emilio")!;
    for (const need of NEED_KEYS) {
      const expected = Math.round((budgetRemaining(record, need, 1000) * 100) / WEEKLY_BUDGET[need]);
      expect(allowanceRemaining(state, "emilio", 1000)[need]).toBe(expected);
    }
  });
});

describe("zeroApplyReason (SPEC §2.6)", () => {
  it("says nothing at all when the action would restore something", () => {
    const hungry = at(1000);
    hungry.needs.hunger = NEED_MAX / 2;
    expect(zeroApplyReason(hungry, "FEED", "emilio", 1000)).toBeNull();
  });

  it("blames the allowance when the allowance is what ran out", () => {
    const state = spend(1000, "emilio", "hunger");
    state.needs.hunger = 0; // starving, and still nothing this caretaker can do
    expect(zeroApplyReason(state, "FEED", "emilio", 1000)).toBe("SPENT");
    // The same pet, a different caretaker: their allowance is untouched.
    expect(zeroApplyReason(state, "FEED", "someone-else", 1000)).toBeNull();
  });

  it("blames the pet being full when the pet is full", () => {
    const state = at(1000);
    state.needs.hunger = NEED_MAX;
    expect(zeroApplyReason(state, "FEED", "emilio", 1000)).toBe("SATED");
  });

  it("puts the allowance first when both are true, because only one is fixable", () => {
    // A full pet empties on its own; a spent allowance is the caretaker's own
    // ceiling, and telling them the pet is simply full would hide it.
    const state = spend(1000, "emilio", "hunger");
    state.needs.hunger = NEED_MAX;
    expect(zeroApplyReason(state, "FEED", "emilio", 1000)).toBe("SPENT");
  });

  it("covers every magnitude-shaped action and excuses the flat one", () => {
    const full = at(1000);
    for (const need of NEED_KEYS) full.needs[need] = NEED_MAX;
    expect(zeroApplyReason(full, "FEED", "emilio", 1000)).toBe("SATED");
    expect(zeroApplyReason(full, "PLAY", "emilio", 1000)).toBe("SATED");
    expect(zeroApplyReason(full, "CLEAN", "emilio", 1000)).toBe("SATED");
    expect(zeroApplyReason(full, "LULLABY", "emilio", 1000)).toBe("SATED");
    expect(zeroApplyReason(full, "PET", "emilio", 1000)).toBe("SATED");
    // MEDICATE is flat: neither curved nor budgeted, so it is never a no-op
    // for either of these reasons.
    expect(zeroApplyReason(full, "MEDICATE", "emilio", 1000)).toBeNull();
  });

  it("agrees with what the reducer actually applies", () => {
    for (const fraction of [0, 0.5, 1]) {
      for (const hunger of [0, NEED_MAX / 2, NEED_MAX]) {
        const state = spend(1000, "emilio", "hunger", fraction);
        state.needs.hunger = hunger;
        const record = findCaretaker(state, "emilio")!;
        const wouldApply = Math.min(
          Math.floor((250_000 * (NEED_MAX - hunger) + NEED_MAX / 2) / NEED_MAX),
          budgetRemaining(record, "hunger", 1000),
        );
        expect(zeroApplyReason(state, "FEED", "emilio", 1000) === null).toBe(wouldApply > 0);
      }
    }
  });
});
