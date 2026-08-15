import { describe, expect, it } from "vitest";
import { AnimationMachine } from "./machine";
import { BASE_CLIPS, durationMs, ONE_SHOT_CLIPS } from "./clips";
import { SPRITE_FRAMES } from "../atlas.generated";

describe("AnimationMachine", () => {
  it("every clip frame exists in the atlas", () => {
    for (const clip of [...Object.values(BASE_CLIPS), ...Object.values(ONE_SHOT_CLIPS)]) {
      for (const frame of clip.frames) {
        expect(SPRITE_FRAMES[frame]).toBeDefined();
      }
    }
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
