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

export const THEMES: Record<string, RoomTheme> = { cozy: COZY };

export const themeFor = (id: string | null | undefined): RoomTheme => THEMES[id ?? "cozy"] ?? COZY;

export const hex = (color: RGB): string =>
  `#${color.map((channel) => Math.max(0, Math.min(255, Math.round(channel))).toString(16).padStart(2, "0")).join("")}`;

export const mix = (a: RGB, b: RGB, t: number): RGB => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];

export const scale = (color: RGB, factor: number): RGB => [color[0] * factor, color[1] * factor, color[2] * factor];
