// "Makoto is doing fine." over a 1% health meter. The line read only the
// ailments, and a pet nursed back from the brink has none. Now it reads the
// whole state, most important fact first (SPEC §11.7).

import { describe, expect, it } from "vitest";
import { SLIPPING_BELOW, statusLine, ticksUntilWake, untilWakeText } from "./status";
import { derive, type DerivedState, type HealthReason, type HealthView } from "@/sim/derive";
import type { PetState } from "@/sim/model";
import { hatchedState, projectImmortal, testCtx } from "@/sim/testkit";
import {
  ASLEEP_HOURS,
  AWAKE_HOURS,
  ENERGY_SLEEP_RECOVERY,
  HEALTH_MAX,
  NAP_WAKE_THRESHOLD,
  NEED_MAX,
  STAGE_STARTS,
  TICKS_PER_DAY,
  TICKS_PER_HOUR,
} from "@/sim/tuning";

const ctx = testCtx();
const contented = (state: PetState): PetState => ({
  ...state,
  needs: { hunger: NEED_MAX, energy: NEED_MAX, hygiene: NEED_MAX, joy: NEED_MAX },
  healthRaw: HEALTH_MAX,
  sick: false,
  sickSinceTick: null,
  asleep: false,
  sleepReason: null,
});
const born = hatchedState(ctx);
const adult = contented(projectImmortal(born, 10 * TICKS_PER_DAY, ctx));
const elder = contented(projectImmortal(born, 22 * TICKS_PER_DAY, ctx));
const nearDeath = { ...adult, healthRaw: HEALTH_MAX / 100 };
const thin = { hunger: 300_000, energy: 300_000, hygiene: 300_000, joy: 300_000 };
const line = (state: PetState): string => statusLine("Makoto", state, derive(state)).text;
const elderFragment = (state: PetState): string | null => statusLine("Makoto", state, derive(state)).elder;
const HOLDING = " Health is holding steady.";
const sickFor = (ticks: number): PetState => ({ ...adult, sick: true, sickSinceTick: adult.tick - ticks });

