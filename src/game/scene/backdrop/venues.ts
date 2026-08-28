// The venue registry (SPEC §22.8): each place the pet can spend a day
// supplies its own composed architecture, its patch of live sky, its ground
// span, and whether the room's communal decor belongs there. The room of
// §22.3 is the `home` venue rather than a special case — its spec wraps the
// existing composer untouched, which is what keeps the refactor
// pixel-identical.
//
// A venue the build cannot draw yet — or an id from a newer deploy — falls
// back to home rather than to a blank canvas.

import type { VenueId } from "@/sim/atmosphere";
import { composeBackdrop, GLASS, ROOM_WIDTH, RUG, skylineAt, type BackdropKey } from "./compose";
import {
  BEACH_HORIZON,
  beachHorizonAt,
  BLOSSOM_HORIZON,
  blossomHorizonAt,
  composeBeach,
  composeBlossom,
  composeForest,
  composeGarden,
  composeMeadow,
  composeMountain,
  composePond,
  composeShrine,
  FOREST_HORIZON,
  forestHorizonAt,
  GARDEN_HORIZON,
  gardenHorizonAt,
  MEADOW_HORIZON,
  meadowHorizonAt,
  MOUNTAIN_HORIZON,
  mountainHorizonAt,
  OUTDOOR_SPAN,
  POND_HORIZON,
  pondHorizonAt,
  renderBeachLive,
  renderBlossomLive,
  renderPondLive,
  SHRINE_HORIZON,
  shrineHorizonAt,
} from "./outdoors";
import type { RoomTheme } from "./theme";
import type { SceneContext } from "../../engine/digest";

export type SkyRect = { x: number; y: number; w: number; h: number };

export type VenueSpec = {
  id: VenueId;
  /** How the caption names the place: "Makoto is at ~ today" (SPEC §22.8). */
  label: string;
  /** Where the live sky draws and clips — home's is the window pane. */
  sky: SkyRect;
  /** Silhouette height above the sky's bottom in a column: where the sun
   *  rises from and sets behind (SPEC §22.2). */
  horizonAt: (theme: RoomTheme, sx: number) => number;
  /** The ground span the pet wanders, before its own size insets it
   *  (SPEC §22.3's rug rule, generalized). */
  span: { left: number; right: number };
  /** Communal decor and grand furniture draw at home only — a kotatsu in a
   *  meadow is a joke, not a place (SPEC §22.8). */
  decor: boolean;
  /** Rain droplets cling to glass; outdoor skies have none to cling to. */
  glassPane: boolean;
  /** Live weather element counts scale by this: the window pane is a sliver
   *  of sky, the open air is all of it. Home stays exactly 1. */
  weatherDensity: number;
  compose: (key: BackdropKey) => Uint8ClampedArray;
  /** A venue's own living touch, drawn each frame over the composed scene —
   *  the beach's surf, the pond's koi. Passed 0 under reduced motion, which
   *  holds it still, and the day's key so a touch can be seasonal: the
   *  park's petals fall in spring and nowhere else. */
  renderLive?: (ctx: SceneContext, nowMs: number, key: BackdropKey) => void;
};

export const HOME: VenueSpec = {
  id: "home",
  label: "home",
  sky: GLASS,
  horizonAt: skylineAt,
  span: { left: RUG.x, right: RUG.x + RUG.w },
  decor: true,
  glassPane: true,
  weatherDensity: 1,
  compose: composeBackdrop,
};

/**
 * An outdoor venue. Each one sets its own `horizonY` — the roofed forest and
 * the almost-all-sky meadow are different *places* rather than different
 * tints precisely because their eye lines are nowhere near each other
 * (SPEC §22.8), and the sky the weather falls through has to follow.
 *
 * Weather density scales with the sky it has to fill: three clouds in the
 * meadow's enormous sky is a clear day, and the same three in the forest's
 * torn canopy gap is an overcast one.
 */
const outdoor = (
  id: VenueId,
  label: string,
  horizonY: number,
  horizonAt: (sx: number) => number,
  compose: VenueSpec["compose"],
): VenueSpec => ({
  id,
  label,
  sky: { x: 0, y: 0, w: ROOM_WIDTH, h: horizonY },
  // Outdoor horizons belong to the venue, not the room's theme.
  horizonAt: (_theme: RoomTheme, sx: number) => horizonAt(sx),
  span: OUTDOOR_SPAN,
  decor: false,
  glassPane: false,
  weatherDensity: Math.max(1.5, (horizonY / 92) * 3),
  compose,
});

/** Scenes land here as they are drawn (§22.7 B6/B7). */
export const VENUES: Partial<Record<VenueId, VenueSpec>> = {
  home: HOME,
  garden: outdoor("garden", "the garden", GARDEN_HORIZON, gardenHorizonAt, composeGarden),
  meadow: outdoor("meadow", "the meadow", MEADOW_HORIZON, meadowHorizonAt, composeMeadow),
  beach: { ...outdoor("beach", "the beach", BEACH_HORIZON, beachHorizonAt, composeBeach), renderLive: renderBeachLive },
  forest: outdoor("forest", "the forest clearing", FOREST_HORIZON, forestHorizonAt, composeForest),
  blossom: {
    ...outdoor("blossom", "the blossom park", BLOSSOM_HORIZON, blossomHorizonAt, composeBlossom),
    renderLive: renderBlossomLive,
  },
  pond: { ...outdoor("pond", "the koi pond", POND_HORIZON, pondHorizonAt, composePond), renderLive: renderPondLive },
  shrine: outdoor("shrine", "the shrine path", SHRINE_HORIZON, shrineHorizonAt, composeShrine),
  mountain: outdoor("mountain", "the mountain", MOUNTAIN_HORIZON, mountainHorizonAt, composeMountain),
};

/** The venues every room owns from the start (SPEC §22.8), re-exported from
 *  the sim so the scenes and the server read one list — funded grand items
 *  join through roomState as their scenes land (§22.7 B7, B8). */
export { FREE_VENUES } from "@/sim/atmosphere";

export const venueSpec = (id: string): VenueSpec => VENUES[id as VenueId] ?? HOME;
