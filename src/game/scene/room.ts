// The room: composes background, pet, particles, and toasts into one scene
// (SPEC §10.1). Logical resolution is fixed; the canvas element scales it up
// by an integer factor with image-rendering: pixelated.

import { Atlas } from "../engine/atlas";
import { Particles, type ParticleKind } from "../engine/particles";
import { Toasts } from "./toasts";
import { AnimationMachine } from "../anim/machine";
import { BASE_CLIPS, BUTTERFLY_CLIP, IDLE_FLOURISH_CLIPS, ONE_SHOT_CLIPS, WALK_CLIP, type OneShotName } from "../anim/clips";
import { SPRITE_FRAMES } from "../atlas.generated";
import { Backdrop, ROOM_HEIGHT, ROOM_WIDTH, RUG, type BackdropKey, type Condition } from "./backdrop";
import { celestialAt, seasonFor, skyMomentAt, weatherFor, type Celestial } from "@/sim/atmosphere";
import type { DerivedState } from "@/sim/derive";
import type { AmbientEvent } from "@/sim/ambient";
import type { CareAction, LifeStage } from "@/sim/tuning";

export { ROOM_WIDTH, ROOM_HEIGHT } from "./backdrop";
const PET_X = ROOM_WIDTH / 2;
const PET_Y = 172;

/** What the room needs from the pet's own calendar to dress itself (§22.1). */
export type AtmosphereInput = {
  hour: number;
  minute: number;
  /** 1-based month in the pet's timezone, for the season. */
  month: number;
  /** Days since genesis in the pet's timezone, which fixes the weather. */
  dayIndex: number;
  seed: number;
  themeId: string | null;
};

const ALERT_CONDITION: Record<DerivedState["alert"], Condition> = {
  OK: "well",
  WARN: "poor",
  CRITICAL: "critical",
};

// Idle wander: every slot the pet picks a spot on the rug and strolls there
// with the walk cycle. Slots hash wall-clock time, so every open tab
// converges on the same destination — the shared pet stands in the same
// corner for everyone.
const WANDER_PERIOD_MS = 9000;
const WANDER_SPEED_PX_MS = 26 / 1000;

// The pet is more than half the room wide, so the band it strolls through is
// not the rug's own span: a pet centred on the rug's edge stands half off it,
// and one centred near the room's edge is drawn clean through the wall.

/**
 * Half the widest frame the room can ever draw the pet at. Derived from the
 * clips rather than measured off the sheet: reactions are not all the same
 * size as the idle pose — a sneeze throws an arm out, a cheer both — and a
 * hand-copied number silently stops covering the pet the day someone draws a
 * wider one.
 */
const PET_HALF_WIDTH =
  Math.max(
    ...[...Object.values(BASE_CLIPS), ...Object.values(ONE_SHOT_CLIPS), ...IDLE_FLOURISH_CLIPS, WALK_CLIP]
      .flatMap((clip) => clip.frames)
      .map((name) => SPRITE_FRAMES[name].w),
  ) / 2;

/**
 * How far the outer foot of the idle pose reaches from the centre line,
 * measured from the sheet — the art has to be looked at to know it. A
 * mid-stride frame plants a foot a few pixels further; a stepping foot
 * leaving the rug is what walking looks like, so the band is set by where the
 * pet comes to rest.
 */
const PET_FOOT_REACH = 42;
/** Bare floor left between the pet's silhouette and the wall it stands by. */
const ROOM_EDGE_MARGIN = 2;

export type WanderBand = { min: number; max: number };

/**
 * Where the pet may stand at this stage (SPEC §21.9 scales it): on the rug,
 * and inside the room. A pet too big for its own rug gets the rug's centre
 * rather than a band that runs backwards.
 */
export const wanderBand = (scale: number): WanderBand => {
  const foot = PET_FOOT_REACH * scale;
  const half = PET_HALF_WIDTH * scale;
  const min = Math.max(RUG.x + foot, half + ROOM_EDGE_MARGIN);
  const max = Math.min(RUG.x + RUG.w - foot, ROOM_WIDTH - half - ROOM_EDGE_MARGIN);
  return min <= max ? { min, max } : { min: PET_X, max: PET_X };
};

