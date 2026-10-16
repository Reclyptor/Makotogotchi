// "Old age is held off by care" (SPEC §16.2), under the rising hold line.
//
// The caretaker strategy is pinned to a defined bot so the property is
// decidable. The difficulty dial's greedy bot cannot serve here: it plays
// whenever joy is its lowest need, and each PLAY costs the pet more energy
// than it gives back, so it spends the evening's energy on joy and loses
// elders around day 26 under the 85% line. The net-gain bot is what a keen
// player who has learned that does: it takes the action that restores the most
// once the pet's own cost is paid, and so pets for joy unless playing pays.

import { describe, expect, it } from "vitest";
import type { PetEvent } from "./events";
import type { PetState } from "./model";
import { careMultiplierOf } from "./difficulty";
import { project } from "./project";
import { reduce } from "./reduce";
import { budgetRemaining, findCaretaker } from "./score";
import { hatchedState, projectImmortal, TEST_GENERATION, testCtx } from "./testkit";
import { canPerform } from "./validate";
import {
  COOLDOWNS,
  CURRENT_RULES_VERSION,
  diminishedMagnitude,
  ELDER_STARTS_AT,
  HEALTH_MAX,
  MAGNITUDE_ACTIONS,
  NEED_MAX,
  PLAY_ENERGY_COST,
  TICKS_PER_DAY,
  type CareAction,
} from "./tuning";

const ctx = testCtx();

/** A restoration this small is not worth a caretaker's cooldown. */
const MIN_NET_GAIN = 250;

const NET_GAIN_ACTIONS = ["FEED", "CLEAN", "PLAY", "PET", "LULLABY"] as const satisfies readonly CareAction[];

const cooledDownAt = (state: PetState, action: CareAction): number =>
  (state.lastActionTick[action] ?? -Infinity) + COOLDOWNS[action].global;

/** The caretaker with the most allowance left for the action, if anyone may do it now. */
const bestCaretaker = (state: PetState, ids: readonly string[], action: CareAction, permille: number) => {
  const magnitude = MAGNITUDE_ACTIONS[action]!;
  let best: { id: string; remaining: number } | null = null;
  for (const id of ids) {
    if (!canPerform(state, action, id, ctx).ok) continue;
    const record = findCaretaker(state, id);
    const remaining = record === null ? Infinity : budgetRemaining(record, magnitude.need, state.tick, permille);
    if (remaining > 0 && (best === null || remaining > best.remaining)) best = { id, remaining };
  }
  return best;
};

/** The net-gain bot's next move: what the action restores less what it costs the pet. */
const netGainChoice = (state: PetState, ids: readonly string[]): { action: CareAction; caretakerId: string } | null => {
  const permille = careMultiplierOf(state);
  let best: { action: CareAction; caretakerId: string; gain: number } | null = null;
  for (const action of NET_GAIN_ACTIONS) {
    const magnitude = MAGNITUDE_ACTIONS[action]!;
    const cost = action === "PLAY" ? PLAY_ENERGY_COST : 0;
    const curved = diminishedMagnitude(magnitude.base, state.needs[magnitude.need]);
    // Most looks find nothing worth doing; ruling that out first keeps the
    // caretaker search for the looks that matter.
    if (curved - cost < MIN_NET_GAIN || cooledDownAt(state, action) > state.tick) continue;
    const caretaker = bestCaretaker(state, ids, action, permille);
    if (caretaker === null) continue;
    const gain = Math.min(curved, caretaker.remaining) - cost;
    if (gain >= MIN_NET_GAIN && (best === null || gain > best.gain)) {
      best = { action, caretakerId: caretaker.id, gain };
    }
  }
  return best;
};

/** An elder on its first day, full of everything, with the ramp starting now. */
const startOfRamp = (level: number, caretakers: number, rules = 1): PetState => {
  const atElder = projectImmortal(hatchedState(ctx), ELDER_STARTS_AT, ctx);
  return {
    ...atElder,
    needs: { hunger: level, energy: level, hygiene: level, joy: level },
    healthRaw: HEALTH_MAX,
    asleep: false,
    sleepReason: null,
    sick: false,
    sickSinceTick: null,
    population: caretakers,
    populationPermille: caretakers * 1000,
    elderRampFromTick: atElder.tick,
    ...(rules > 1 ? { rulesVersion: rules } : {}),
  };
};

/** Longest stretch sickness may run before it is cured: a minute, which costs
 *  a thousandth of the health a whole onset would. */
const CURE_SLICE = 6;

/**
 * Project to `tick` with sickness off. The onset draw cannot be disabled (it is
 * the one randomness in the game), so each onset is cured within a slice, the
 * way a caretaker with MEDICATE to hand would.
 */
const projectWell = (input: PetState, tick: number): PetState => {
  let state = input;
  while (state.tick < tick && state.diedAtTick === null) {
    state = { ...project(state, Math.min(state.tick + CURE_SLICE, tick), ctx).state, sick: false, sickSinceTick: null };
  }
  return state;
};

type Outcome = {
  /** Elder days survived, or null if it lived out the run. */
  diedAfterDays: number | null;
  lowestHealth: number;
  cause: PetState["causeOfDeath"];
};

