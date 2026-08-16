// The room: composes background, pet, particles, and toasts into one scene
// (SPEC §10.1). Logical resolution is fixed; the canvas element scales it up
// by an integer factor with image-rendering: pixelated.

import { Atlas } from "../engine/atlas";
import { Particles } from "../engine/particles";
import { Toasts } from "./toasts";
import { AnimationMachine } from "../anim/machine";
import { WALK_CLIP, type OneShotName } from "../anim/clips";
import type { DerivedState } from "@/sim/derive";
import type { CareAction } from "@/sim/tuning";

export const ROOM_WIDTH = 260;
export const ROOM_HEIGHT = 200;
const PET_X = ROOM_WIDTH / 2;
const PET_Y = 172;

// Idle wander: every slot the pet picks a spot on the rug band and strolls
// there with the walk cycle. Slots hash wall-clock time, so every open tab
// converges on the same destination — the shared pet stands in the same
// corner for everyone.
const WANDER_MIN_X = 66;
const WANDER_MAX_X = 194;
const WANDER_PERIOD_MS = 9000;
const WANDER_SPEED_PX_MS = 26 / 1000;
const wanderTargetAt = (wallMs: number): number => {
  const slot = Math.floor(wallMs / WANDER_PERIOD_MS);
  let h = Math.imul(slot ^ 0x85ebca6b, 2654435761);
  h ^= h >>> 13;
  return WANDER_MIN_X + ((h >>> 0) % (WANDER_MAX_X - WANDER_MIN_X));
};

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

export type RoomDecor = { decor: string[]; activeCosmetic: string | null };

export class Room {
  readonly atlas = new Atlas();
  readonly machine = new AnimationMachine();
  private readonly particles = new Particles();
  private readonly toasts = new Toasts();
  private asleep = false;
  private ambientMs = 0;
  private petX = PET_X;
  private facingRight = false;
  private walking = false;
  private lastWanderMs: number | null = null;
  decor: RoomDecor = { decor: [], activeCosmetic: null };

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
      this.particles.spawn(particles.kind, this.petX, PET_Y - 60, particles.count);
    }
  }

  celebrate(nowMs: number): void {
    this.machine.trigger("celebrating", nowMs);
    if (!this.reducedMotion) this.particles.spawn("sparkle", this.petX, PET_Y - 60, 12);
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
      this.particles.spawn("zzz", this.petX + 30, PET_Y - 90, 1);
    }
  }

  // The pet strolls only while genuinely idling: awake, healthy enough to
  // have nothing to complain about, and not mid-reaction. Movement runs on
  // render time (it is pure presentation), targets on wall-clock time (so
  // every viewer sees the same destination).
  private updateWander(nowMs: number): void {
    const dt = Math.min(nowMs - (this.lastWanderMs ?? nowMs), 100);
    this.lastWanderMs = nowMs;
    const key = this.machine.baseKey;
    const wanderable =
      !this.reducedMotion && !this.asleep && this.machine.activeOneShot(nowMs) === null && (key === "idle" || key === "bored");
    if (!wanderable) {
      this.walking = false;
      return;
    }
    const target = wanderTargetAt(Date.now());
    const delta = target - this.petX;
    if (Math.abs(delta) <= 2) {
      this.walking = false;
      return;
    }
    this.walking = true;
    this.facingRight = delta > 0;
    this.petX += Math.sign(delta) * WANDER_SPEED_PX_MS * dt;
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

    this.renderDecor(ctx);

    this.updateWander(nowMs);
    if (this.atlas.ready) {
      const frame = this.walking
        ? WALK_CLIP.frames[Math.floor(nowMs / WALK_CLIP.frameMs) % WALK_CLIP.frames.length]!
        : this.machine.frameAt(nowMs);
      const x = Math.round(this.petX);
      if (this.facingRight) {
        // The art faces left; strolling right mirrors it around the anchor.
        ctx.save();
        ctx.translate(x, 0);
        ctx.scale(-1, 1);
        this.atlas.draw(ctx, frame, 0, PET_Y);
        ctx.restore();
      } else {
        this.atlas.draw(ctx, frame, x, PET_Y);
      }
      this.renderCosmetic(ctx);
    }

    this.particles.render(ctx);

    // Night dims the room without hiding it.
    if (this.asleep) {
      ctx.fillStyle = "rgba(9, 8, 24, 0.45)";
      ctx.fillRect(0, 0, ROOM_WIDTH, ROOM_HEIGHT);
    }

    this.toasts.render(ctx, nowMs, PET_X, PET_Y - 110);
  }

  /** Communal decor (SPEC §13.2), drawn procedurally in the room palette. */
  private renderDecor(ctx: CanvasRenderingContext2D): void {
    const px = (x: number, y: number, w: number, h: number, color: string): void => {
      ctx.fillStyle = color;
      ctx.fillRect(x, y, w, h);
    };
    if (this.decor.decor.includes("plant")) {
      px(20, 148, 16, 14, "#7a4a2b"); // pot
      px(24, 130, 8, 18, "#3c7a3c");
      px(18, 136, 8, 8, "#4f9a4f");
      px(30, 132, 8, 8, "#4f9a4f");
    }
    if (this.decor.decor.includes("picture")) {
      px(96, 40, 30, 24, "#6a5a3b"); // frame
      px(99, 43, 24, 18, "#8fb3d9"); // sky
      px(99, 55, 24, 6, "#5b7a4a"); // hills
    }
    if (this.decor.decor.includes("lamp")) {
      px(226, 96, 4, 66, "#57492f"); // pole
      px(216, 84, 24, 14, "#e8c76a"); // shade
      ctx.globalAlpha = 0.12;
      px(206, 98, 44, 64, "#ffe9a3"); // glow
      ctx.globalAlpha = 1;
    }
  }

  /** The worn cosmetic, anchored to the pet's head. */
  private renderCosmetic(ctx: CanvasRenderingContext2D): void {
    const hat = this.decor.activeCosmetic;
    if (!hat) return;
    const x = Math.round(this.petX) - 2;
    const y = PET_Y - 128;
    const px = (dx: number, dy: number, w: number, h: number, color: string): void => {
      ctx.fillStyle = color;
      ctx.fillRect(x + dx, y + dy, w, h);
    };
    if (hat === "bow") {
      px(-10, 2, 8, 8, "#d9538a");
      px(2, 2, 8, 8, "#d9538a");
      px(-2, 4, 4, 4, "#a83766");
    } else if (hat === "cap") {
      px(-12, 0, 24, 6, "#3b6ea5");
      px(-12, 6, 30, 3, "#2c5480");
    } else if (hat === "crown") {
      px(-12, 0, 24, 7, "#e8c76a");
      px(-12, -6, 5, 6, "#e8c76a");
      px(-2, -6, 5, 6, "#e8c76a");
      px(7, -6, 5, 6, "#e8c76a");
      px(-4, 2, 3, 3, "#d9538a");
    }
  }
}
