// The animation state machine (SPEC §10.1): a small pure class deciding
// which atlas frame is visible at a given time. Base clips loop; one-shots
// play to completion and fall back to the base; a new trigger interrupts a
// running one-shot. Time is an explicit parameter — no Date.now() — so the
// machine is exactly testable.

import { BASE_CLIPS, durationMs, IDLE_FLOURISH_CLIPS, ONE_SHOT_CLIPS, type OneShotName } from "./clips";
import type { AnimationKey } from "@/sim/derive";
import type { FrameName } from "../atlas.generated";

// Every FLOURISH_PERIOD_MS of continuous idling opens a slot; a slot hash
// picks a micro-idle (blink, ear twitch, groom, yawn) or nothing. Pure
// arithmetic on nowMs — no RNG state, so it stays exactly testable.
const FLOURISH_PERIOD_MS = 6500;
const slotHash = (slot: number): number => {
  let h = Math.imul(slot ^ 0x9e3779b9, 2654435761);
  h ^= h >>> 15;
  return h >>> 0;
};

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

  /** The current base state — lets the scene decide whether to wander. */
  get baseKey(): AnimationKey {
    return this.base;
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
    if (this.base === "idle") {
      const sinceBase = nowMs - this.baseStartMs;
      const slot = Math.floor(sinceBase / FLOURISH_PERIOD_MS);
      if (slot > 0) {
        // Two in three slots flourish; the rest stay plain idle.
        const hash = slotHash(slot);
        const pick = hash % (IDLE_FLOURISH_CLIPS.length + 2);
        const flourish = IDLE_FLOURISH_CLIPS[pick];
        if (flourish) {
          const inSlot = sinceBase - slot * FLOURISH_PERIOD_MS;
          if (inSlot < durationMs(flourish)) {
            return flourish.frames[Math.floor(inSlot / flourish.frameMs)]!;
          }
        }
      }
    }
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
