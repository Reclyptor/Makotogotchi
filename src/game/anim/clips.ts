// Clip definitions: which atlas frames play for each animation state, and
// the one-shots that care actions trigger. The state → clip mapping consumes
// derive.ts's AnimationKey — the renderer never reads sim state directly.

import type { AnimationKey } from "@/sim/derive";
import type { FrameName } from "../atlas.generated";

export type Clip = {
  frames: readonly FrameName[];
  frameMs: number;
  loop: boolean;
};

const clip = (frames: readonly FrameName[], frameMs: number, loop: boolean): Clip => ({ frames, frameMs, loop });

/** Looping clips for every derived animation state. Distress states end each
 * loop on a signature beat — a sneeze, a sob, a shiver, a yawn — so the
 * ailment reads even from across the room. */
export const BASE_CLIPS: Record<AnimationKey, Clip> = {
  egg: clip(["clone1", "clone2", "clone3", "clone4", "clone5", "clone6", "clone7", "clone8"], 1800, true),
  idle: clip(["idleSide1", "idleSide2", "idleSide3"], 900, true),
  sleeping: clip(["sleep1", "sleep2"], 1200, true),
  sick: clip(["sick1", "sick2", "sick1", "sick2", "sneeze1", "sneeze2"], 900, true),
  hungry: clip(["unhappyEat1", "unhappyEat2", "unhappyEat1", "unhappyEat2", "cry1", "cry2"], 800, true),
  dirty: clip(["lift1", "lift2", "lift1", "lift2", "shiver1", "shiver2"], 900, true),
  tired: clip(["tired1", "tired2", "tired1", "tired2", "yawn1", "yawn2"], 1000, true),
  bored: clip(["bored1", "bored2", "bored3"], 1000, true),
  dead: clip(["dead1", "dead2"], 2000, true),
};

export const ONE_SHOT_NAMES = ["eating", "playing", "bathing", "petted", "soothed", "medicated", "greeting", "celebrating"] as const;
export type OneShotName = (typeof ONE_SHOT_NAMES)[number];

/** Care-action reactions: play once, then return to the base clip. */
export const ONE_SHOT_CLIPS: Record<OneShotName, Clip> = {
  eating: clip(["eat1", "eat2", "eat1", "eat2", "eat1", "eat2"], 450, false),
  playing: clip(["game1", "game2", "game3", "game1", "game2", "game3"], 400, false),
  bathing: clip(["dustbath1", "dustbath2", "dustbath3", "dustbath1", "dustbath2", "dustbath3"], 450, false),
  petted: clip(["lights1", "lights2", "lights1", "lights2"], 450, false),
  soothed: clip(["tea1", "tea2", "tea1", "tea2"], 500, false),
  medicated: clip(["drpepper1", "drpepper2", "drpepper1", "drpepper2"], 400, false),
  greeting: clip(["pekori", "idleFront1", "pekori"], 500, false),
  celebrating: clip(["cheer1", "cheer2", "cheer1", "cheer2", "heart1", "heart2"], 450, false),
};

/** Micro-idle flourishes: short interludes the machine sprinkles into the
 * idle loop so the pet never reads as a two-second GIF. */
export const IDLE_FLOURISH_CLIPS: readonly Clip[] = [
  clip(["blink"], 300, false),
  clip(["earTwitch", "idleSide1", "earTwitch"], 280, false),
  clip(["groom1", "groom2", "groom1", "groom2"], 420, false),
  clip(["yawn1", "yawn2", "yawn2", "yawn1"], 480, false),
];

/** The stride cycle the room plays while the pet wanders. */
export const WALK_CLIP: Clip = clip(["walk1", "walk2", "walk3", "walk4"], 160, true);

export const durationMs = (target: Clip): number => target.frames.length * target.frameMs;
