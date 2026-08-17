// The difficulty dial and the community-size goals, as executable assertions
// (SPEC §16.2). If tuning constants change and these still pass, the design
// intent survived the retune. The caretaker strategy is pinned to a defined
// greedy-optimal bot so the properties are decidable.

import { describe, expect, it } from "vitest";
import { project } from "./project";
import { reduce } from "./reduce";
import { canPerform } from "./validate";
import { EventLog, hatchedState, projectImmortal, QUIET_SEED, testCtx, withSeed } from "./testkit";
import type { Generation, PetState, ProjectionContext } from "./model";
import {
  CRITICAL_THRESHOLD,
  HEALTH_MAX,
  NEED_KEYS,
  NEED_MAX,
  TICKS_PER_DAY,
  TICKS_PER_HOUR,
  type CareAction,
} from "./tuning";

const ctx = testCtx();

/** A PUP at 07:00 with everything full — the difficulty dial's start state. */
const fullPup = (generation?: Generation): PetState => ({
  ...projectImmortal(hatchedState(ctx, generation), TICKS_PER_DAY, ctx),
  needs: { hunger: NEED_MAX, energy: NEED_MAX, hygiene: NEED_MAX, joy: NEED_MAX },
  healthRaw: HEALTH_MAX,
  asleep: false,
  sleepReason: null,
  sick: false,
  sickSinceTick: null,
});

/**
 * The greedy-optimal bot: acts the moment cooldowns permit, choosing the
 * action with the greatest marginal health benefit — MEDICATE when sick,
 * otherwise whichever valid action targets the currently lowest need.
 */
const botChoose = (state: PetState, caretakerId: string, context: ProjectionContext): CareAction | null => {
  if (state.sick && canPerform(state, "MEDICATE", caretakerId, context).ok) return "MEDICATE";
  const candidates: { action: CareAction; need: number }[] = [
    { action: "FEED", need: state.needs.hunger },
    { action: "CLEAN", need: state.needs.hygiene },
    { action: "PLAY", need: state.needs.joy },
    { action: "LULLABY", need: state.needs.energy },
    { action: "PET", need: state.needs.joy + 1 }, // fallback, always last
  ];
  candidates.sort((a, b) => a.need - b.need);
  for (const candidate of candidates) {
    if (canPerform(state, candidate.action, caretakerId, context).ok) return candidate.action;
  }
  return null;
};

