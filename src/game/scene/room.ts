// The room: composes background, pet, particles, and toasts into one scene
// (SPEC §10.1). Logical resolution is fixed; the canvas element scales it up
// by an integer factor with image-rendering: pixelated.

import { Atlas } from "../engine/atlas";
import { Particles, type ParticleKind } from "../engine/particles";
import { Toasts } from "./toasts";
import { AnimationMachine } from "../anim/machine";
import { BUTTERFLY_CLIP, WALK_CLIP, type OneShotName } from "../anim/clips";
import type { DerivedState } from "@/sim/derive";
import type { AmbientEvent } from "@/sim/ambient";
import type { CareAction, LifeStage } from "@/sim/tuning";

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

const CARE_PARTICLES: Record<CareAction, { kind: ParticleKind; count: number }> = {
  FEED: { kind: "crumb", count: 8 },
  PLAY: { kind: "sparkle", count: 10 },
  CLEAN: { kind: "dust", count: 14 },
  PET: { kind: "heart", count: 8 },
  LULLABY: { kind: "zzz", count: 5 },
  MEDICATE: { kind: "sparkle", count: 8 },
};

// Visible growth (SPEC §21.9): the stage the sim already tracks finally
// shows. A hatchling is small and a juvenile nearly grown; adulthood is the
// art's own size, and an elder keeps it but gains brow tufts. The anchor is
// bottom-center throughout, so every size stands on the same floor.
export const STAGE_SCALE: Record<LifeStage, number> = {
  EGG: 1,
  HATCHLING: 0.8,
  PUP: 0.85,
  JUVENILE: 0.9,
  ADULT: 1,
  ELDER: 1,
};

export const stageScale = (stage: LifeStage): number => STAGE_SCALE[stage];

/** Where the brow tufts sit above the floor, in the pet's own pixels. */
const ELDER_BROWS_Y = -112;

/** How this generation feels about the meal it was just fed (SPEC §21.4). */
export type FoodTaste = "favorite" | "disliked";

// A shared rare moment holds the room for six seconds (SPEC §21.5).
const AMBIENT_MS = 6000;
const STAR_FLIGHT_MS = 1200;
const STAR_INTERVAL_MS = 2000;
const NOISE_DIM_MS = 700;

export type RoomDecor = { decor: string[]; activeCosmetic: string | null };

