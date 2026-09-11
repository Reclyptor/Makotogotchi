// A 3×5 pixel font for the plaques on the family wall (SPEC §22.10). The
// room's 7px face needs 42 pixels for "MAKOTO"; an engraved plate under a
// 20-pixel frame has nowhere near that. Capitals, digits, space, hyphen and
// underscore — the pet-name alphabet of §8.5 — with diacritics folded away
// and any other letter shown as a hollow box rather than silently dropped.

import type { SceneContext } from "./digest";

/** Advance per character: three columns of glyph and one of space. */
export const TINY_PITCH = 4;
export const TINY_HEIGHT = 5;

const GLYPHS: Readonly<Record<string, readonly string[]>> = {
  A: ["010", "101", "111", "101", "101"],
  B: ["110", "101", "110", "101", "110"],
  C: ["011", "100", "100", "100", "011"],
  D: ["110", "101", "101", "101", "110"],
  E: ["111", "100", "110", "100", "111"],
  F: ["111", "100", "110", "100", "100"],
  G: ["011", "100", "101", "101", "011"],
  H: ["101", "101", "111", "101", "101"],
  I: ["111", "010", "010", "010", "111"],
  J: ["001", "001", "001", "101", "010"],
  K: ["101", "101", "110", "101", "101"],
  L: ["100", "100", "100", "100", "111"],
  M: ["101", "111", "111", "101", "101"],
  N: ["110", "101", "101", "101", "101"],
  O: ["010", "101", "101", "101", "010"],
  P: ["110", "101", "110", "100", "100"],
  Q: ["010", "101", "101", "111", "011"],
  R: ["110", "101", "110", "101", "101"],
  S: ["011", "100", "010", "001", "110"],
  T: ["111", "010", "010", "010", "010"],
  U: ["101", "101", "101", "101", "111"],
  V: ["101", "101", "101", "101", "010"],
  W: ["101", "101", "111", "111", "101"],
  X: ["101", "101", "010", "101", "101"],
  Y: ["101", "101", "010", "010", "010"],
  Z: ["111", "001", "010", "100", "111"],
  "0": ["111", "101", "101", "101", "111"],
  "1": ["010", "110", "010", "010", "111"],
  "2": ["110", "001", "010", "100", "111"],
  "3": ["110", "001", "010", "001", "110"],
  "4": ["101", "101", "111", "001", "001"],
  "5": ["111", "100", "110", "001", "110"],
  "6": ["011", "100", "110", "101", "010"],
  "7": ["111", "001", "010", "010", "010"],
  "8": ["010", "101", "010", "101", "010"],
  "9": ["010", "101", "011", "001", "110"],
  " ": ["000", "000", "000", "000", "000"],
  "-": ["000", "000", "111", "000", "000"],
  _: ["000", "000", "000", "000", "111"],
};

/** What a letter the font has no glyph for looks like. */
const UNKNOWN: readonly string[] = ["111", "101", "101", "101", "111"];

/**
 * The characters the font will actually draw for `text`: capitals with their
 * accents removed, one entry per character, so width and drawing agree.
 */
export const tinyGlyphs = (text: string): string[] =>
  [...text.normalize("NFD").replace(/\p{M}/gu, "").toUpperCase()];

export const tinyWidth = (text: string): number => {
  const glyphs = tinyGlyphs(text);
  return glyphs.length === 0 ? 0 : glyphs.length * TINY_PITCH - 1;
};

/** Draws `text` with its top-left corner at `x, y`, in `colour`. */
export const drawTiny = (ctx: SceneContext, text: string, x: number, y: number, colour: string): void => {
  ctx.fillStyle = colour;
  tinyGlyphs(text).forEach((character, index) => {
    const glyph = GLYPHS[character] ?? UNKNOWN;
    glyph.forEach((row, gy) => {
      for (let gx = 0; gx < row.length; gx++) {
        if (row[gx] === "1") ctx.fillRect(x + index * TINY_PITCH + gx, y + gy, 1, 1);
      }
    });
  });
};
