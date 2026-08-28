// The ancient code's eight seconds (SPEC §26.4).
//
// The property that matters most here is not what it looks like but that it
// draws the *same* thing when asked twice for the same instant: the frame
// digest replays `paint` once to hash and once to draw (SPEC §10.1), so a
// spectacle that advanced or re-rolled mid-frame would hash differently every
// frame and repaint the whole room continuously.

import { describe, expect, it } from "vitest";
import { Spectacle, SPECTACLE_MS } from "./party";
import { DigestContext } from "../engine/digest";

/** What one frame of the spectacle hashes to, sky and confetti together. */
const frameHash = (spectacle: Spectacle, nowMs: number): number => {
  const digest = new DigestContext();
  digest.reset();
  spectacle.renderBehind(digest, nowMs);
  spectacle.renderFront(digest, nowMs);
  return digest.value;
};

const EMPTY = frameHash(new Spectacle(), 0);

const started = (mood: "party" | "stars", atMs = 1000): Spectacle => {
  const spectacle = new Spectacle();
  spectacle.start(mood, atMs);
  return spectacle;
};

/** Frames sampled across a whole run, from just after start to just before end. */
const SAMPLES = [10, 250, 500, 900, 1500, 2500, 4000, 5500, 6800, 7500, 7900];

describe("the spectacle (SPEC §26.4)", () => {
  it("draws nothing before it is started", () => {
    const spectacle = new Spectacle();
    expect(spectacle.active).toBe(false);
    expect(frameHash(spectacle, 5000)).toBe(EMPTY);
  });

  it("draws the same frame twice for the same instant — the digest depends on it", () => {
    for (const mood of ["party", "stars"] as const) {
      const spectacle = started(mood);
      for (const offset of SAMPLES) {
        expect(frameHash(spectacle, 1000 + offset)).toBe(frameHash(spectacle, 1000 + offset));
      }
    }
  });

  it("actually draws something across the run, in both moods", () => {
    for (const mood of ["party", "stars"] as const) {
      const spectacle = started(mood);
      const drawn = SAMPLES.filter((offset) => frameHash(spectacle, 1000 + offset) !== EMPTY);
      // Not every sampled instant need draw — the wash ramps from nothing and
      // confetti is staggered — but the bulk of the run must.
      expect(drawn.length).toBeGreaterThan(SAMPLES.length / 2);
    }
  });

  it("moves — consecutive frames differ while it is running", () => {
    for (const mood of ["party", "stars"] as const) {
      const spectacle = started(mood);
      const frames = SAMPLES.map((offset) => frameHash(spectacle, 1000 + offset));
      expect(new Set(frames).size).toBeGreaterThan(SAMPLES.length / 2);
    }
  });

  it("draws nothing once the run has elapsed", () => {
    const spectacle = started("stars");
    expect(frameHash(spectacle, 1000 + SPECTACLE_MS + 1)).toBe(EMPTY);
    expect(frameHash(spectacle, 1000 + SPECTACLE_MS * 3)).toBe(EMPTY);
  });

  it("draws nothing for an instant before it began", () => {
    // The loop's clock is monotonic, but a spectacle armed from one timebase
    // and drawn from another must fail closed rather than paint garbage.
    const spectacle = started("party", 5000);
    expect(frameHash(spectacle, 4000)).toBe(EMPTY);
  });

  it("retires itself once the run elapses, and only then", () => {
    const spectacle = started("party");
    spectacle.advance(1000 + SPECTACLE_MS - 1);
    expect(spectacle.active).toBe(true);
    spectacle.advance(1000 + SPECTACLE_MS + 1);
    expect(spectacle.active).toBe(false);
  });

  it("hands the night dim over only for a live star run", () => {
    const party = started("party");
    expect(party.supersedesNightDim).toBe(false);

    const stars = started("stars");
    expect(stars.supersedesNightDim).toBe(true);
    stars.advance(1000 + SPECTACLE_MS + 1);
    expect(stars.supersedesNightDim).toBe(false);
  });

  it("keeps confetti out of the sky pass and the wash out of the front", () => {
    // The layering is the whole reason there are two passes: the sky sinks the
    // room behind the pet, confetti falls in front of it.
    const stars = started("stars");
    const front = new DigestContext();
    front.reset();
    stars.renderFront(front, 3000);
    expect(front.value).toBe(EMPTY);

    const party = started("party");
    const behind = new DigestContext();
    behind.reset();
    party.renderBehind(behind, 3000);
    expect(behind.value).not.toBe(EMPTY);
  });

  it("restarts rather than stacking when re-entered mid-run", () => {
    const spectacle = started("party", 1000);
    spectacle.start("stars", 4000);
    expect(spectacle.currentMood).toBe("stars");
    // The clock now runs from the second entry: an instant that was inside the
    // first run but before the second is empty again.
    expect(frameHash(spectacle, 3500)).toBe(EMPTY);
    expect(spectacle.active).toBe(true);
    spectacle.advance(4000 + SPECTACLE_MS - 1);
    expect(spectacle.active).toBe(true);
  });

  it("does not fall identically twice — successive runs are rolled fresh", () => {
    const spectacle = new Spectacle();
    spectacle.start("party", 0);
    const first = SAMPLES.map((offset) => frameHash(spectacle, offset));
    spectacle.start("party", 0);
    const second = SAMPLES.map((offset) => frameHash(spectacle, offset));
    expect(first).not.toEqual(second);
  });
});
