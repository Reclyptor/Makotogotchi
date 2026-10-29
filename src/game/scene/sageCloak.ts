// The Sage's cloak (SPEC §21.9): a long red coat worn open down a narrow front
// slit, with a skirt that falls to the floor behind the legs so the open front
// does not read as trousers, and black flame tongues as the skirt's hem
// pattern, one every four columns. The paws stay bare under the cuffs for the
// cane's grip. A holiday's costume replaces it (room.ts).

import type { Garment } from "./garment";

export const SAGE_CLOAK: Garment = {
  ramp: {
    cloth: [176, 44, 36],
    collar: [224, 96, 56],
    trim: [104, 20, 24],
    line: [0, 0, 0],
  },
  // Five columns wide in every facing: a column left of centre on the side
  // view, where the beard hangs, centred when the body faces front.
  slit: { side: [7, 11], front: [8, 12] },
  cuffs: true,
  tails: false,
  skirt: true,
  // A one-wide tip two rows tall on a two-wide base, rising from the hem line.
  hemPattern: ["..k.", "..k.", ".kk."],
  seatedHemLift: 1,
};