describe("community difficulty (SPEC §23)", () => {
  /** The same abandoned pet, but with a crowd's worth of recorded caretakers. */
  const abandonedWith = (population: number | undefined) => {
    const start = { ...fullPup(withSeed(QUIET_SEED)), ...(population === undefined ? {} : { population }) };
    const { state: dead } = project(start, start.tick + 8 * TICKS_PER_DAY, ctx);
    return { start, dead };
  };

  it("brings the first critical need forward sharply as the crowd grows", () => {
    // The number people actually feel: how long a full pet stays comfortable.
    const criticalHours = (population: number): number => {
      const start = { ...fullPup(withSeed(QUIET_SEED)), population };
      const { milestones } = project(start, start.tick + 8 * TICKS_PER_DAY, ctx);
      const critical = milestones.find((m) => m.kind === "CRITICAL");
      expect(critical).toBeDefined();
      return (critical!.tick - start.tick) / TICKS_PER_HOUR;
    };
    expect(criticalHours(2)).toBeGreaterThanOrEqual(28);
    expect(criticalHours(4)).toBeLessThanOrEqual(17);
    expect(criticalHours(9)).toBeLessThanOrEqual(10);
    // Monotone: a bigger community is never gentler.
    const ramp = [2, 3, 4, 5, 6, 7, 8, 9].map(criticalHours);
    for (let i = 1; i < ramp.length; i++) expect(ramp[i]!).toBeLessThanOrEqual(ramp[i - 1]!);
  });

  it("kills a crowded pet far sooner than a quiet one", () => {
    const quiet = abandonedWith(2);
    const crowded = abandonedWith(8);
    expect(quiet.dead.diedAtTick).not.toBeNull();
    expect(crowded.dead.diedAtTick).not.toBeNull();

    const hours = (run: ReturnType<typeof abandonedWith>): number =>
      (run.dead.diedAtTick! - run.start.tick) / TICKS_PER_HOUR;
    // §23.1's table: ~46h at the baseline against ~20h at 2.83×. Death
    // compresses less than decay because the health drain is deficit-driven.
    expect(hours(quiet)).toBeGreaterThan(hours(crowded) * 2);
    expect(hours(crowded)).toBeGreaterThanOrEqual(17);
    expect(hours(crowded)).toBeLessThanOrEqual(23);
  });

  it("leaves histories with no recorded population exactly as they were", () => {
    // The guarantee that lets §23 ship over a live generation: an old log,
    // which carries no POPULATION event, must project byte-identically.
    const legacy = abandonedWith(undefined);
    const baseline = abandonedWith(2);
    expect(legacy.dead).toEqual({ ...baseline.dead, population: undefined });
    expect(legacy.dead.diedAtTick).toBe(baseline.dead.diedAtTick);
  });

  it("never makes a small community easier than the baseline", () => {
    const baselineHours = (() => {
      const run = abandonedWith(2);
      return run.dead.diedAtTick! - run.start.tick;
    })();
    for (const population of [0, 1]) {
      const run = abandonedWith(population);
      expect(run.dead.diedAtTick! - run.start.tick).toBe(baselineHours);
    }
  });

  it("folds a POPULATION event and speeds decay from that moment on", () => {
    const log = new EventLog();
    log.hatched(0);
    const hatched = reduce(hatchedState(ctx), log.events[0]!, ctx).state;

    // A day in, the community is measured at eight.
    const eventTick = hatched.tick + TICKS_PER_DAY;
    const populated = reduce(
      hatched,
      { type: "POPULATION", generationId: hatched.generation.id, seq: 1, tick: eventTick, count: 8 },
      ctx,
    ).state;
    expect(populated.population).toBe(8);

    // An hour of decay after the event outruns an hour before it.
    const before = project(hatched, hatched.tick + TICKS_PER_HOUR, ctx).state;
    const after = project(populated, populated.tick + TICKS_PER_HOUR, ctx).state;
    const spent = (from: PetState, to: PetState): number =>
      NEED_KEYS.reduce((total, need) => total + (from.needs[need] - to.needs[need]), 0);
    expect(spent(populated, after)).toBeGreaterThan(spent(hatched, before) * 2);
  });

  it("replays a log containing a POPULATION event identically every time", () => {
    const build = (): PetState => {
      const log = new EventLog();
      log.hatched(0);
      log.care(TICKS_PER_HOUR, "FEED");
      let state = hatchedState(ctx);
      for (const event of log.events) state = reduce(state, event, ctx).state;
      state = reduce(
        state,
        { type: "POPULATION", generationId: state.generation.id, seq: 99, tick: 2 * TICKS_PER_HOUR, count: 6 },
        ctx,
      ).state;
      return project(state, state.tick + TICKS_PER_DAY, ctx).state;
    };
    expect(build()).toEqual(build());
  });
});