export class Room {
  readonly atlas = new Atlas();
  readonly machine = new AnimationMachine();
  private readonly particles = new Particles();
  private readonly toasts = new Toasts();
  private asleep = false;
  private stage: LifeStage = "EGG";
  private ambientMs = 0;
  private petX = PET_X;
  private facingRight = false;
  private walking = false;
  private lastWanderMs: number | null = null;
  private moment: { event: AmbientEvent; startedMs: number } | null = null;
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
    this.stage = derived.stage;
  }

  /** The draw scale the pet's life stage calls for right now. */
  get petScale(): number {
    return stageScale(this.stage);
  }

  onCare(action: CareAction, label: string, nowMs: number, taste?: FoodTaste): void {
    this.machine.trigger(taste === "disliked" ? "unhappyEating" : CARE_ONE_SHOTS[action], nowMs);
    this.toasts.push(label, nowMs);
    if (this.reducedMotion) return;
    // A favourite meal draws hearts instead of crumbs — the same tell the
    // pet gives when it is petted.
    const particles = taste === "favorite" ? { kind: "heart" as const, count: 10 } : CARE_PARTICLES[action];
    this.particles.spawn(particles.kind, this.petX, PET_Y - 60, particles.count);
  }

  celebrate(nowMs: number, kind: ParticleKind = "sparkle"): void {
    this.machine.trigger("celebrating", nowMs);
    if (!this.reducedMotion) this.particles.spawn(kind, this.petX, PET_Y - 60, 12);
  }

  onMilestone(label: string, nowMs: number): void {
    this.toasts.push(label, nowMs);
  }

  /**
   * A shared rare moment (SPEC §21.5). Under reduced motion the feed entry
   * carries it alone — nothing here runs.
   */
  ambient(event: AmbientEvent, nowMs: number): void {
    if (this.reducedMotion) return;
    this.moment = { event, startedMs: nowMs };
    if (event === "coin-dig") {
      this.machine.trigger("bathing", nowMs);
      this.particles.spawn("sparkle", this.petX, PET_Y - 24, 16);
    } else if (event === "mystery-noise") {
      this.machine.trigger("startled", nowMs);
    }
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
      const scale = this.petScale;
      if (this.facingRight) {
        // The art faces left; strolling right mirrors it around the anchor.
        ctx.save();
        ctx.translate(x, 0);
        ctx.scale(-1, 1);
        this.atlas.draw(ctx, frame, 0, PET_Y, scale);
        ctx.restore();
      } else {
        this.atlas.draw(ctx, frame, x, PET_Y, scale);
      }
      this.renderHead(ctx, x, scale);
    }

    this.particles.render(ctx);
    this.renderAmbient(ctx, nowMs);

    // Night dims the room without hiding it.
    if (this.asleep) {
      ctx.fillStyle = "rgba(9, 8, 24, 0.45)";
      ctx.fillRect(0, 0, ROOM_WIDTH, ROOM_HEIGHT);
    }

    this.toasts.render(ctx, nowMs, PET_X, PET_Y - 110);
  }

  /**
   * The rare moment's six seconds of theatre: a streak across the night sky,
   * a butterfly on a sine path, or a beat of darkness. The dig needs nothing
   * here — its one-shot and sparkles say it already.
   */
  private renderAmbient(ctx: CanvasRenderingContext2D, nowMs: number): void {
    const moment = this.moment;
    if (!moment) return;
    const age = nowMs - moment.startedMs;
    if (age < 0 || age > AMBIENT_MS) {
      this.moment = null;
      return;
    }
    if (moment.event === "shooting-star") {
      // Three streaks over the window, each falling left-to-right down the
      // wall; they stay above the wainscot line so they read as sky.
      const index = Math.floor(age / STAR_INTERVAL_MS);
      const progress = (age - index * STAR_INTERVAL_MS) / STAR_FLIGHT_MS;
      if (progress > 1) return;
      const startX = 20 + index * 60;
      const x = startX + progress * 150;
      const y = 14 + index * 22 + progress * 40;
      ctx.fillStyle = "#fff7d6";
      ctx.fillRect(Math.round(x), Math.round(y), 2, 2);
      ctx.globalAlpha = 0.5;
      ctx.fillRect(Math.round(x - 5), Math.round(y - 2), 2, 2);
      ctx.globalAlpha = 0.25;
      ctx.fillRect(Math.round(x - 10), Math.round(y - 4), 2, 2);
      ctx.globalAlpha = 1;
    } else if (moment.event === "butterfly") {
      const progress = age / AMBIENT_MS;
      const x = 12 + progress * (ROOM_WIDTH - 24);
      const y = 96 - Math.sin(progress * Math.PI * 3) * 22;
      const frames = BUTTERFLY_CLIP.frames;
      const frame = frames[Math.floor(nowMs / BUTTERFLY_CLIP.frameMs) % frames.length]!;
      this.atlas.draw(ctx, frame, x, y);
    } else if (moment.event === "mystery-noise" && age < NOISE_DIM_MS) {
      ctx.fillStyle = "rgba(9, 8, 24, 0.10)";
      ctx.fillRect(0, 0, ROOM_WIDTH, ROOM_HEIGHT);
    }
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

  /**
   * Everything worn on the head, drawn inside the pet's own scaled space so
   * a hatchling's hat is a hatchling-sized hat. An elder's brow tufts stack
   * underneath whatever cosmetic is on top of them (SPEC §21.9).
   */
  private renderHead(ctx: CanvasRenderingContext2D, x: number, scale: number): void {
    ctx.save();
    ctx.translate(x, PET_Y);
    ctx.scale(scale, scale);
    if (this.stage === "ELDER") this.atlas.draw(ctx, "elderBrows", -2, ELDER_BROWS_Y);
    this.renderCosmetic(ctx);
    ctx.restore();
  }

  /** The worn cosmetic, in head-anchored coordinates. */
  private renderCosmetic(ctx: CanvasRenderingContext2D): void {
    const hat = this.decor.activeCosmetic;
    if (!hat) return;
    const px = (dx: number, dy: number, w: number, h: number, color: string): void => {
      ctx.fillStyle = color;
      ctx.fillRect(dx - 2, dy - 128, w, h);
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
