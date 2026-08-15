// The room: composes background, pet, particles, and toasts into one scene
// (SPEC §10.1). Logical resolution is fixed; the canvas element scales it up
// by an integer factor with image-rendering: pixelated.

import { Atlas } from "../engine/atlas";
import { Particles } from "../engine/particles";
import { Toasts } from "./toasts";
import { AnimationMachine } from "../anim/machine";
import type { OneShotName } from "../anim/clips";
import type { DerivedState } from "@/sim/derive";
import type { CareAction } from "@/sim/tuning";

export const ROOM_WIDTH = 260;
export const ROOM_HEIGHT = 200;
const PET_X = ROOM_WIDTH / 2;
const PET_Y = 172;

const CARE_ONE_SHOTS: Record<CareAction, OneShotName> = {
  FEED: "eating",
  PLAY: "playing",
  CLEAN: "bathing",
  PET: "petted",
  LULLABY: "soothed",
  MEDICATE: "medicated",
};

const CARE_PARTICLES: Record<CareAction, { kind: "heart" | "sparkle" | "zzz" | "crumb" | "dust"; count: number }> = {
  FEED: { kind: "crumb", count: 8 },
  PLAY: { kind: "sparkle", count: 10 },
  CLEAN: { kind: "dust", count: 14 },
  PET: { kind: "heart", count: 8 },
  LULLABY: { kind: "zzz", count: 5 },
  MEDICATE: { kind: "sparkle", count: 8 },
};

export class Room {
  readonly atlas = new Atlas();
  readonly machine = new AnimationMachine();
  private readonly particles = new Particles();
  private readonly toasts = new Toasts();
  private asleep = false;
  private ambientMs = 0;

  set reducedMotion(value: boolean) {
    this.machine.reducedMotion = value;
    if (value) this.particles.clear();
  }
  get reducedMotion(): boolean {
    return this.machine.reducedMotion;
  }

  syncDerived(derived: DerivedState, asleep: boolean, nowMs: number): void {
    this.machine.setBase(derived.animation, nowMs);
    this.asleep = asleep;
  }

  onCare(action: CareAction, label: string, nowMs: number): void {
    this.machine.trigger(CARE_ONE_SHOTS[action], nowMs);
    this.toasts.push(label, nowMs);
    if (!this.reducedMotion) {
      const particles = CARE_PARTICLES[action];
      this.particles.spawn(particles.kind, PET_X, PET_Y - 60, particles.count);
    }
  }

  onMilestone(label: string, nowMs: number): void {
    this.toasts.push(label, nowMs);
  }

  update(dtMs: number): void {
    if (this.reducedMotion) return;
    this.particles.update(dtMs);
    this.ambientMs += dtMs;
    // Ambient breaths: sleeping pets exhale a Z every couple of seconds.
    if (this.asleep && this.ambientMs >= 2200) {
      this.ambientMs = 0;
      this.particles.spawn("zzz", PET_X + 30, PET_Y - 90, 1);
    }
  }

  render(ctx: CanvasRenderingContext2D, nowMs: number): void {
    ctx.imageSmoothingEnabled = false;

    // Backdrop: wall, wainscot line, floor.
    ctx.fillStyle = "#2a2333";
    ctx.fillRect(0, 0, ROOM_WIDTH, ROOM_HEIGHT);
    ctx.fillStyle = "#231d2b";
    ctx.fillRect(0, 118, ROOM_WIDTH, 4);
    ctx.fillStyle = "#3a3145";
    ctx.fillRect(0, 122, ROOM_WIDTH, ROOM_HEIGHT - 122);
    // Rug under the pet.
    ctx.fillStyle = "#4a3d5c";
    ctx.fillRect(PET_X - 64, PET_Y - 10, 128, 14);
    ctx.fillStyle = "#5b4b71";
    ctx.fillRect(PET_X - 58, PET_Y - 8, 116, 10);

    if (this.atlas.ready) {
      this.atlas.draw(ctx, this.machine.frameAt(nowMs), PET_X, PET_Y);
    }

    this.particles.render(ctx);

    // Night dims the room without hiding it.
    if (this.asleep) {
      ctx.fillStyle = "rgba(9, 8, 24, 0.45)";
      ctx.fillRect(0, 0, ROOM_WIDTH, ROOM_HEIGHT);
    }

    this.toasts.render(ctx, nowMs, PET_X, PET_Y - 110);
  }
}
