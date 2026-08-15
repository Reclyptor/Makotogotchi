// Shared fixtures for the sim tests. Everything here is deterministic: fixed
// seeds, a schedule aligned so tick 0 is 07:00 (WAKE_HOUR) on day 0, and a
// seq-assigning event factory.

import type { Generation, PetState, PhaseSchedule, ProjectionContext } from "./model";
import { genesis } from "./genesis";
import { project } from "./project";
import { reduce } from "./reduce";
import type { CareEvent, HatchedEvent, PetEvent } from "./events";
import { HEALTH_MAX, SLEEP_HOUR, TICKS_PER_DAY, TICKS_PER_HOUR, WAKE_HOUR, type CareAction } from "./tuning";

export const TEST_GENERATION: Generation = {
  id: "gen-test",
  ordinal: 1,
  seed: 0xc0ffee,
  genesisEpochMs: 1_755_000_000_000,
  name: null,
};

/**
 * The committed seed's sickness stream is part of several tests' fixtures.
 * Notable seeds (first sickness onset for an untended pet from hatch):
 * 0xc0ffee — early onset (~2h into day 2); 1337 — no onset for 9+ days.
 */
export const QUIET_SEED = 1337;

export const withSeed = (seed: number): Generation => ({ ...TEST_GENERATION, seed });

/**
 * Schedule with tick 0 at WAKE_HOUR: awake [0, 5400), asleep [5400, 8640),
 * repeating for `days` days.
 */
export const testSchedule = (days: number): PhaseSchedule => {
  const boundaries: { tick: number; phase: "WAKE" | "SLEEP" }[] = [];
  const awakeTicks = (SLEEP_HOUR - WAKE_HOUR) * TICKS_PER_HOUR;
  for (let day = 0; day < days; day++) {
    boundaries.push({ tick: day * TICKS_PER_DAY + awakeTicks, phase: "SLEEP" });
    boundaries.push({ tick: (day + 1) * TICKS_PER_DAY, phase: "WAKE" });
  }
  return { initialPhase: "WAKE", boundaries };
};

export const testCtx = (days = 40): ProjectionContext => ({ schedule: testSchedule(days) });

export class EventLog {
  private seq = 0;
  readonly events: PetEvent[] = [];

  hatched(tick: number, name = "Makoto"): HatchedEvent {
    const event: HatchedEvent = { type: "HATCHED", generationId: TEST_GENERATION.id, seq: this.seq++, tick, name };
    this.events.push(event);
    return event;
  }

  care(tick: number, action: CareAction, caretakerId = "caretaker-a"): CareEvent {
    const event: CareEvent = { type: "CARE", generationId: TEST_GENERATION.id, seq: this.seq++, tick, action, caretakerId };
    this.events.push(event);
    return event;
  }
}

/** Fold a log through reduce in seq order — the canonical replay. */
export const replay = (events: readonly PetEvent[], ctx: ProjectionContext, generation: Generation = TEST_GENERATION): PetState => {
  let state = genesis(generation);
  for (const event of events) {
    state = reduce(state, event, ctx).state;
  }
  return state;
};

/** A state hatched at tick 0 — the usual starting point. */
export const hatchedState = (ctx: ProjectionContext, generation: Generation = TEST_GENERATION): PetState => {
  const log = new EventLog();
  log.hatched(0);
  return replay(log.events, ctx, generation);
};

/**
 * Projection that cannot die: advances in chunks short enough that health
 * cannot reach zero within one (worst-case drain is 10^9/tick against a
 * 10^12 pool), resetting health to full between chunks. For tests that need
 * to reach a late life stage without care. Deterministic.
 */
export const projectImmortal = (input: PetState, toTick: number, ctx: ProjectionContext): PetState => {
  const CHUNK = 500;
  let state = input;
  while (state.tick < toTick) {
    const next = Math.min(state.tick + CHUNK, toTick);
    state = { ...project(state, next, ctx).state, healthRaw: HEALTH_MAX };
  }
  return state;
};