describe("the status line", () => {
  it("says fine only when health agrees", () => {
    expect(line(adult)).toBe("Makoto is doing fine.");
    expect(line(nearDeath)).toBe("Makoto is weak. Health is coming back.");
    expect(line({ ...elder, healthRaw: HEALTH_MAX / 100 })).toBe("Makoto is weak. Health is coming back.");
    expect(line({ ...elder, healthRaw: HEALTH_MAX / 100, needs: thin })).toBe(
      "Makoto is dangerously weak. Health is falling with age: needs average 30%, today's line is 60%.",
    );
    expect(line({ ...elder, healthRaw: HEALTH_MAX * 0.4, needs: thin })).toBe(
      "Makoto is fading. Health is falling with age: needs average 30%, today's line is 60%.",
    );
    expect(line({ ...elder, healthRaw: HEALTH_MAX * 0.4, needs: thin, asleep: true, sleepReason: "NIGHT" })).toBe(
      "Makoto is asleep for the night. Health is falling with age: needs average 30%, today's line is 60%.",
    );
  });

  it("names the death the way the memorial does", () => {
    expect(line({ ...adult, diedAtTick: adult.tick, causeOfDeath: "hunger" })).toBe(
      "Makoto starved. A new egg will appear soon.",
    );
    expect(line({ ...elder, diedAtTick: elder.tick, causeOfDeath: "age" })).toBe(
      "Makoto passed peacefully of old age. A new egg will appear soon.",
    );
    expect(line({ ...adult, diedAtTick: adult.tick, causeOfDeath: null })).toBe(
      "Makoto has died. A new egg will appear soon.",
    );
  });

  it("keeps the egg line, whatever else the state says", () => {
    expect(line({ ...nearDeath, bornAtTick: null, sick: true })).toBe("The egg is incubating…");
  });

  it("says why Makoto is asleep, and keeps health in the picture", () => {
    expect(line({ ...adult, asleep: true, sleepReason: "NIGHT" })).toBe("Makoto is asleep for the night.");
    expect(line({ ...adult, asleep: true, sleepReason: "NAP" })).toBe("Makoto is napping until the energy comes back.");
    expect(line({ ...adult, asleep: true, sleepReason: "LULLABY" })).toBe("Makoto was sung to sleep.");
    expect(line({ ...adult, asleep: true, sleepReason: null })).toBe("Makoto is asleep.");
    expect(line({ ...nearDeath, asleep: true, sleepReason: "NIGHT" })).toBe(
      "Makoto is asleep for the night. Health is coming back.",
    );
  });

  it("dates the sickness", () => {
    expect(line(sickFor(0))).toBe(`Makoto just fell sick.${HOLDING}`);
    expect(line(sickFor(TICKS_PER_HOUR))).toBe(`Makoto has been sick for 1 hour.${HOLDING}`);
    expect(line(sickFor(5 * TICKS_PER_HOUR + 7))).toBe(`Makoto has been sick for 5 hours.${HOLDING}`);
    expect(line(sickFor(TICKS_PER_DAY + 3 * TICKS_PER_HOUR))).toBe(`Makoto has been sick since yesterday.${HOLDING}`);
    expect(line(sickFor(3 * TICKS_PER_DAY))).toBe(`Makoto has been sick for 3 days.${HOLDING}`);
    // A history that never recorded the onset reads as just now, not as NaN.
    expect(line({ ...adult, sick: true, sickSinceTick: null })).toBe(`Makoto just fell sick.${HOLDING}`);
  });

  it("lists every ailment worst first, with the sickness last", () => {
    const wreck = { ...adult, needs: { hunger: 0, energy: NEED_MAX, hygiene: 0, joy: 0 } };
    const why = " Health is falling: hunger is below 20%.";
    expect(line(wreck)).toBe(`Makoto is starving, filthy and sad.${why}`);
    expect(line({ ...wreck, needs: { ...wreck.needs, joy: NEED_MAX } })).toBe(`Makoto is starving and filthy.${why}`);
    expect(line({ ...wreck, ...sickFor(2 * TICKS_PER_DAY), needs: wreck.needs })).toBe(
      `Makoto is starving, filthy and sad, and has been sick for 2 days.${why}`,
    );
  });

  it("speaks up for the lowest need before it becomes an ailment", () => {
    const sleepy = { ...adult, needs: { ...adult.needs, energy: SLIPPING_BELOW - 1 } };
    expect(line(sleepy)).toBe("Makoto is getting sleepy.");
    expect(line({ ...adult, needs: { ...adult.needs, energy: SLIPPING_BELOW } })).toBe("Makoto is doing fine.");
    expect(line({ ...sleepy, needs: { ...sleepy.needs, hunger: SLIPPING_BELOW - 2 } })).toBe("Makoto is getting hungry.");
    expect(line({ ...adult, needs: { ...adult.needs, hygiene: NEED_MAX / 3 } })).toBe("Makoto could use a bath.");
    expect(line({ ...adult, needs: { ...adult.needs, joy: NEED_MAX / 3 } })).toBe("Makoto is getting bored.");
    // Low health outranks a slipping need; an ailment outranks both.
    expect(line({ ...sleepy, healthRaw: HEALTH_MAX / 100 })).toBe("Makoto is weak. Health is coming back.");
    expect(line({ ...sleepy, needs: { ...sleepy.needs, hygiene: 0 } })).toBe(
      "Makoto is filthy. Health is falling: hygiene is below 20%.",
    );
  });

  it("gives a well pet a line for its age", () => {
    const expected: Record<string, string> = {
      HATCHLING: "Makoto is small and curious.",
      PUP: "Makoto is full of beans.",
      JUVENILE: "Makoto is growing fast.",
      ADULT: "Makoto is doing fine.",
      ELDER: "Makoto is taking it slow.",
    };
    for (const { stage, atTick } of STAGE_STARTS) {
      const state = contented(projectImmortal(born, atTick + 1, ctx));
      expect(derive(state).stage).toBe(stage);
      expect(line(state)).toBe(expected[stage]);
    }
    expect(line(contented(born))).toBe(expected.HATCHLING);
  });
});

