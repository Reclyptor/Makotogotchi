// The contract between the room and the art of the second meditation day's
// aura (SPEC §21.9). The room decides when it is drawn; a style, held in
// scene/aura.ts, decides what it looks like. Styles import this file and never
// room.ts.

import type { Atlas } from "../engine/atlas";
import type { SceneContext } from "../engine/digest";
import type { FrameName } from "../atlas.generated";

/** The line the pet stands on, in room pixels: the foot anchor every frame is drawn from. */
export const PET_Y = 172;

/**
 * Draws one half of the aura.
 *
 * Space: the context is inside the pet's own mirror, so what is drawn turns
 * with the animal. x = 0 is the pet's centre column and y = 0 the top of the
 * room, with the pet standing at `PET_Y` as for `atlas.draw(ctx, frame, 0,
 * PET_Y, scale)`; the room does not scale the context, so a style draws at the
 * `scale` it is handed. `frame` is the meditation frame on screen.
 *
 * Rules: `fillRect` and `globalAlpha`, and sprites only through `atlas`. Leave
 * `globalAlpha` as it was found. Allocate nothing per call: the digest (§10.1)
 * runs this twice a frame, and a style whose output depends only on `nowMs`
 * (or on nothing under `reducedMotion`) is what lets still frames be skipped.
 * Under `reducedMotion` draw a still frame with the aura visible.
 */
export type AuraPaint = (
  ctx: SceneContext,
  atlas: Atlas,
  frame: FrameName,
  nowMs: number,
  scale: number,
  reducedMotion: boolean,
) => void;

/** The aura's two halves: `behind` is drawn before the pet's sprite, `front` after its head layer (the beard included). */
export type AuraPainter = { behind: AuraPaint; front: AuraPaint };
