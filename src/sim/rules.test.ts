// The ruleset version (SPEC §23.2): the one event that gates every rule which
// changes how a pet lives or dies, so that a log from before a change keeps
// folding as it always did.

import { describe, expect, it } from "vitest";
import { petEventSchema, type RulesEvent } from "./events";
import { rulesVersionOf, type PetState } from "./model";
import { project } from "./project";
import { reduce } from "./reduce";
import { hatchedState, TEST_GENERATION, testCtx } from "./testkit";
import { CURRENT_RULES_VERSION, TICKS_PER_DAY } from "./tuning";

const ctx = testCtx();

const rulesAt = (tick: number, version: number, seq = 800): RulesEvent => ({
  type: "RULES",
  generationId: TEST_GENERATION.id,
  seq,
  tick,
  version,
});

describe("the RULES event", () => {
  it("reads as version 1 in a history with no event, and leaves the field out entirely", () => {
    const state = hatchedState(ctx);
    expect(rulesVersionOf(state)).toBe(1);
    expect("rulesVersion" in project(state, state.tick + TICKS_PER_DAY, ctx).state).toBe(false);
  });

  it("records its version after projecting to its tick under the old rules", () => {
    const state = hatchedState(ctx);
    const tick = state.tick + 500;
    const folded = reduce(state, rulesAt(tick, 2), ctx).state;
    expect(folded.rulesVersion).toBe(2);
    expect(folded.tick).toBe(tick);
    expect(folded.healthRaw).toBe(project(state, tick, ctx).state.healthRaw);
  });

  it("keeps the highest version it has seen", () => {
    const state = hatchedState(ctx);
    const high = reduce(state, rulesAt(state.tick + 10, 3), ctx).state;
    expect(reduce(high, rulesAt(high.tick + 10, 2, 801), ctx).state.rulesVersion).toBe(3);
    expect(reduce(high, rulesAt(high.tick + 10, 3, 801), ctx).state.rulesVersion).toBe(3);
  });

  it("does not add the field for a version that changes nothing", () => {
    const state = hatchedState(ctx);
    expect("rulesVersion" in reduce(state, rulesAt(state.tick + 10, 1), ctx).state).toBe(false);
  });

  it("survives the hot-state JSON round trip", () => {
    const state = hatchedState(ctx);
    const { state: folded } = reduce(state, rulesAt(state.tick + 10, CURRENT_RULES_VERSION), ctx);
    expect(JSON.parse(JSON.stringify(folded)) as PetState).toEqual(folded);
  });

  it("validates at the wire: a positive whole version and nothing else", () => {
    const event = rulesAt(10, 2);
    expect(petEventSchema.safeParse(event).success).toBe(true);
    expect(petEventSchema.safeParse({ ...event, version: 0 }).success).toBe(false);
    expect(petEventSchema.safeParse({ ...event, version: 1.5 }).success).toBe(false);
    expect(petEventSchema.safeParse({ ...event, version: undefined }).success).toBe(false);
  });
});
