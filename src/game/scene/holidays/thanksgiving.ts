// Thanksgiving (SPEC §22.11): Makoto's room for the fourth Thursday of
// November, and the pilgrim he spends it as. The props, the hat and the staff
// are art sprites; the art itself and the sheet it is packed onto come from
// `npm run atlas`. The cape is a garment (SPEC §22.12), drawn from each pose's
// own silhouette rather than pasted on.
//
// Placement follows Halloween's rule: his centre wanders x 108–152 and his
// feet reach the rug's span exactly (room.ts wanderBand), so the floor props
// keep to the front corners outside the rug and to the back strip against the
// wainscot, and the wall props stay above his ears. The front corners are
// drawn in front of him, the back strip and the walls behind.

import type { RoomTheme } from "../backdrop/theme";
import type { Garment } from "../garment";
import type { HolidayScene } from "./scene";

// A harvest room: cranberry walls that go plum in shadow and amber beside the
// window, chocolate wainscot, golden-oak boards and a braided pumpkin rug.
// Three browns kept apart by hue rather than value (§22.5), so the pet's grey
// and the Sage's white read against all of them, and the costume's cranberry
// separates from the wall by saturation and its outline.
export const THANKSGIVING_THEME: RoomTheme = {
  id: "thanksgiving",
  label: "Harvest Table",
  wall: [
    [50, 20, 30],
    [94, 40, 40],
    [146, 82, 50],
  ],
  stripe: [106, 50, 46],
  rail: { body: [118, 70, 40], highlight: [172, 118, 66] },
  wainscot: { panel: [84, 46, 30], groove: [58, 30, 22], highlight: [116, 70, 42], base: [50, 26, 20] },
  floor: [
    [96, 64, 36],
    [122, 84, 46],
    [150, 108, 58],
  ],
  seam: [72, 46, 28],
  sunPool: [206, 156, 88],
  moonPool: [100, 72, 84],
  rug: { border: [178, 100, 38], field: [130, 64, 34], motif: [216, 148, 54], fringe: [228, 184, 112] },
  frame: { dark: [72, 42, 30], mid: [112, 70, 42], light: [154, 108, 62] },
  outside: "forest",
};

// The hat buckle's brass, which the cape's hem, cuffs and seam share so the
// costume reads as one set.
const GOLD = [232, 199, 106] as const;

// A cranberry cape, closed down the front. The collar band sits under the
// beard, which is the collar as far as anyone sees; the cuffs leave the paws
// bare for the staff; and the last row of cloth is the one-row gold hem the
// pasted cape had. No tails: a short cape ends at the silhouette.
export const PILGRIM_CAPE: Garment = {
  ramp: {
    cloth: [168, 40, 58],
    collar: [214, 92, 96],
    trim: GOLD,
    line: [0, 0, 0],
  },
  slit: null,
  cuffs: true,
  tails: false,
  hemPattern: ["t"],
  // On a seated pose the gold hem sits a row up, clear of the floor.
  seatedHemLift: 1,
  // The clasp seam: one trim column from the collar to the hem down the
  // body's centre, a column left of centre on the side view (where a slit
  // would sit), and closing a few rows above the floor on a pose in the lap
  // so the lap stays plain. A seam is a front pattern of trim that rests on
  // its last row.
  frontPattern: {
    front: { rows: [], rest: "..........t" },
    side: { rows: [], rest: ".........t" },
    sit: { rows: ["..........t", "..........t", "..........t", "..........t"] },
  },
};

export const THANKSGIVING_SCENE: HolidayScene = {
  id: "thanksgiving",
  theme: THANKSGIVING_THEME,
  props: [
    // The top-left corner of the wall: a leaf wreath hung where the cobweb
    // was, clear of the window.
    { frame: "thanksgivingWreath", x: 30, y: 62, layer: "behind" },
    // A leaf garland strung along the ceiling between the wreath and the
    // window frame.
    { frame: "thanksgivingGarland", x: 106, y: 33, layer: "behind" },
    // On the sill, in front of the glass: a beeswax candle, and a pumpkin pie
    // left to cool.
    { frame: "thanksgivingCandle", x: 163, y: 66, layer: "behind", flicker: true },
    { frame: "thanksgivingPie", x: 196, y: 66, layer: "behind" },
    // The back floor strip, against the wainscot: fallen leaves swept to the
    // left, the gourds to the right, both behind him when he walks past.
    { frame: "thanksgivingLeaves", x: 50, y: 155, layer: "behind" },
    { frame: "thanksgivingGourds", x: 222, y: 158, layer: "behind" },
    // The front corners, outside the rug: the cornucopia and the turkey,
    // nearer the viewer than he ever stands.
    { frame: "thanksgivingCornucopia", x: 34, y: 198, layer: "front" },
    { frame: "thanksgivingTurkey", x: 229, y: 198, layer: "front" },
  ],
  costume: { hat: "thanksgivingHat", robe: PILGRIM_CAPE, staff: "thanksgivingStaff" },
  // A harvest moon, and no bats.
  window: { bats: false, moon: [255, 218, 150] },
};