const wanderTargetAt = (wallMs: number, band: WanderBand): number => {
  const span = Math.floor(band.max - band.min);
  if (span <= 0) return band.min;
  const slot = Math.floor(wallMs / WANDER_PERIOD_MS);
  let h = Math.imul(slot ^ 0x85ebca6b, 2654435761);
  h ^= h >>> 13;
  return band.min + ((h >>> 0) % span);
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
  private readonly backdrop = new Backdrop();
  private condition: Condition = "well";
  private seed = 0;
  // Until the first sync lands, the room holds an ordinary clear midday.
  private backdropKey: BackdropKey = {
    themeId: "cozy",
    segment: "midday",
    next: "midday",
    blend: 0,
    weather: "clear",
    season: "summer",
    sunStep: 8,
    condition: "well",
  };
  private celestial: Celestial = celestialAt(13, 0);
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
    this.condition = ALERT_CONDITION[derived.alert];
  }

  /**
   * Dress the room for the pet's own hour, weather and season (SPEC §22.1).
   * Everything here is derived from the shared clock and the generation
   * seed, so no two caretakers ever see different rooms.
   */
  syncAtmosphere(input: AtmosphereInput): void {
    const moment = skyMomentAt(input.hour, input.minute);
    const season = seasonFor(input.month);
    this.seed = input.seed;
    this.celestial = celestialAt(input.hour, input.minute);
    this.backdropKey = {
      themeId: input.themeId ?? "cozy",
      segment: moment.segment,
      next: moment.next,
      blend: moment.blend,
      weather: weatherFor(input.seed, input.dayIndex, season),
      season,
      sunStep: Math.round(moment.sunHeight * 8),
      condition: this.condition,
    };
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
    // Growing narrows the band, so a pet that just evolved can find itself
    // standing outside it. Walk it back in rather than leaving it clipped.
    const band = wanderBand(this.petScale);
    this.petX = Math.min(band.max, Math.max(band.min, this.petX));
    const key = this.machine.baseKey;
    const wanderable =
      !this.reducedMotion && !this.asleep && this.machine.activeOneShot(nowMs) === null && (key === "idle" || key === "bored");
    if (!wanderable) {
      this.walking = false;
      return;
    }
    const target = wanderTargetAt(Date.now(), band);
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
    // Start from a known transform. The loop swallows a throwing frame to keep
    // the scene alive (engine/loop.ts), so a throw between save() and
    // restore() below would otherwise leak that frame's mirror into every
    // frame after it — the pet, and then the room itself, walking off the
    // canvas and never coming back.
    ctx.setTransform(1, 0, 0, 1, 0, 0);

    // The room itself: architecture, sky, weather (SPEC §22).
    this.backdrop.render(
      ctx,
      { ...this.backdropKey, condition: this.condition },
      this.celestial,
      this.seed,
      nowMs,
      this.reducedMotion,
    );

    this.renderDecor(ctx, nowMs);

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
      ctx.fillStyle = "rgba(9, 8, 24, 0.22)";
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

  /** Communal decor (SPEC §13.2, §21.8), drawn procedurally in the palette. */
  private renderDecor(ctx: CanvasRenderingContext2D, nowMs: number): void {
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
      px(40, 40, 30, 24, "#6a5a3b"); // frame
      px(43, 43, 24, 18, "#8fb3d9"); // sky
      px(43, 55, 24, 6, "#5b7a4a"); // hills
    }
    if (this.decor.decor.includes("lamp")) {
      px(226, 96, 4, 66, "#57492f"); // pole
      px(216, 84, 24, 14, "#e8c76a"); // shade
      ctx.globalAlpha = 0.12;
      px(206, 98, 44, 64, "#ffe9a3"); // glow
      ctx.globalAlpha = 1;
    }

    // Grand items (SPEC §21.8): each carries one small living touch, frozen
    // under reduced motion like everything else in the room.
    const beat = this.reducedMotion ? 0 : nowMs;
    if (this.decor.decor.includes("window_seat")) {
      // The room already has its window (§22.3); the grand item furnishes it.
      px(146, 104, 76, 6, "#9b7fae"); // cushion
      px(146, 110, 76, 10, "#7a5f8a"); // bench
      px(150, 120, 6, 6, "#5f4a70"); // legs
      px(212, 120, 6, 6, "#5f4a70");
      ctx.globalAlpha = 0.1;
      px(150, 72, 68, 32, "#ffe9a3"); // daylight spilling over the seat
      ctx.globalAlpha = 1;
    }
    if (this.decor.decor.includes("aquarium")) {
      px(36, 92, 52, 44, "#3d3450"); // stand-and-tank shell
      px(39, 95, 46, 38, "#2f6f7a"); // water
      px(39, 128, 46, 5, "#c9b48a"); // gravel
      px(56, 108, 6, 4, "#e8a05a"); // a fish, mid-drift
      px(62, 109, 4, 2, "#e8a05a");
      for (let index = 0; index < 4; index++) {
        // Bubbles rise on their own phase and restart at the gravel.
        const phase = ((beat / 1300 + index * 0.27) % 1 + 1) % 1;
        px(46 + index * 10, Math.round(126 - phase * 28), 2, 2, "#bfe6ff");
      }
    }
    if (this.decor.decor.includes("kotatsu")) {
      const warmth = this.reducedMotion ? 0.14 : 0.11 + Math.sin(beat / 1400) * 0.04;
      ctx.globalAlpha = warmth;
      px(96, 126, 68, 26, "#ffb26a"); // the glow under the quilt
      ctx.globalAlpha = 1;
      px(98, 132, 64, 14, "#c9738a"); // quilt
      px(94, 126, 72, 6, "#8a5a3a"); // tabletop
      px(100, 146, 4, 8, "#6f4630"); // legs
      px(156, 146, 4, 8, "#6f4630");
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
