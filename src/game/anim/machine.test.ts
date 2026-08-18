import { describe, expect, it } from "vitest";
import { AnimationMachine } from "./machine";
import { BASE_CLIPS, durationMs, IDLE_FLOURISH_CLIPS, ONE_SHOT_CLIPS, WALK_CLIP } from "./clips";
import { SPRITE_FRAMES } from "../atlas.generated";

describe("AnimationMachine", () => {
  it("every clip frame exists in the atlas", () => {
    for (const clip of [...Object.values(BASE_CLIPS), ...Object.values(ONE_SHOT_CLIPS), ...IDLE_FLOURISH_CLIPS, WALK_CLIP]) {
      for (const frame of clip.frames) {
        expect(SPRITE_FRAMES[frame]).toBeDefined();
      }
    }
  });

  it("sprinkles idle flourishes deterministically, but never in the first slot", () => {
    const machine = new AnimationMachine();
    machine.setBase("idle", 0);
    const idleFrames = new Set(BASE_CLIPS.idle.frames);
    const flourishFrames = new Set(IDLE_FLOURISH_CLIPS.flatMap((clip) => [...clip.frames]));
    // The first 6.5s slot always plays plain idle.
    for (let t = 0; t < 6500; t += 100) expect(idleFrames.has(machine.frameAt(t))).toBe(true);
    // Over a minute of idling, at least one flourish frame appears…
    let sawFlourish = false;
    for (let t = 0; t < 60_000; t += 50) {
      const frame = machine.frameAt(t);
      if (flourishFrames.has(frame) && !idleFrames.has(frame)) sawFlourish = true;
    }
    expect(sawFlourish).toBe(true);
    // …and two machines with the same phase agree exactly.
    const twin = new AnimationMachine();
    twin.setBase("idle", 0);
    for (let t = 0; t < 30_000; t += 137) expect(twin.frameAt(t)).toBe(machine.frameAt(t));
  });

  it("never flourishes under reduced motion", () => {
    const machine = new AnimationMachine();
    machine.reducedMotion = true;
    machine.setBase("idle", 0);
    for (let t = 0; t < 60_000; t += 250) expect(machine.frameAt(t)).toBe(BASE_CLIPS.idle.frames[0]);
  });

  it("loops the base clip", () => {
    const machine = new AnimationMachine();
    machine.setBase("idle", 0);
    const clip = BASE_CLIPS.idle;
    expect(machine.frameAt(0)).toBe(clip.frames[0]);
    expect(machine.frameAt(clip.frameMs)).toBe(clip.frames[1]);
    expect(machine.frameAt(clip.frameMs * clip.frames.length)).toBe(clip.frames[0]); // wrapped
  });

  it("restarts phase when the base changes, and ignores same-key resets", () => {
    const machine = new AnimationMachine();
    machine.setBase("idle", 0);
    machine.frameAt(2500);
    machine.setBase("idle", 2500); // no-op: same key must not reset phase
    expect(machine.frameAt(2700)).toBe(BASE_CLIPS.idle.frames[Math.floor(2700 / 900) % 3]);
    machine.setBase("sleeping", 3000);
    expect(machine.frameAt(3000)).toBe(BASE_CLIPS.sleeping.frames[0]);
  });

  it("plays a one-shot to completion then falls back to base", () => {
    const machine = new AnimationMachine();
    machine.setBase("idle", 0);
    machine.trigger("eating", 1000);
    const eating = ONE_SHOT_CLIPS.eating;
    expect(machine.frameAt(1000)).toBe(eating.frames[0]);
    expect(machine.frameAt(1000 + eating.frameMs)).toBe(eating.frames[1]);
    expect(machine.activeOneShot(1000)).toBe("eating");
    const after = 1000 + durationMs(eating);
    expect(machine.activeOneShot(after)).toBeNull();
    expect(BASE_CLIPS.idle.frames).toContain(machine.frameAt(after));
  });

  it("a new trigger interrupts a running one-shot", () => {
    const machine = new AnimationMachine();
    machine.setBase("idle", 0);
    machine.trigger("eating", 0);
    machine.trigger("petted", 500);
    expect(machine.frameAt(500)).toBe(ONE_SHOT_CLIPS.petted.frames[0]);
  });

  // Care is stamped with performance.now() in the stream handler; the scene
  // renders with the requestAnimationFrame timestamp, sampled when the frame
  // began. Petting during a frame therefore starts a clip in that frame's
  // future, and the machine still has to name a frame.
  it("names a frame when a clip starts after the frame drawing it", () => {
    const machine = new AnimationMachine();
    machine.setBase("idle", 0);
    machine.trigger("petted", 1000);
    for (const now of [1000, 999, 990, 950, 900, 0]) {
      const frame = machine.frameAt(now);
      expect(frame, `frameAt(${now})`).toBe(ONE_SHOT_CLIPS.petted.frames[0]);
      expect(SPRITE_FRAMES[frame], `frameAt(${now}) is a real sprite`).toBeDefined();
    }
    // …and it still counts as running, so the scene holds off wandering.
    expect(machine.activeOneShot(990)).toBe("petted");
  });

  it("names a frame when the base state starts after the frame drawing it", () => {
    const machine = new AnimationMachine();
    machine.setBase("idle", 1000);
    for (const now of [1000, 999, 900, 0]) {
      expect(SPRITE_FRAMES[machine.frameAt(now)], `frameAt(${now})`).toBeDefined();
    }
  });

  it("reduced motion pins every state to a single frame", () => {
    const machine = new AnimationMachine();
    machine.reducedMotion = true;
    machine.setBase("idle", 0);
    expect(machine.frameAt(0)).toBe(BASE_CLIPS.idle.frames[0]);
    expect(machine.frameAt(5000)).toBe(BASE_CLIPS.idle.frames[0]);
    machine.trigger("eating", 6000);
    expect(machine.frameAt(6000)).toBe(ONE_SHOT_CLIPS.eating.frames[0]);
  });
});
