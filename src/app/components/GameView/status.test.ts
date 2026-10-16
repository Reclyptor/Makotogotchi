// "Makoto is doing fine." over a 1% health meter. The line read only the
// ailments, and a pet nursed back from the brink has none. Now it reads the
// whole state, most important fact first (SPEC §11.7).

import { describe, expect, it } from "vitest";
import { SLIPPING_BELOW, statusLine, ticksUntilWake, untilWakeText } from "./status";
import { derive, type DerivedState, type HealthReason } from "@/sim/derive";
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
const elderFragment = (state: PetState): string | null => statusLine("Makoto", state, derive(state)).elder?.shown ?? null;
const HOLDING = " Health is holding steady.";
const sickFor = (ticks: number): PetState => ({ ...adult, sick: true, sickSinceTick: adult.tick - ticks });

describe("the status line", () => {
  it("says fine only when health agrees", () => {
    expect(line(adult)).toBe("Makoto is doing fine.");
    expect(line(nearDeath)).toBe("Makoto is weak. Health is coming back.");
    expect(line({ ...elder, healthRaw: HEALTH_MAX / 100 })).toBe("Makoto is weak. Health is coming back.");
    expect(line({ ...elder, healthRaw: HEALTH_MAX / 100, needs: thin })).toBe(
      "Makoto is dangerously weak. Health is falling with age.",
    );
    expect(line({ ...elder, healthRaw: HEALTH_MAX * 0.4, needs: thin })).toBe(
      "Makoto is fading. Health is falling with age.",
    );
    expect(line({ ...elder, healthRaw: HEALTH_MAX * 0.4, needs: thin, asleep: true, sleepReason: "NIGHT" })).toBe(
      "Makoto is asleep for the night. Health is falling with age.",
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
    const why = " Health is falling.";
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
    expect(line({ ...sleepy, needs: { ...sleepy.needs, hygiene: 0 } })).toBe("Makoto is filthy. Health is falling.");
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
// to end; the copy for each reason is then pinned on its own. A cause the
// headline already named is not repeated.
describe("the health sentence", () => {
  const hurt = { ...adult, healthRaw: HEALTH_MAX / 2 };
  // Below the critical line (20%) but above where starving begins (15%): a
  // drain on health that the headline has no word for.
  const peckish = { ...hurt.needs, hunger: 170_000 };

  it("says nothing while health is full and nothing is pulling on it", () => {
    expect(line(adult)).toBe("Makoto is doing fine.");
  });

  it("says only that health is falling when the headline names the need", () => {
    const starving = { ...hurt, needs: { ...hurt.needs, hunger: 0 } };
    expect(line(starving)).toBe("Makoto is starving. Health is falling.");
    expect(line({ ...hurt, needs: { ...hurt.needs, hygiene: 0 } })).toBe("Makoto is filthy. Health is falling.");
    expect(line({ ...hurt, needs: { ...hurt.needs, joy: 0 } })).toBe("Makoto is sad. Health is falling.");
  });

  it("names a need the headline has no ailment for", () => {
    expect(line({ ...hurt, needs: peckish })).toBe(
      "Makoto is getting hungry. Health is falling: hunger is below 20%.",
    );
    expect(line({ ...hurt, needs: { ...hurt.needs, energy: 190_000 } })).toBe(
      "Makoto is getting sleepy. Health is falling: energy is below 20%.",
    );
  });

  it("names the need while asleep, since the headline is about the sleep", () => {
    const state = { ...hurt, asleep: true, sleepReason: "NIGHT" as const, needs: { ...hurt.needs, hunger: 0 } };
    expect(line(state)).toBe("Makoto is asleep for the night. Health is falling: hunger is below 20%.");
  });

  it("says only that health is falling when the headline names the sickness", () => {
    const state = { ...hurt, sick: true, sickSinceTick: hurt.tick - 3 * TICKS_PER_HOUR, needs: { ...hurt.needs, hunger: 190_000 } };
    expect(line(state)).toBe("Makoto has been sick for 3 hours. Health is falling.");
  });

  it("names the sickness while asleep, since the headline is about the sleep", () => {
    const state = { ...hurt, asleep: true, sleepReason: "NIGHT" as const, sick: true, sickSinceTick: hurt.tick, needs: peckish };
    expect(line(state)).toBe("Makoto is asleep for the night. Health is falling: sickness.");
  });

  it("says health is coming back while it recovers", () => {
    expect(line(hurt)).toBe("Makoto is doing fine. Health is coming back.");
  });

  it("says health is holding steady when sickness cancels recovery at full health", () => {
    expect(line({ ...adult, sick: true, sickSinceTick: adult.tick })).toBe(`Makoto just fell sick.${HOLDING}`);
  });

  it("says health is stuck, and why, when sickness cancels recovery below full", () => {
    const sick = { ...hurt, sick: true, sickSinceTick: hurt.tick };
    expect(line(sick)).toBe("Makoto just fell sick. Health is stuck.");
    expect(line({ ...sick, asleep: true, sleepReason: "NIGHT" })).toBe(
      "Makoto is asleep for the night. Health is stuck: sickness stops it coming back.",
    );
  });

  // A sick pet at 1% used to be told "Health is dangerously low."; a headline
  // about sleep or sickness must not bury that.
  it("keeps the danger in the sentence when the headline does not say it", () => {
    const frail = { ...adult, healthRaw: HEALTH_MAX / 100 };
    const sick = { ...frail, sick: true, sickSinceTick: frail.tick };
    expect(line(sick)).toBe("Makoto just fell sick. Health is dangerously low and stuck.");
    expect(line({ ...sick, asleep: true, sleepReason: "NIGHT" })).toBe(
      "Makoto is asleep for the night. Health is dangerously low and stuck: sickness stops it coming back.",
    );
    expect(line({ ...frail, needs: { ...frail.needs, hunger: 0 } })).toBe(
      "Makoto is starving. Health is dangerously low and falling.",
    );
    expect(line({ ...frail, asleep: true, sleepReason: "NIGHT", needs: { ...frail.needs, hunger: 170_000 } })).toBe(
      "Makoto is asleep for the night. Health is dangerously low and falling: hunger is below 20%.",
    );
    expect(line({ ...sick, needs: { ...frail.needs, hunger: 170_000 } })).toBe(
      "Makoto just fell sick. Health is dangerously low and falling.",
    );
    const frailElder = { ...elder, healthRaw: HEALTH_MAX / 100, needs: thin, asleep: true, sleepReason: "NIGHT" as const };
    expect(line(frailElder)).toBe("Makoto is asleep for the night. Health is dangerously low and falling with age.");
  });

  it("does not say it twice when the headline already does", () => {
    const weak = { ...elder, healthRaw: HEALTH_MAX / 100, needs: thin };
    expect(line(weak)).toBe("Makoto is dangerously weak. Health is falling with age.");
    // And a recovering pet is not in danger: it is on its way back.
    expect(line({ ...adult, healthRaw: HEALTH_MAX / 100, asleep: true, sleepReason: "NIGHT" })).toBe(
      "Makoto is asleep for the night. Health is coming back.",
    );
  });

  it("puts an elder's decline down to age, without the numbers", () => {
    const state = { ...elder, healthRaw: HEALTH_MAX * 0.4, needs: thin };
    expect(line(state)).toBe("Makoto is fading. Health is falling with age.");
  });

  it("words every reason against whatever the headline names", () => {
    const base = derive(adult);
    const say = (reason: HealthReason, state: PetState = adult, derived: DerivedState = base): string =>
      statusLine("Makoto", state, { ...derived, health: { trend: "steady", reason, elder: null } }).text;

    // Nothing named: a quiet headline, so the reason is spelled out.
    expect(say({ kind: "need", need: "hunger" })).toBe("Makoto is doing fine. Health is falling: hunger is below 20%.");
    expect(say({ kind: "need", need: "joy" })).toBe("Makoto is doing fine. Health is falling: joy is below 20%.");
    expect(say({ kind: "sick" })).toBe("Makoto is doing fine. Health is falling: sickness.");
    expect(say({ kind: "age" })).toBe("Makoto is doing fine. Health is falling with age.");
    expect(say({ kind: "regen" })).toBe("Makoto is doing fine. Health is coming back.");
    expect(say({ kind: "holding" })).toBe(`Makoto is doing fine.${HOLDING}`);
    expect(say({ kind: "holding" }, hurt, derive(hurt))).toBe("Makoto is doing fine. Health is stuck: sickness stops it coming back.");
    expect(say({ kind: "full" })).toBe("Makoto is doing fine.");

    // Sick, and a need the headline does not name: the need is still said.
    const sick = { ...adult, sick: true, sickSinceTick: adult.tick - 3 * TICKS_PER_HOUR, needs: { ...adult.needs, hunger: 170_000 } };
    const sickView = derive(sick);
    expect(say({ kind: "need", need: "hunger" }, sick, sickView)).toBe(
      "Makoto has been sick for 3 hours. Health is falling: hunger is below 20%.",
    );
    // And a need the headline does name is not.
    const starvingSick = { ...sick, needs: { ...sick.needs, hunger: 0 } };
    expect(say({ kind: "need", need: "hunger" }, starvingSick, derive(starvingSick))).toBe(
      "Makoto is starving, and has been sick for 3 hours. Health is falling.",
    );
    // A different need from the one named still gets its word.
    expect(say({ kind: "need", need: "joy" }, starvingSick, derive(starvingSick))).toBe(
      "Makoto is starving, and has been sick for 3 hours. Health is falling: joy is below 20%.",
    );
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
// fragment the page sets quieter, so it comes back as its own field. The
// numbers live only there.
describe("the elder fragment", () => {
  it("shows the line, then the average, even while health is rising", () => {
    const state = { ...elder, healthRaw: HEALTH_MAX / 2 };
    expect(line(state)).toBe("Makoto is taking it slow. Health is coming back.");
    expect(elderFragment(state)).toBe("needs 60% · at 100%");
  });

  it("is there when nothing is moving", () => {
    expect(line(elder)).toBe("Makoto is taking it slow.");
    expect(elderFragment(elder)).toBe("needs 60% · at 100%");
  });

  it("is there when sickness is the cause", () => {
    const sick = { ...elder, healthRaw: HEALTH_MAX / 2, sick: true, sickSinceTick: elder.tick, needs: { ...elder.needs, hunger: 190_000 } };
    expect(line(sick)).toBe("Makoto just fell sick. Health is falling.");
    expect(elderFragment(sick)).toMatch(/^needs 60% · at \d+%$/);
  });

  it("is there when age is the cause, and is the only place the numbers appear", () => {
    const state = { ...elder, healthRaw: HEALTH_MAX * 0.4, needs: thin };
    expect(line(state)).toBe("Makoto is fading. Health is falling with age.");
    expect(elderFragment(state)).toBe("needs 60% · at 30%");
  });

  describe("when the line and the average are close", () => {
    const shownAt = (linePermille: number, meanPermille: number) => {
      const base = derive(elder);
      const view = statusLine("Makoto", elder, { ...base, health: { ...base.health, elder: { linePermille, meanPermille } } });
      return view.elder;
    };

    it("rounds each down to a whole percent while they differ", () => {
      expect(shownAt(600, 810)?.shown).toBe("needs 60% · at 81%");
      expect(shownAt(625, 630)?.shown).toBe("needs 62% · at 63%");
      expect(shownAt(600, 1000)?.shown).toBe("needs 60% · at 100%");
    });

    it("shows a tenth when flooring would make them look equal, whichever is higher", () => {
      // Falling just short of the line, and sitting just over it.
      expect(shownAt(625, 624)?.shown).toBe("needs 62.5% · at 62.4%");
      expect(shownAt(624, 625)?.shown).toBe("needs 62.4% · at 62.5%");
      expect(shownAt(625, 625)?.shown).toBe("needs 62.5% · at 62.5%");
      expect(shownAt(600, 600)?.shown).toBe("needs 60.0% · at 60.0%");
    });

    it("reads the same numbers to a screen reader", () => {
      expect(shownAt(625, 624)?.spoken).toBe("Today's line is 62.5%; needs average 62.4%.");
      expect(shownAt(600, 810)?.spoken).toBe("Today's line is 60%; needs average 81%.");
    });
  });

  it("has a whole-sentence reading for a screen reader", () => {
    const { elder: fragment } = statusLine("Makoto", elder, derive(elder));
    expect(fragment?.spoken).toBe("Today's line is 60%; needs average 100%.");
  });

  it("is kept while the elder sleeps", () => {
    expect(elderFragment({ ...elder, asleep: true, sleepReason: "NIGHT" })).toBe("needs 60% · at 100%");
  });

  it("is absent before old age", () => {
    expect(elderFragment(adult)).toBeNull();
    expect(elderFragment({ ...adult, healthRaw: HEALTH_MAX / 2 })).toBeNull();
    expect(elderFragment(born)).toBeNull();
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
