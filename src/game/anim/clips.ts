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

/** Looping clips for every derived animation state. */
export const BASE_CLIPS: Record<AnimationKey, Clip> = {
  egg: clip(["clone1", "clone2", "clone3", "clone4", "clone5", "clone6", "clone7", "clone8"], 1800, true),
  idle: clip(["idleSide1", "idleSide2", "idleSide3"], 900, true),
  sleeping: clip(["sleep1", "sleep2"], 1200, true),
  sick: clip(["sick1", "sick2"], 900, true),
  hungry: clip(["unhappyEat1", "unhappyEat2"], 800, true),
  dirty: clip(["lift1", "lift2"], 900, true),
  tired: clip(["tired1", "tired2"], 1000, true),
  bored: clip(["bored1", "bored2", "bored3"], 1000, true),
  dead: clip(["dead1", "dead2"], 2000, true),
};

export const ONE_SHOT_NAMES = ["eating", "playing", "bathing", "petted", "soothed", "medicated", "greeting"] as const;
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
};

export const durationMs = (target: Clip): number => target.frames.length * target.frameMs;