// Health gets a sentence of its own: which way it is moving and why, worded
// from derive's HealthView. Real states first, so the wiring is exercised end
// to end; the copy for each reason is then pinned on its own.
describe("the health sentence", () => {
  const hurt = { ...adult, healthRaw: HEALTH_MAX / 2 };

  it("says nothing while health is full and nothing is pulling on it", () => {
    expect(line(adult)).toBe("Makoto is doing fine.");
  });

  it("names the need that is dragging health down", () => {
    for (const need of ["hunger", "energy", "hygiene", "joy"] as const) {
      const state = { ...hurt, needs: { ...hurt.needs, [need]: 0 } };
      expect(line(state)).toContain(`Health is falling: ${need} is below 20%.`);
    }
  });

  it("blames sickness when that is the bigger drain", () => {
    const state = { ...hurt, sick: true, sickSinceTick: hurt.tick - 3 * TICKS_PER_HOUR, needs: { ...hurt.needs, hunger: 190_000 } };
    expect(line(state)).toBe("Makoto has been sick for 3 hours. Health is falling: sickness.");
  });

  it("says health is coming back while it recovers", () => {
    expect(line(hurt)).toBe("Makoto is doing fine. Health is coming back.");
  });

  it("says health is holding when sickness and recovery cancel out", () => {
    expect(line({ ...hurt, sick: true, sickSinceTick: hurt.tick })).toBe(`Makoto just fell sick.${HOLDING}`);
  });

  it("explains an elder's decline with its own numbers", () => {
    const state = { ...elder, healthRaw: HEALTH_MAX * 0.4, needs: thin };
    expect(line(state)).toBe(
      "Makoto is fading. Health is falling with age: needs average 30%, today's line is 60%.",
    );
  });

  it("words every reason, whatever the pet is doing", () => {
    const base = derive(adult);
    const health = (reason: HealthReason, elder: HealthView["elder"] = null): DerivedState => ({
      ...base,
      health: { trend: "steady", reason, elder },
    });
    const say = (reason: HealthReason, elder?: HealthView["elder"]): string =>
      statusLine("Makoto", adult, health(reason, elder)).text;
    expect(say({ kind: "need", need: "hunger" })).toBe("Makoto is doing fine. Health is falling: hunger is below 20%.");
    expect(say({ kind: "need", need: "joy" })).toBe("Makoto is doing fine. Health is falling: joy is below 20%.");
    expect(say({ kind: "sick" })).toBe("Makoto is doing fine. Health is falling: sickness.");
    expect(say({ kind: "age" }, { linePercent: 77, meanPercent: 74 })).toBe(
      "Makoto is doing fine. Health is falling with age: needs average 74%, today's line is 77%.",
    );
    expect(say({ kind: "age" })).toBe("Makoto is doing fine. Health is falling with age.");
    expect(say({ kind: "regen" })).toBe("Makoto is doing fine. Health is coming back.");
    expect(say({ kind: "holding" })).toBe(`Makoto is doing fine.${HOLDING}`);
    expect(say({ kind: "full" })).toBe("Makoto is doing fine.");
  });

  it("keeps the sentence out of the death and egg lines", () => {
    const dying = { ...hurt, diedAtTick: hurt.tick, causeOfDeath: "hunger" as const };
    expect(line(dying)).toBe("Makoto starved. A new egg will appear soon.");
    expect(elderFragment(dying)).toBeNull();
    const egg = { ...hurt, bornAtTick: null };
    expect(line(egg)).toBe("The egg is incubating…");
    expect(elderFragment(egg)).toBeNull();
  });
});

