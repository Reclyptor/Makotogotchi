// The animation state machine (SPEC §10.1): a small pure class deciding
// which atlas frame is visible at a given time. Base clips loop; one-shots
// play to completion and fall back to the base; a new trigger interrupts a
// running one-shot. Time is an explicit parameter — no Date.now() — so the
// machine is exactly testable.

import { BASE_CLIPS, durationMs, ONE_SHOT_CLIPS, type OneShotName } from "./clips";
import type { AnimationKey } from "@/sim/derive";
import type { FrameName } from "../atlas.generated";

export class AnimationMachine {
  private base: AnimationKey = "egg";
  private baseStartMs = 0;
  private oneShot: OneShotName | null = null;
  private oneShotStartMs = 0;
  /** Reduced motion pins each state to its first frame (SPEC §10.4). */
  reducedMotion = false;

  setBase(key: AnimationKey, nowMs: number): void {
    if (key === this.base) return;
    this.base = key;
    this.baseStartMs = nowMs;
  }

  trigger(name: OneShotName, nowMs: number): void {
    this.oneShot = name;
    this.oneShotStartMs = nowMs;
  }

  frameAt(nowMs: number): FrameName {
    if (this.oneShot) {
      const clip = ONE_SHOT_CLIPS[this.oneShot];
      const elapsed = nowMs - this.oneShotStartMs;
      if (elapsed < durationMs(clip)) {
        if (this.reducedMotion) return clip.frames[0]!;
        return clip.frames[Math.floor(elapsed / clip.frameMs)]!;
      }
      this.oneShot = null;
    }
    const clip = BASE_CLIPS[this.base];
    if (this.reducedMotion) return clip.frames[0]!;
    const step = Math.floor((nowMs - this.baseStartMs) / clip.frameMs);
    return clip.frames[step % clip.frames.length]!;
  }

  /** The active one-shot, if any — lets the scene sync particles to it. */
  activeOneShot(nowMs: number): OneShotName | null {
    if (this.oneShot && nowMs - this.oneShotStartMs < durationMs(ONE_SHOT_CLIPS[this.oneShot])) {
      return this.oneShot;
    }
    return null;
  }
}
