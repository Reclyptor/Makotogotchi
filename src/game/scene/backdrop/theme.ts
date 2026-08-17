// Room palettes (SPEC §22.5). Every colour the backdrop draws comes from a
// theme ramp — the renderer holds no literals — and every ramp is hue
// shifted rather than value-slid: the room's shadows drift cool and its
// lights drift warm, which is what keeps a handful of purples from reading
// as grey.

export type RGB = readonly [number, number, number];

export type RoomTheme = {
  id: string;
  label: string;
  /** Wall ramp, darkest (far from the window) to lightest (beside it). */
  wall: readonly [RGB, RGB, RGB];
  /** The faint vertical wallpaper stripe, drawn over the wall ramp. */
  stripe: RGB;
  rail: { body: RGB; highlight: RGB };
  wainscot: { panel: RGB; groove: RGB; highlight: RGB; base: RGB };
  /** Floor ramp, back (shadowed) to front (lit). */
  floor: readonly [RGB, RGB, RGB];
  seam: RGB;
  /** The pool of daylight the window throws across the boards. */
  sunPool: RGB;
  /** The same pool after dark, when only the room's own lights remain. */
  moonPool: RGB;
  rug: { border: RGB; field: RGB; motif: RGB; fringe: RGB };
  frame: { dark: RGB; mid: RGB; light: RGB };
  /** What stands beyond the glass, drawn as a silhouette band (§22.4). */
  outside: "town" | "forest" | "sea";
};

// The default room: a cool purple interior with warm wood and a dusty rose
// rug, so the pet's grey reads against it and the aurora UI around the
// canvas feels like the same world.
export const COZY: RoomTheme = {
  id: "cozy",
  label: "Cozy Room",
  wall: [
    [28, 22, 38],
    [45, 36, 62],
    [72, 58, 96],
  ],
  stripe: [58, 47, 79],
  rail: { body: [74, 58, 82], highlight: [107, 84, 112] },
  wainscot: { panel: [56, 44, 71], groove: [42, 32, 56], highlight: [77, 61, 92], base: [36, 28, 48] },
  floor: [
    [58, 46, 63],
    [70, 55, 75],
    [82, 65, 90],
  ],
  seam: [45, 36, 52],
  sunPool: [122, 98, 96],
  moonPool: [74, 66, 96],
  rug: { border: [122, 74, 106], field: [91, 58, 86], motif: [143, 90, 122], fringe: [163, 118, 140] },
  frame: { dark: [74, 56, 40], mid: [106, 82, 56], light: [138, 109, 74] },
  outside: "town",
};

// A log cabin: warm browns throughout, pines beyond the glass. The rug's
// rust and the wood's amber are the same ramp family, so the room reads warm
// even at midnight.
export const CABIN: RoomTheme = {
  id: "cabin",
  label: "Log Cabin",
  wall: [
    [38, 28, 22],
    [60, 45, 32],
    [86, 64, 45],
  ],
  stripe: [72, 54, 38],
  rail: { body: [66, 48, 33], highlight: [100, 74, 51] },
  wainscot: { panel: [56, 41, 28], groove: [39, 28, 20], highlight: [82, 60, 41], base: [35, 25, 18] },
  floor: [
    [58, 43, 31],
    [74, 55, 39],
    [92, 69, 49],
  ],
  seam: [43, 32, 23],
  sunPool: [142, 112, 76],
  moonPool: [74, 68, 84],
  rug: { border: [124, 68, 49], field: [93, 51, 41], motif: [158, 94, 61], fringe: [178, 134, 98] },
  frame: { dark: [60, 43, 29], mid: [88, 64, 41], light: [118, 88, 57] },
  outside: "forest",
};

// A room by the water: cool blues, driftwood boards, painted frames, and a
// horizon of sea. The warm light pool is what keeps it from going cold.
export const SEASIDE: RoomTheme = {
  id: "seaside",
  label: "Seaside Room",
  wall: [
    [34, 46, 57],
    [51, 69, 81],
    [73, 97, 111],
  ],
  stripe: [65, 87, 101],
  rail: { body: [59, 81, 93], highlight: [93, 121, 133] },
  wainscot: { panel: [49, 69, 81], groove: [35, 51, 61], highlight: [73, 99, 113], base: [33, 47, 57] },
  floor: [
    [63, 75, 81],
    [81, 95, 101],
    [101, 117, 123],
  ],
  seam: [49, 59, 65],
  sunPool: [150, 136, 106],
  moonPool: [79, 93, 111],
  rug: { border: [71, 121, 121], field: [49, 93, 97], motif: [105, 159, 151], fringe: [151, 191, 181] },
  frame: { dark: [71, 79, 81], mid: [105, 115, 117], light: [141, 153, 153] },
  outside: "sea",
};

export const THEMES: Record<string, RoomTheme> = { cozy: COZY, cabin: CABIN, seaside: SEASIDE };

/** Theme ids in the order the shop lists them. */
export const THEME_IDS = ["cozy", "cabin", "seaside"] as const;

export const themeFor = (id: string | null | undefined): RoomTheme => THEMES[id ?? "cozy"] ?? COZY;

export const hex = (color: RGB): string =>
  `#${color.map((channel) => Math.max(0, Math.min(255, Math.round(channel))).toString(16).padStart(2, "0")).join("")}`;

export const mix = (a: RGB, b: RGB, t: number): RGB => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];

export const scale = (color: RGB, factor: number): RGB => [color[0] * factor, color[1] * factor, color[2] * factor];
