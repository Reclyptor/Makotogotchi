// New Year's Day (SPEC §22.11): Makoto's room for the first of the year, and
// the party he spends it dressed for. The props are art/holiday sprites; the
// art itself and the sheet it is packed onto come from `npm run atlas`.
//
// Where things stand follows Halloween's rule: his centre wanders x 108–152
// and his feet reach the rug's span exactly (room.ts wanderBand), so the floor
// props keep to the front corners outside the rug and to the back strip
// against the wainscot, and the wall props stay above his ears. Everything on
// the floor in front of the rug is drawn in front of him, and everything
// against the back wall behind him.
//
// The window has no props of its own: from 23:00 on New Year's Eve until
// 01:00 the pane draws fireworks in `window.fireworks`, and the moon is tinted
// champagne.

import type { RGB, RoomTheme } from "../backdrop/theme";
import type { Garment } from "../garment";
import type { HolidayScene } from "./scene";

// Midnight blues for the walls, hue shifted like the rest (§22.5): the wall's
// shadows sink to indigo and its light lifts to periwinkle, so the pet's grey
// and the Sage's white keep reading against it. The gold is everywhere the
// wood used to be — the rail, the window's frame, the rug — so the room reads
// midnight-and-gold without a single prop. The floor is a cool slate, a half
// step warmer than the wall, so the rug's gold and the floor's gold pool are
// the only warm things underfoot.
export const NEW_YEAR_THEME: RoomTheme = {
  id: "newYear",
  label: "New Year's Party",
  wall: [
    [14, 18, 54],
    [24, 32, 88],
    [44, 58, 130],
  ],
  stripe: [32, 42, 100],
  rail: { body: [120, 92, 44], highlight: [184, 150, 78] },
  wainscot: { panel: [22, 26, 70], groove: [12, 14, 46], highlight: [40, 48, 102], base: [10, 12, 38] },
  floor: [
    [38, 34, 64],
    [52, 46, 84],
    [68, 62, 106],
  ],
  seam: [28, 24, 48],
  sunPool: [172, 142, 92],
  moonPool: [72, 80, 144],
  rug: { border: [176, 138, 62], field: [122, 94, 42], motif: [220, 184, 96], fringe: [238, 216, 152] },
  frame: { dark: [78, 60, 30], mid: [128, 98, 46], light: [184, 150, 78] },
  outside: "town",
};

// The burst palette, in the order the window cycles it: gold first, since a
// single frozen burst under reduced motion takes the first entry. Every
// colour reads against the night sky's darkest band ([11, 16, 48]).
export const NEW_YEAR_FIREWORKS: readonly RGB[] = [
  [255, 214, 110], // gold
  [255, 248, 230], // white
  [130, 204, 255], // ice blue
  [255, 128, 160], // rose
  [190, 150, 255], // violet
];

// The crown's gold, shared with the wizard's band.
const GOLD: RGB = [232, 199, 106];

// A tuxedo, worn (SPEC §22.12): midnight cloth over the body and the arms, a
// gold satin shawl collar on the neckline with a black bow tie on it, gold
// lapels in a V from the shoulders to the waist with the white shirt front
// between them, a gold button under the V's point, white shirt cuffs over
// bare paws, and no tails: a jacket ends at the hem and the feet show.
//
// The front is a pattern anchored at the neckline, one string per row from
// the collar row down, indexed by body column (the centre is column 10):
// t lapels and the button, s the shirt, k the bow tie, . whatever the base
// rules painted. The V is wide on purpose: the Sage's beard runs from
// seventeen cells at the moustache to one at its tip, so gold shows either
// side of it on a front view and the shirt shows where the wisp thins; a side
// view shows the V's right arm and the shirt beside the beard. The same table
// in every facing, with the near arm's cuff and paw winning where the arm
// crosses it, which is how an arm in front of a jacket reads.
export const NEW_YEAR_TUX: Garment = {
  ramp: {
    cloth: [30, 38, 104],
    collar: GOLD,
    trim: GOLD,
    line: [0, 0, 0],
    shirt: [244, 244, 252],
    cuff: [244, 244, 252],
  },
  slit: null,
  cuffs: true,
  tails: false,
  hemPattern: null,
  frontPattern: {
    front: {
      rows: [
        "........kkkkk........",
        ".....tssssssssst.....",
        ".....tssssssssst.....",
        "......tssssssst......",
        ".......tssssst.......",
        ".......tssssst.......",
        "........tssst........",
        ".........t.t.........",
        "..........t..........",
      ],
    },
  },
};

export const NEW_YEAR_SCENE: HolidayScene = {
  id: "newYear",
  theme: NEW_YEAR_THEME,
  props: [
    // The left wall, the one without the window: streamers curl down the
    // corner, and the bunting is strung from beside them to the window's
    // frame, in the band above his ears. There's no room above the ears for
    // a lettered banner at atlas scale; the bunting is the banner.
    { frame: "newYearStreamers", x: 16, y: 96, layer: "behind" },
    { frame: "newYearBunting", x: 88, y: 31, layer: "behind" },
    // The clock in the sliver of wall right of the window, outside where he
    // walks, so it can hang at a wall clock's height.
    { frame: "newYearClock", x: 238, y: 52, layer: "behind" },
    // The toast on the sill, in front of the glass, where the lamp's light
    // used to come from.
    { frame: "newYearToast", x: 166, y: 66, layer: "behind" },
    // The back floor strip, against the wainscot: confetti left, the
    // balloons in the right corner, both behind him when he walks past.
    { frame: "newYearConfetti", x: 30, y: 160, layer: "behind" },
    { frame: "newYearBalloons", x: 237, y: 160, layer: "behind" },
    // The front corners, outside the rug: the popper just fired on the left,
    // and more of what it threw on the right, nearer the viewer than he ever
    // stands.
    { frame: "newYearPopper", x: 22, y: 198, layer: "front" },
    { frame: "newYearConfetti", x: 232, y: 199, layer: "front" },
  ],
  costume: { hat: "newYearHat", robe: NEW_YEAR_TUX, staff: "newYearSparkler" },
  // A champagne moon, no bats, and fireworks around midnight.
  window: { bats: false, moon: [250, 236, 196], fireworks: NEW_YEAR_FIREWORKS },
};