// An elder's hold line and the needs' average ride beside the sentence as a
// fragment the page sets quieter, so it comes back as its own field.
describe("the elder fragment", () => {
  it("shows the line, then the average, even while health is rising", () => {
    const state = { ...elder, healthRaw: HEALTH_MAX / 2 };
    expect(line(state)).toBe("Makoto is taking it slow. Health is coming back.");
    expect(elderFragment(state)).toBe("needs 60% · at 100%");
  });

  it("is there when nothing is moving, and when sickness is the cause", () => {
    expect(elderFragment(elder)).toBe("needs 60% · at 100%");
    const sick = { ...elder, healthRaw: HEALTH_MAX / 2, sick: true, sickSinceTick: elder.tick, needs: { ...elder.needs, hunger: 190_000 } };
    expect(line(sick)).toContain("Health is falling: sickness.");
    expect(elderFragment(sick)).toMatch(/^needs 60% · at \d+%$/);
  });

  it("steps aside when the sentence already gives both numbers", () => {
    const state = { ...elder, healthRaw: HEALTH_MAX * 0.4, needs: thin };
    expect(line(state)).toContain("needs average 30%, today's line is 60%");
    expect(elderFragment(state)).toBeNull();
  });

  it("is absent before old age", () => {
    expect(elderFragment(adult)).toBeNull();
    expect(elderFragment({ ...adult, healthRaw: HEALTH_MAX / 2 })).toBeNull();
    expect(elderFragment(born)).toBeNull();
  });

  it("is kept while the elder sleeps", () => {
    expect(elderFragment({ ...elder, asleep: true, sleepReason: "NIGHT" })).toBe("needs 60% · at 100%");
  });
});

// The sleeping pet says how long it has left (SPEC §11.7). A duration, not a
// clock time: the pet keeps one home timezone and its carers do not.
describe("the wake countdown", () => {
  const base = projectImmortal(hatchedState(ctx), 100, ctx);

  it("counts the night down off the schedule", () => {
    const bedtime = AWAKE_HOURS * TICKS_PER_HOUR;
    const night = projectImmortal(hatchedState(ctx), bedtime + TICKS_PER_HOUR, ctx);
    expect(night.asleep).toBe(true);
    expect(night.sleepReason).toBe("NIGHT");
    // One hour in, the rest of the night is still to run.
    expect(ticksUntilWake(night, ctx)).toBe((ASLEEP_HOURS - 1) * TICKS_PER_HOUR);
  });

  it("counts a nap down off the recovery rate, which is what ends it", () => {
    const napping: PetState = {
      ...base,
      asleep: true,
      sleepReason: "NAP",
      needs: { ...base.needs, energy: NAP_WAKE_THRESHOLD - 3 * ENERGY_SLEEP_RECOVERY },
    };
    expect(ticksUntilWake(napping, ctx)).toBe(3);
  });

  it("has nothing to count for a pet that is awake", () => {
    expect(ticksUntilWake(base, ctx)).toBeNull();
  });

  it("reads as a duration a person can act on", () => {
    expect(untilWakeText(0)).toBe("any moment now");
    expect(untilWakeText(6)).toBe("any moment now"); // one minute
    expect(untilWakeText(45 * 6)).toBe("in 45m");
    expect(untilWakeText(2 * TICKS_PER_HOUR)).toBe("in 2h");
    expect(untilWakeText(2 * TICKS_PER_HOUR + 20 * 6)).toBe("in 2h 20m");
    // Never a clock time — that is the whole reason this exists.
    for (const ticks of [0, 6, 300, 5000]) expect(untilWakeText(ticks)).not.toMatch(/\d\d:\d\d/);
  });

  it("puts the countdown in the status line, whatever put the pet down", () => {
    for (const reason of ["NIGHT", "NAP", "LULLABY"] as const) {
      const asleep: PetState = { ...base, asleep: true, sleepReason: reason };
      expect(statusLine("Makoto", asleep, derive(asleep), ctx).text).toContain("Wakes ");
    }
    // And says nothing about waking when there is no schedule to read.
    const asleep: PetState = { ...base, asleep: true, sleepReason: "NIGHT" };
    expect(statusLine("Makoto", asleep, derive(asleep)).text).not.toContain("Wakes ");
  });
});
