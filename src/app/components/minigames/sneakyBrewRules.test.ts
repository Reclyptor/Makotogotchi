import { describe, expect, it } from "vitest";
import { MINIGAME_COUNTDOWN_MS, MINIGAMES, plausibleRun } from "@/sim/minigames";
import { advance, APPROACH_MS, createBrew, MAX_POT, MS_PER_CUP, RUN_MS, SMASHED_MS, type Brew } from "./sneakyBrewRules";
import { seeded } from "./testkit";
import type { Rng } from "./types";

const FRAME_MS = 1000 / 60;
const live = (pressed: boolean) => ({ pressed, live: true });

/** Steps whole frames until `ms` has passed, holding the button as given. */
const hold = (brew: Brew, ms: number, pressed: boolean, rng: Rng): Brew => {
  let next = brew;
  for (let spent = 0; spent < ms; spent += FRAME_MS) next = advance(next, FRAME_MS, live(pressed), rng).brew;
  return next;
};

/** A brew with Natsumi parked out of the way for the whole test. */
const quiet = (): Brew => ({ ...createBrew(() => 0), phaseFor: Number.POSITIVE_INFINITY });

describe("the pot", () => {
  it("fills at one cup per MS_PER_CUP and stops at MAX_POT", () => {
    const rng = seeded(1);
    expect(hold(quiet(), MS_PER_CUP * 2 + FRAME_MS, true, rng).pot).toBeGreaterThanOrEqual(2);
    expect(hold(quiet(), MS_PER_CUP * (MAX_POT + 3), true, rng).pot).toBe(MAX_POT);
  });

  it("pours whole cups only, and counts the press and the release", () => {
    const rng = seeded(2);
    const brewed = hold(quiet(), MS_PER_CUP * 2.5, true, rng);
    const { brew, events } = advance(brewed, FRAME_MS, live(false), rng);
    expect(events).toEqual([{ kind: "poured", cups: 2 }]);
    expect(brew.score).toBe(2);
    expect(brew.pot).toBe(0);
    expect(brew.inputs).toBe(2);
  });

  it("does not brew during the countdown, but a held press brews once it ends", () => {
    const rng = seeded(3);
    const counting = advance(quiet(), 0, { pressed: true, live: false }, rng).brew;
    expect(counting.inputs).toBe(0);
    expect(counting.brewing).toBe(false);
    const armed = advance(counting, FRAME_MS, live(true), rng).brew;
    expect(armed.inputs).toBe(1);
    expect(armed.brewing).toBe(true);
  });
});

describe("Natsumi", () => {
  const arriving = (): Brew => ({ ...createBrew(() => 0), natsumi: "coming", phaseMs: 0, phaseFor: APPROACH_MS });

  it("smashes a pot that is brewing the moment she arrives", () => {
    const rng = seeded(4);
    const caught = hold(arriving(), APPROACH_MS + FRAME_MS, true, rng);
    expect(caught.natsumi).toBe("over");
    expect(caught.smashedMs).toBeGreaterThan(0);
    expect(caught.pot).toBe(0);
    // Letting go of a smashed pot pours nothing.
    const { brew, events } = advance(caught, FRAME_MS, live(false), rng);
    expect(events).toEqual([]);
    expect(brew.score).toBe(0);
  });

  it("leaves a machine alone once she is standing over it", () => {
    const rng = seeded(5);
    let brew = hold(arriving(), APPROACH_MS + FRAME_MS, false, rng);
    expect(brew.natsumi).toBe("over");
    brew = hold(brew, MS_PER_CUP, true, rng);
    expect(brew.smashedMs).toBe(0);
    expect(brew.pot).toBeGreaterThan(0);
  });

  it("lets the machine work again once it has been swept up", () => {
    const rng = seeded(6);
    const caught = hold(arriving(), APPROACH_MS + FRAME_MS, true, rng);
    const later = hold(caught, SMASHED_MS + FRAME_MS, true, rng);
    expect(later.smashedMs).toBe(0);
    expect(later.brewing).toBe(true);
  });
});

/** The best play the rules allow: brew all the time, and let go to pour when
 *  the pot is full or when Natsumi is one frame from arriving. */
const perfectRun = (rng: Rng, frameMs: number): Brew => {
  let brew = createBrew(rng);
  let elapsed = 0;
  let brewedMs = 0;
  while (elapsed < RUN_MS) {
    elapsed += frameMs;
    const arrivesNextFrame = brew.natsumi === "coming" && brew.phaseMs + 2 * frameMs >= brew.phaseFor;
    const pressed = !(brew.pot >= MAX_POT || arrivesNextFrame || (brew.holding && !brew.brewing));
    brew = advance(brew, frameMs, live(pressed), rng).brew;
    if (brew.brewing) brewedMs += frameMs;
    // The pot and this tally sum the same frames in different units, so they
    // can disagree in the last bit as a cup completes.
    expect(brew.score).toBeLessThanOrEqual(Math.floor(brewedMs / MS_PER_CUP + 1e-9));
  }
  return brew;
};

describe("a perfect run", () => {
  // The bug players hit: the envelope was a hand estimate of one pot per round
  // trip, so the best honest runs scored above it and were thrown out at
  // finish as implausible. The envelope is now read off these same rules, and
  // a perfect player of them has to pass it.
  it("is never caught, beats one pot per trip, and passes the server's envelope", () => {
    const game = MINIGAMES.coffeerun;
    for (const frameMs of [1000 / 144, 1000 / 60, 1000 / 30, 50]) {
      for (let seed = 1; seed <= 100; seed++) {
        const brew = perfectRun(seeded(seed), frameMs);
        expect(brew.smashedMs).toBe(0);
        expect(brew.score).toBeGreaterThan(32);
        expect(brew.score).toBeLessThanOrEqual(game.maxScore);
        expect(plausibleRun(game, MINIGAME_COUNTDOWN_MS + RUN_MS, brew.score, brew.inputs)).toBe(true);
      }
    }
  });
});