describe("the difficulty dial (SPEC §16.2)", () => {
  it("pure neglect: a full pet untouched from 07:00 goes hunger-critical in 28–32h and starves in 42–52h", () => {
    // QUIET_SEED draws no sickness inside the horizon, isolating the
    // deficit-drain clock.
    const start = fullPup(withSeed(QUIET_SEED));
    const { state: dead, milestones } = project(start, start.tick + 8 * TICKS_PER_DAY, ctx);

    const critical = milestones.find((m) => m.kind === "CRITICAL" && m.detail === "hunger");
    expect(critical).toBeDefined();
    const criticalHours = (critical!.tick - start.tick) / TICKS_PER_HOUR;
    expect(criticalHours).toBeGreaterThanOrEqual(28);
    expect(criticalHours).toBeLessThanOrEqual(32);

    expect(dead.diedAtTick).not.toBeNull();
    expect(dead.causeOfDeath).toBe("hunger");
    const deathHours = (dead.diedAtTick! - start.tick) / TICKS_PER_HOUR;
    expect(deathHours).toBeGreaterThanOrEqual(42);
    expect(deathHours).toBeLessThanOrEqual(52);
  });

  it("abandonment with illness: untreated sickness accelerates death into the 36–44h band", () => {
    // Seed 42 onsets sickness mid-abandonment — the realistic arc: neglect →
    // filth → disease. Death comes sooner than the pure-neglect clock but
    // never absurdly fast: there is always at least a full night and day to
    // answer the push alert.
    const start = fullPup(withSeed(42));
    const { state: dead, milestones } = project(start, start.tick + 8 * TICKS_PER_DAY, ctx);

    expect(milestones.some((m) => m.kind === "BECAME_SICK")).toBe(true);
    expect(dead.diedAtTick).not.toBeNull();
    expect(dead.causeOfDeath).toBe("sickness");
    const deathHours = (dead.diedAtTick! - start.tick) / TICKS_PER_HOUR;
    expect(deathHours).toBeGreaterThanOrEqual(36);
    expect(deathHours).toBeLessThanOrEqual(44);
  });

  it("a lone caretaker can rescue a collapsed pet within 30 minutes", () => {
    // Every need deep below critical, health half gone: the 3am nightmare.
    const base = projectImmortal(hatchedState(ctx), TICKS_PER_DAY, ctx);
    let state: PetState = {
      ...base,
      needs: { hunger: 50_000, energy: 50_000, hygiene: 50_000, joy: 50_000 },
      healthRaw: HEALTH_MAX / 2,
      asleep: false,
      sleepReason: null,
      sick: false,
      sickSinceTick: null,
    };
    const log = new EventLog();
    const deadline = state.tick + 180; // 30 minutes
    const rescued = () => NEED_KEYS.every((need) => state.needs[need] >= CRITICAL_THRESHOLD);

    while (state.tick < deadline && !rescued()) {
      const action = botChoose(state, "rescuer", ctx);
      if (action) {
        state = reduce(state, log.care(state.tick, action, "rescuer"), ctx).state;
      } else {
        state = project(state, state.tick + 1, ctx).state;
      }
    }

    expect(rescued()).toBe(true);
    expect(state.diedAtTick).toBeNull();
  });

  it("a lone caretaker cannot sustain the pet: mean needs fall below 50% inside days 2–8", () => {
    let state = hatchedState(ctx);
    const log = new EventLog();
    const horizon = 9 * TICKS_PER_DAY;
    const samples: number[] = [];

    while (state.tick < horizon && state.diedAtTick === null) {
      const action = botChoose(state, "devoted", ctx);
      if (action) {
        state = reduce(state, log.care(state.tick, action, "devoted"), ctx).state;
      }
      const next = Math.min(state.tick + 6, horizon); // stride 1 min between decisions
      state = project(state, next, ctx).state;
      if (state.tick >= 2 * TICKS_PER_DAY && state.tick <= 8 * TICKS_PER_DAY && state.tick % 60 === 0) {
        samples.push(state.needs.hunger + state.needs.energy + state.needs.hygiene + state.needs.joy);
      }
    }

    // Either the pet died despite devoted solo care, or its mean condition
    // across the window fell below half — both prove one person is not enough.
    if (state.diedAtTick === null) {
      const mean = samples.reduce((a, b) => a + b, 0) / samples.length / NEED_KEYS.length;
      expect(mean).toBeLessThan(NEED_MAX / 2);
    }
  });
});
