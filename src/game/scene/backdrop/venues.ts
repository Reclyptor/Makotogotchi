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
import { composeBackdrop, GLASS, RUG, skylineAt, type BackdropKey } from "./compose";
import type { RoomTheme } from "./theme";

export type SkyRect = { x: number; y: number; w: number; h: number };

export type VenueSpec = {
  id: VenueId;
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
  compose: (key: BackdropKey) => Uint8ClampedArray;
};

export const HOME: VenueSpec = {
  id: "home",
  sky: GLASS,
  horizonAt: skylineAt,
  span: { left: RUG.x, right: RUG.x + RUG.w },
  decor: true,
  glassPane: true,
  compose: composeBackdrop,
};

/** Scenes land here as they are drawn (§22.7 B6/B7). */
export const VENUES: Partial<Record<VenueId, VenueSpec>> = {
  home: HOME,
};

export const venueSpec = (id: string): VenueSpec => VENUES[id as VenueId] ?? HOME;
