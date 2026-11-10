// Sneaky Brew's rules (SPEC §13.3.3), with no canvas in them: the pot, the
// pour, and Natsumi's round trip. The component renders a Brew and feeds the
// button back in; the randomness is injected so the rules can be played by a
// test exactly as a player would.
//
// The pot's fill rate is the one rule the server's envelope is derived from,
// so it lives beside that envelope in the sim (`SNEAKY_BREW`) and is read from
// there. A perfect player brews at that rate almost the whole run: Natsumi only
// smashes a pot that is brewing at the instant she arrives, and her walk-in is
// in plain view.

import { SNEAKY_BREW } from "@/sim/minigames";
import type { Rng } from "./types";

export const { runMs: RUN_MS, msPerCup: MS_PER_CUP, maxPot: MAX_POT } = SNEAKY_BREW;

// Her round trip: away, walking in, standing over the machine, walking off.
export const GONE_MS = [2600, 4200] as const;
export const APPROACH_MS = 1300;
export const OVER_MS = 700;
export const LEAVING_MS = 900;

export const SMASHED_MS = 1000;
export const POUR_MS = 500;

export type NatsumiPhase = "gone" | "coming" | "over" | "leaving";

export type Brew = {
  /** Cups in the pot, fractional while it fills. */
  pot: number;
  /** Cups poured — the run's score. */
  score: number;
  /** Presses and releases, each a deliberate act toward the inputs floor. */
  inputs: number;
  /** Whether the current press has been counted. A press begun during the
   *  pre-roll still brews, and counts, the moment the count ends. */
  holding: boolean;
  /** Whether the pot filled on the last step. */
  brewing: boolean;
  smashedMs: number;
  pourMs: number;
  natsumi: NatsumiPhase;
  phaseMs: number;
  phaseFor: number;
};

export type BrewInput = {
  /** The raw button state. */
  pressed: boolean;
  /** Whether the run is armed — past the countdown. */
  live: boolean;
};

export type BrewEvent = { kind: "poured"; cups: number } | { kind: "smashed" };

const between = ([low, high]: readonly [number, number], rng: Rng): number => low + rng() * (high - low);

export const createBrew = (rng: Rng): Brew => ({
  pot: 0,
  score: 0,
  inputs: 0,
  holding: false,
  brewing: false,
  smashedMs: 0,
  pourMs: 0,
  natsumi: "gone",
  phaseMs: 0,
  phaseFor: between(GONE_MS, rng),
});

export const advance = (
  previous: Brew,
  dtMs: number,
  { pressed, live }: BrewInput,
  rng: Rng,
): { brew: Brew; events: BrewEvent[] } => {
  const brew: Brew = {
    ...previous,
    smashedMs: Math.max(0, previous.smashedMs - dtMs),
    pourMs: Math.max(0, previous.pourMs - dtMs),
    phaseMs: previous.phaseMs + dtMs,
  };
  const events: BrewEvent[] = [];

  brew.brewing = live && pressed && brew.smashedMs === 0;
  if (live && pressed && !brew.holding) {
    brew.inputs += 1;
    brew.holding = true;
  }
  if (!pressed && brew.holding) {
    brew.inputs += 1;
    brew.holding = false;
    // Letting go pours: whatever whole cups are in the pot are banked.
    const cups = Math.floor(brew.pot);
    if (cups > 0 && brew.smashedMs === 0) {
      brew.score += cups;
      brew.pourMs = POUR_MS;
      events.push({ kind: "poured", cups });
    }
    brew.pot = 0;
  }
  if (brew.brewing) brew.pot = Math.min(MAX_POT, brew.pot + dtMs / MS_PER_CUP);

  if (brew.phaseMs >= brew.phaseFor) {
    brew.phaseMs = 0;
    if (brew.natsumi === "gone") {
      brew.natsumi = "coming";
      brew.phaseFor = APPROACH_MS;
    } else if (brew.natsumi === "coming") {
      brew.natsumi = "over";
      brew.phaseFor = OVER_MS;
      // She arrives. A pot on the go is a pot on the floor.
      if (brew.brewing) {
        brew.smashedMs = SMASHED_MS;
        brew.pot = 0;
        events.push({ kind: "smashed" });
      }
    } else if (brew.natsumi === "over") {
      brew.natsumi = "leaving";
      brew.phaseFor = LEAVING_MS;
    } else {
      brew.natsumi = "gone";
      brew.phaseFor = between(GONE_MS, rng);
    }
  }

  return { brew, events };
};
