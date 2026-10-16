// The elder's rising hold line (SPEC §2.3): the rule's arithmetic, where its
// clock starts, and that a history from before the ramp folds as it always did.

import { describe, expect, it } from "vitest";
import { elderRampDayAt, type PetState } from "./model";
import { project } from "./project";
import { reduce } from "./reduce";
import { hatchedState, projectImmortal, TEST_GENERATION, testCtx } from "./testkit";
import {
  ELDER_BAND,
  ELDER_HOLD_CAP,
  ELDER_HOLD_START,
  ELDER_HOLD_STEP,
  ELDER_STARTS_AT,
  elderHoldMean,
  elderVigourPermille,
  HEALTH_DRAIN_AGE,
  HEALTH_MAX,
  LEGACY_ELDER_HOLD_MEAN,
  NEED_MAX,
  TICKS_PER_DAY,
} from "./tuning";
import type { ElderRampEvent } from "./events";

const ctx = testCtx();

const level = (value: number): PetState["needs"] => ({ hunger: value, energy: value, hygiene: value, joy: value });

const rampAt = (tick: number, seq = 900): ElderRampEvent => ({
  type: "ELDER_RAMP",
  generationId: TEST_GENERATION.id,
  seq,
  tick,
});

/** A healthy elder on its first day, needs pinned to `value`. */
const elderWith = (value: number): PetState => ({
  ...projectImmortal(hatchedState(ctx), ELDER_STARTS_AT, ctx),
  needs: level(value),
  sick: false,
  sickSinceTick: null,
  asleep: false,
  sleepReason: null,
  healthRaw: HEALTH_MAX,
});

/** Health lost over one tick — decay barely moves the needs in that time. */
const lostInATick = (state: PetState): number => HEALTH_MAX - project(state, state.tick + 1, ctx).state.healthRaw;

describe("the hold line", () => {
  it("starts at 60%, climbs 2.5 points a day, and stops at 85% on day ten", () => {
    expect(elderHoldMean(0, null)).toBe(ELDER_HOLD_START);
    expect(elderHoldMean(1, null)).toBe(ELDER_HOLD_START + ELDER_HOLD_STEP);
    expect(elderHoldMean(9, null)).toBe(825_000);
    expect(elderHoldMean(10, null)).toBe(ELDER_HOLD_CAP);
    expect(elderHoldMean(11, null)).toBe(ELDER_HOLD_CAP);
    expect(elderHoldMean(400, null)).toBe(ELDER_HOLD_CAP);
  });
});

describe("vigour", () => {
  it("is full at the hold line and falls to nothing a band below it", () => {
    const day = 10; // hold 85%, band floor 75%
    expect(elderVigourPermille(level(850_000), day, null)).toBe(1000);
    expect(elderVigourPermille(level(NEED_MAX), day, null)).toBe(1000);
    expect(elderVigourPermille(level(800_000), day, null)).toBe(500);
    expect(elderVigourPermille(level(850_000 - ELDER_BAND), day, null)).toBe(0);
    expect(elderVigourPermille(level(500_000), day, null)).toBe(0);
  });

  it("moves the band with the line", () => {
    expect(elderVigourPermille(level(600_000), 0, null)).toBe(1000);
    expect(elderVigourPermille(level(550_000), 0, null)).toBe(500);
    // Day 4: the line is at 70%, the band floor at 60%.
    expect(elderVigourPermille(level(700_000), 4, null)).toBe(1000);
    expect(elderVigourPermille(level(650_000), 4, null)).toBe(500);
    expect(elderVigourPermille(level(600_000), 4, null)).toBe(0);
  });

  it("reads the mean, not the weakest need", () => {
    const lopsided = { hunger: 1_000_000, energy: 700_000, hygiene: 900_000, joy: 800_000 };
    expect(elderVigourPermille(lopsided, 10, null)).toBe(1000);
  });

  it("pins the no-ramp line at 60%, whatever the ramp is tuned to", () => {
    expect(LEGACY_ELDER_HOLD_MEAN).toBe(600_000);
  });

  it("keeps the flat 20%-to-60% slope when there is no ramp", () => {
    expect(elderVigourPermille(level(600_000), null, null)).toBe(1000);
    expect(elderVigourPermille(level(400_000), null, null)).toBe(500);
    expect(elderVigourPermille(level(200_000), null, null)).toBe(0);
    expect(elderVigourPermille(level(100_000), null, null)).toBe(0);
  });
});

