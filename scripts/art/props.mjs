// The lore games' props (SPEC §13.3.3), as editable letter grids. Edit a
// grid, run `npm run art:props`, then `npm run atlas` to repack the sheet.
//
// Prop vocabulary, not character vocabulary: 1px black outline, flat fills,
// no shading — the same treatment as the bowl, the rock and the sock.

import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { PNG } = require("pngjs");

const OUT = new URL("../../art/games/", import.meta.url);

const PALETTE = {
  B: [0,0,0, 255], // outline
  D: [104,104,118, 255], // machine body
  L: [214,218,228, 255], // glass
  R: [214,64,64, 255], // power light
  C: [110,64,40, 255], // coffee
  G: [150,150,162, 255], // hot plate metal
  W: [235,235,240, 255], // porcelain and steam
};

const coffeeMachine = `
.BBBBBBBBBB...........
.BDDDDDDDDB...........
.BDLLLLLLDB...........
.BDLLLLLLDBBBBBBBBB...
.BDLLLLLLDDDDDDDDDDB..
.BDDDDDDDDBBBBBBBBBB..
.BDRDDDDDDB...BBBB....
.BDDDDDDDDB..BCCCCB...
.BDDDDDDDDB...BCCB....
.BDDDDDDDDB....BB.....
.BDDDDDDDDB...........
.BDDDDDDDDB..BBBBBBB..
.BDDDDDDDDB.BLLLLLLLB.
.BDDDDDDDDB.BLLLLLLLBB
.BDDDDDDDDB.BLLLLLLLBB
.BDDDDDDDDB.BLLLLLLLBB
.BBBBBBBBBB.BLLLLLLLB.
............BLLLLLLLB.
............BBLLLLLBB.
.............BBBBBBB..
..........BBBBBBBBBBB.
..........BGGGGGGGGGB.
..........BBBBBBBBBBB.
`;

const coffeeSmashed = `
......................
......................
..BBBBBBBB............
..BDDDDDDB............
.BDDDDDDDDB...........
.BDRDDDDDBB...........
.BDDDDDDB.............
.BDDDDDDB......BB.....
.BDDDDDDB.....BLLB....
.BDDDDDDB.B..BLB.BB...
.BBBBBBBB.LB.BLB..B...
.......B..BLBBLLB.....
......BLB..BLBBLB.....
.....BLLB...BB.BB.....
....BCCCB.............
...BCCCCCB...BB..BB...
..BCCCCCCCB.BCCBBCCB..
..BBBBBBBBB.BBBBBBBB..
......................
..........BBBBBBBBBBB.
..........BGGGGGGGGGB.
..........BBBBBBBBBBB.
`;

const coffeeMug = `
.BBBBBBB..
BWWWWWWWB.
BWCCCCCWBB
BWCCCCCWBB
BWWWWWWWBB
BWWWWWWWB.
.BWWWWWB..
..BBBBB...
`;

const partyPlate = `
..........
..BBBBBB..
.BCCCCCCB.
BCCCCCCCCB
.BCCCCCCB.
BWWWWWWWWB
BWWWWWWWWB
.BBBBBBBB.
`;

const steam1 = `
.W.
W..
.W.
..W
.W.
`;

const steam2 = `
.W.
..W
.W.
W..
.W.
`;

const write = (name, grid) => {
  const rows = grid.trim().split("\n");
  const width = rows[0].length;
  for (const [index, row] of rows.entries()) {
    if (row.length !== width) throw new Error(`${name}: row ${index} is ${row.length} wide, expected ${width}`);
  }
  const png = new PNG({ width, height: rows.length });
  rows.forEach((row, y) => {
    for (let x = 0; x < width; x += 1) {
      const letter = row[x];
      const rgba = letter === "." ? [0, 0, 0, 0] : PALETTE[letter];
      if (!rgba) throw new Error(`${name}: unknown palette letter "${letter}" at ${x},${y}`);
      const i = (y * width + x) * 4;
      [png.data[i], png.data[i + 1], png.data[i + 2], png.data[i + 3]] = rgba;
    }
  });
  mkdirSync(OUT, { recursive: true });
  writeFileSync(new URL(`${name}@1x.png`, OUT), PNG.sync.write(png));
  return `${name} ${width}x${rows.length}`;
};

const frames = [
  ["coffeeMachine", coffeeMachine],
  ["coffeeSmashed", coffeeSmashed],
  ["coffeeMug", coffeeMug],
  ["partyPlate", partyPlate],
  ["steam1", steam1],
  ["steam2", steam2],
];
console.log(frames.map(([name, grid]) => write(name, grid)).join("\n"));
console.log(`wrote ${frames.length} frames to ${fileURLToPath(OUT)} — re-run \`npm run atlas\` to repack`);
