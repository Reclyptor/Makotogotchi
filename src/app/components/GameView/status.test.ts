// "Makoto is doing fine." over a 1% health meter. The line read only the
// ailments, and a pet nursed back from the brink has none. Now it reads the
// whole state, most important fact first (SPEC §11.7).

import { describe, expect, it } from "vitest";
import { SLIPPING_BELOW, statusLine } from "./status";
import { derive } from "@/sim/derive";
import type { PetState } from "@/sim/model";
import { hatchedState, projectImmortal, testCtx } from "@/sim/testkit";
import { HEALTH_MAX, NEED_MAX, STAGE_STARTS, TICKS_PER_DAY, TICKS_PER_HOUR } from "@/sim/tuning";

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
const line = (state: PetState): string => statusLine("Makoto", state, derive(state));
const sickFor = (ticks: number): PetState => ({ ...adult, sick: true, sickSinceTick: adult.tick - ticks });

describe("the status line", () => {
  it("says fine only when health agrees", () => {
    expect(line(adult)).toBe("Makoto is doing fine.");
    expect(line(nearDeath)).toBe("Makoto is recovering.");
    expect(line({ ...elder, healthRaw: HEALTH_MAX / 100 })).toBe("Makoto is dangerously weak.");
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
    expect(line(sickFor(0))).toBe("Makoto just fell sick.");
    expect(line(sickFor(TICKS_PER_HOUR))).toBe("Makoto has been sick for 1 hour.");
    expect(line(sickFor(5 * TICKS_PER_HOUR + 7))).toBe("Makoto has been sick for 5 hours.");
    expect(line(sickFor(TICKS_PER_DAY + 3 * TICKS_PER_HOUR))).toBe("Makoto has been sick since yesterday.");
    expect(line(sickFor(3 * TICKS_PER_DAY))).toBe("Makoto has been sick for 3 days.");
    // A history that never recorded the onset reads as just now, not as NaN.
    expect(line({ ...adult, sick: true, sickSinceTick: null })).toBe("Makoto just fell sick.");
  });

  it("lists every ailment worst first, with the sickness last", () => {
    const wreck = { ...adult, needs: { hunger: 0, energy: NEED_MAX, hygiene: 0, joy: 0 } };
    expect(line(wreck)).toBe("Makoto is starving, filthy and sad.");
    expect(line({ ...wreck, needs: { ...wreck.needs, joy: NEED_MAX } })).toBe("Makoto is starving and filthy.");
    expect(line({ ...wreck, ...sickFor(2 * TICKS_PER_DAY), needs: wreck.needs })).toBe(
      "Makoto is starving, filthy and sad, and has been sick for 2 days.",
    );
    expect(line({ ...sickFor(0), healthRaw: HEALTH_MAX / 100 })).toBe("Makoto just fell sick. Health is dangerously low.");
  });

  it("speaks up for the lowest need before it becomes an ailment", () => {
    const sleepy = { ...adult, needs: { ...adult.needs, energy: SLIPPING_BELOW - 1 } };
    expect(line(sleepy)).toBe("Makoto is getting sleepy.");
    expect(line({ ...adult, needs: { ...adult.needs, energy: SLIPPING_BELOW } })).toBe("Makoto is doing fine.");
    expect(line({ ...sleepy, needs: { ...sleepy.needs, hunger: SLIPPING_BELOW - 2 } })).toBe("Makoto is getting hungry.");
    expect(line({ ...adult, needs: { ...adult.needs, hygiene: NEED_MAX / 3 } })).toBe("Makoto could use a bath.");
    expect(line({ ...adult, needs: { ...adult.needs, joy: NEED_MAX / 3 } })).toBe("Makoto is getting bored.");
    // Low health outranks a slipping need; an ailment outranks both.
    expect(line({ ...sleepy, healthRaw: HEALTH_MAX / 100 })).toBe("Makoto is recovering.");
    expect(line({ ...sleepy, needs: { ...sleepy.needs, hygiene: 0 } })).toBe("Makoto is filthy.");
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