const outcomeOf = (state: PetState, start: number, lowestHealth: number): Outcome => ({
  diedAfterDays: state.diedAtTick === null ? null : (state.diedAtTick - start) / TICKS_PER_DAY,
  lowestHealth,
  cause: state.causeOfDeath,
});

/**
 * Ten (or however many) people caring for a fresh elder, each look at the pet
 * taking up to `perLook` of the bot's moves. Sickness is off (see `projectWell`).
 */
const careForElder = (opts: { caretakers: number; days: number; every: number; perLook: number; rules?: number }): Outcome => {
  let state = startOfRamp(NEED_MAX, opts.caretakers, opts.rules);
  const ids = Array.from({ length: opts.caretakers }, (_, index) => `carer-${String(index).padStart(2, "0")}`);
  const start = state.tick;
  const end = start + opts.days * TICKS_PER_DAY;
  let seq = 1;
  let lowestHealth = HEALTH_MAX;

  for (let tick = start + opts.every; tick <= end && state.diedAtTick === null; tick += opts.every) {
    state = projectWell(state, tick);
    lowestHealth = Math.min(lowestHealth, state.healthRaw);
    // Nobody tends a sleeping pet.
    if (state.diedAtTick !== null || state.asleep) continue;
    for (let move = 0; move < opts.perLook; move++) {
      const choice = netGainChoice(state, ids);
      if (choice === null) break;
      const event: PetEvent = {
        type: "CARE",
        generationId: TEST_GENERATION.id,
        seq: seq++,
        tick: state.tick,
        action: choice.action,
        caretakerId: choice.caretakerId,
      };
      state = reduce(state, event, ctx).state;
    }
  }
  return outcomeOf(state, start, lowestHealth);
};

/**
 * A group that holds the mean exactly: the needs are pinned back to `level`
 * after every half-minute step, the way project.test.ts holds the flat line.
 */
const heldAt = (level: number, days: number): Outcome => {
  let state = startOfRamp(level, 10);
  const start = state.tick;
  const end = start + days * TICKS_PER_DAY;
  let lowestHealth = HEALTH_MAX;
  while (state.tick < end && state.diedAtTick === null) {
    state = projectWell(state, Math.min(state.tick + 30, end));
    lowestHealth = Math.min(lowestHealth, state.healthRaw);
    state = { ...state, needs: { hunger: level, energy: level, hygiene: level, joy: level } };
  }
  return outcomeOf(state, start, lowestHealth);
};

describe("old age is held off by care (SPEC §16.2)", () => {
  // A minute-by-minute look is what it takes to hold the evening: the bot
  // refeeds on every cooldown, which is thirty thousand actions in a month.
  it("a net-gain bot at ten caretakers keeps the elder alive, at half health or better, for thirty days", { timeout: 60_000 }, () => {
    const run = careForElder({ caretakers: 10, days: 30, every: 6, perLook: NET_GAIN_ACTIONS.length });
    expect(run.diedAfterDays).toBeNull();
    expect(run.lowestHealth).toBeGreaterThanOrEqual(HEALTH_MAX / 2);
  });

  it("ten people looking in every half hour for a few moves each lose the elder to old age within three weeks, under the rules before ruleset 3", { timeout: 20_000 }, () => {
    const run = careForElder({ caretakers: 10, days: 21, every: 180, perLook: 4 });
    expect(run.cause).toBe("age");
    expect(run.diedAfterDays).not.toBeNull();
    expect(run.diedAfterDays!).toBeGreaterThanOrEqual(8);
    expect(run.diedAfterDays!).toBeLessThanOrEqual(18);
  });

  it("ten people looking in every half hour keep the elder alive for thirty days under ruleset 3", { timeout: 20_000 }, () => {
    // Good care, not perfect play (SPEC §2.3): the 75% line is within reach of
    // a look every half hour, which the 85% line was not.
    const run = careForElder({ caretakers: 10, days: 30, every: 180, perLook: 4, rules: CURRENT_RULES_VERSION });
    expect(run.diedAfterDays).toBeNull();
    expect(run.lowestHealth).toBeGreaterThanOrEqual(HEALTH_MAX / 2);
  });

  it("an elder held at a 90% mean keeps above 90% health across thirty days", () => {
    const run = heldAt(900_000, 30);
    expect(run.diedAfterDays).toBeNull();
    expect(run.lowestHealth).toBeGreaterThanOrEqual(HEALTH_MAX * 0.9);
  });

  it("an elder held at a 70% mean, comfortably past the old line, dies of age within 14–18 days", () => {
    const run = heldAt(700_000, 30);
    expect(run.cause).toBe("age");
    expect(run.diedAfterDays!).toBeGreaterThanOrEqual(14);
    expect(run.diedAfterDays!).toBeLessThanOrEqual(18);
  });

  it("an elder held at the old 60% line, nothing ever critical, dies of age within 10–14 days", () => {
    const run = heldAt(600_000, 30);
    expect(run.cause).toBe("age");
    expect(run.diedAfterDays!).toBeGreaterThanOrEqual(10);
    expect(run.diedAfterDays!).toBeLessThanOrEqual(14);
  });
});
