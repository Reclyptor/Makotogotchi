// The contested-title roster (SPEC §24.1) — pure vocabulary shared by the
// server machinery (src/server/titles.ts) and the client surfaces, the way
// minigames.ts is. No I/O, and the fold never reads any of it: titles are
// derived server-side data, not simulation state.

export const TITLE_IDS = ["night-nurse", "chef", "groundskeeper", "sandman", "cuddler", "wish-granter"] as const;
export type TitleId = (typeof TITLE_IDS)[number];

export const TITLES: Record<TitleId, { label: string; chip: string; description: string }> = {
  "night-nurse": { label: "Night Nurse", chip: "🌙", description: "care between midnight and seven" },
  chef: { label: "Chef", chip: "🍳", description: "favorite-food meals served" },
  groundskeeper: { label: "Groundskeeper", chip: "🧹", description: "dust baths given" },
  sandman: { label: "Sandman", chip: "🎵", description: "lullabies that worked" },
  cuddler: { label: "Cuddler", chip: "🤗", description: "pets and cuddles" },
  "wish-granter": { label: "Wish Granter", chip: "⭐", description: "wishes granted" },
};

/** Night Nurse's window: 0:00 up to (not including) this local hour. */
export const NIGHT_END_HOUR = 7;

export const isTitleId = (value: unknown): value is TitleId =>
  typeof value === "string" && (TITLE_IDS as readonly string[]).includes(value);
