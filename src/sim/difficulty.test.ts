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
