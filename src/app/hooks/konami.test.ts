import { describe, expect, it } from "vitest";
import { KONAMI_SEQUENCE, KonamiMatcher } from "./konami";

/** Feeds keys and returns the index of every press that completed the code. */
const hits = (keys: readonly string[], matcher = new KonamiMatcher()): number[] =>
  keys.flatMap((key, index) => (matcher.push(key) ? [index] : []));

const CODE = [...KONAMI_SEQUENCE];

describe("the ancient code matcher (SPEC §26.1)", () => {
  it("fires on the last key of the sequence, and only then", () => {
    expect(hits(CODE)).toEqual([CODE.length - 1]);
  });

  it("does not fire on a prefix", () => {
    expect(hits(CODE.slice(0, -1))).toEqual([]);
  });

  it("ignores case, so caps lock does not eat the secret", () => {
    expect(hits(["ArrowUp", "ArrowUp", "ArrowDown", "ArrowDown", "ArrowLeft", "ArrowRight", "ArrowLeft", "ArrowRight", "B", "A", "Enter"])).toEqual([10]);
  });

  it("survives a leading repeat — the overlapping-prefix case", () => {
    // ↑↑↑↓↓←→←→BA⏎. An advance-or-reset index fails this: the third ↑ sends
    // it back to zero and the ↓ that follows is then unexpected, so the code
    // never completes. The last eleven keys are the code, so it must fire.
    expect(hits(["arrowup", ...CODE])).toEqual([CODE.length]);
  });

  it("tolerates any amount of junk before the code", () => {
    expect(hits(["x", "arrowdown", "q", "enter", "arrowleft", ...CODE])).toEqual([CODE.length + 4]);
  });

  it("does not fire when a wrong key lands mid-sequence", () => {
    const spoiled = [...CODE.slice(0, 5), "x", ...CODE.slice(5)];
    expect(hits(spoiled)).toEqual([]);
  });

  it("recovers after a spoiled attempt without needing a reset", () => {
    const matcher = new KonamiMatcher();
    expect(hits([...CODE.slice(0, 6), "x"], matcher)).toEqual([]);
    expect(hits(CODE, matcher)).toEqual([CODE.length - 1]);
  });

  it("does not re-fire on trailing keys", () => {
    expect(hits([...CODE, "enter", "enter", "a"])).toEqual([CODE.length - 1]);
  });

  it("fires again for a second full entry", () => {
    expect(hits([...CODE, ...CODE])).toEqual([CODE.length - 1, CODE.length * 2 - 1]);
  });

  it("forgets a half-entered sequence when reset", () => {
    const matcher = new KonamiMatcher();
    hits(CODE.slice(0, -1), matcher);
    matcher.reset();
    // The window is empty, so the lone Enter that would have completed it
    // does nothing — which is what disarming mid-sequence has to mean.
    expect(matcher.push("enter")).toBe(false);
  });

  it("is the arcade sequence, in order", () => {
    expect(CODE).toEqual([
      "arrowup",
      "arrowup",
      "arrowdown",
      "arrowdown",
      "arrowleft",
      "arrowright",
      "arrowleft",
      "arrowright",
      "b",
      "a",
      "enter",
    ]);
  });
});