describe("where the ramp starts", () => {
  const born = 1000;
  const elderStart = born + ELDER_STARTS_AT;
  const stateWith = (elderRampFromTick?: number): PetState => ({
    ...hatchedState(ctx),
    bornAtTick: born,
    ...(elderRampFromTick === undefined ? {} : { elderRampFromTick }),
  });

  it("is null for a history with no ramp event", () => {
    expect(elderRampDayAt(stateWith(), elderStart + 30 * TICKS_PER_DAY)).toBeNull();
  });

  it("counts from the first elder day when the event landed before it", () => {
    const state = stateWith(born + 5 * TICKS_PER_DAY);
    expect(elderRampDayAt(state, elderStart)).toBe(0);
    expect(elderRampDayAt(state, elderStart + TICKS_PER_DAY - 1)).toBe(0);
    expect(elderRampDayAt(state, elderStart + 3 * TICKS_PER_DAY)).toBe(3);
  });

  it("counts from the event when it landed mid-elder", () => {
    const pinned = elderStart + 5 * TICKS_PER_DAY + 123;
    const state = stateWith(pinned);
    expect(elderRampDayAt(state, pinned)).toBe(0);
    expect(elderRampDayAt(state, pinned + TICKS_PER_DAY - 1)).toBe(0);
    expect(elderRampDayAt(state, pinned + TICKS_PER_DAY)).toBe(1);
    expect(elderRampDayAt(state, pinned + 9 * TICKS_PER_DAY)).toBe(9);
  });

  it("never goes negative, whatever tick it is asked about", () => {
    expect(elderRampDayAt(stateWith(elderStart + 100), elderStart)).toBe(0);
  });
});

describe("the ELDER_RAMP event", () => {
  it("records its own tick as the start, after projecting to it under the old rule", () => {
    const elder = elderWith(NEED_MAX);
    const tick = elder.tick + 2 * TICKS_PER_DAY;
    const { state } = reduce(elder, rampAt(tick), ctx);
    expect(state.elderRampFromTick).toBe(tick);
    expect(state.tick).toBe(tick);
    // The two days before the event were lived under the flat rule.
    expect(state.healthRaw).toBe(project(elder, tick, ctx).state.healthRaw);
  });

  it("keeps the first start when a second event arrives", () => {
    const elder = elderWith(NEED_MAX);
    const first = reduce(elder, rampAt(elder.tick + 10), ctx).state;
    const second = reduce(first, rampAt(first.tick + TICKS_PER_DAY, 901), ctx).state;
    expect(second.elderRampFromTick).toBe(first.elderRampFromTick);
  });

  it("survives the hot-state JSON round trip", () => {
    const { state } = reduce(elderWith(NEED_MAX), rampAt(elderWith(NEED_MAX).tick + 10), ctx);
    expect(JSON.parse(JSON.stringify(state)) as PetState).toEqual(state);
  });

  it("leaves a history with no event without the field at all", () => {
    const projected = project(elderWith(NEED_MAX), ELDER_STARTS_AT + TICKS_PER_DAY, ctx).state;
    expect("elderRampFromTick" in projected).toBe(false);
  });
});

describe("ageing under the ramp", () => {
  const rampedFor = (days: number, needs: number): PetState => {
    const start = elderWith(needs);
    return { ...start, elderRampFromTick: start.tick, tick: start.tick + days * TICKS_PER_DAY };
  };

  it("lets a 70% mean age the elder once the line has climbed past it, and not before", () => {
    // Flat rule: 70% is above the line, so nothing drains.
    expect(lostInATick(elderWith(700_000))).toBe(0);
    // Ramp day 0 is the same line; day 10 is 85%, and 70% is below its band.
    expect(lostInATick(rampedFor(0, 700_000))).toBe(0);
    expect(lostInATick(rampedFor(10, 700_000))).toBeCloseTo(HEALTH_DRAIN_AGE, -5);
  });

  it("holds an elder at the cap once the line is there", () => {
    expect(lostInATick(rampedFor(10, 900_000))).toBe(0);
    expect(lostInATick(rampedFor(40, 900_000))).toBe(0);
    expect(lostInATick(rampedFor(40, 800_000))).toBeCloseTo(HEALTH_DRAIN_AGE / 2, -5);
  });

  it("crosses a ramp day inside a single projection without losing the thread", () => {
    const start = { ...elderWith(NEED_MAX), elderRampFromTick: elderWith(NEED_MAX).tick };
    const end = start.tick + 12 * TICKS_PER_DAY;
    const stepped = [3, 5, 9].reduce<PetState>(
      (state, day) => project(state, start.tick + day * TICKS_PER_DAY, ctx).state,
      start,
    );
    expect(project(stepped, end, ctx).state).toEqual(project(start, end, ctx).state);
  });
});
