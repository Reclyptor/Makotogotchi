// The room: composes background, pet, particles, and toasts into one scene
// (SPEC §10.1). Logical resolution is fixed; the canvas element scales it up
// by an integer factor with image-rendering: pixelated.

import { Atlas } from "../engine/atlas";
import { layer } from "../engine/layer";
import { Particles, type ParticleKind } from "../engine/particles";
import { DigestContext, type SceneContext } from "../engine/digest";
import { Toasts } from "./toasts";
import { Portrait, PORTRAIT_HEIGHT, PORTRAIT_WIDTH } from "./portrait";
import { FamilyWall, type Ancestor } from "./ancestors";
import { Spectacle } from "./party";
import { AnimationMachine } from "../anim/machine";
import { BASE_CLIPS, BUTTERFLY_CLIP, IDLE_FLOURISH_CLIPS, ONE_SHOT_CLIPS, WALK_CLIP, type OneShotName } from "../anim/clips";
import { SPRITE_FRAMES, type FrameName } from "../atlas.generated";
import { HEAD_ANCHORS } from "./head";
import { Backdrop, keyOf, ROOM_HEIGHT, ROOM_WIDTH, RUG, venueSpec, WINDOW, type BackdropKey, type Condition } from "./backdrop";
import { celestialAt, seasonFor, skyMomentAt, weatherFor, type Celestial } from "@/sim/atmosphere";
import type { DerivedState } from "@/sim/derive";
import type { AmbientEvent } from "@/sim/ambient";
import type { SpectacleMood } from "@/sim/secret";
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
  /**
   * Where the day is being spent (SPEC §22.8), already drawn. The room does
   * not take the draw itself: the caption needs the same answer, and one
   * caller resolving it once is what stops the two disagreeing.
   */
  venueId: string;
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
 * Where the pet may stand at this stage (SPEC §21.9 scales it): on the
 * venue's ground span — the rug at home, the generalized §22.3 rule
 * elsewhere — and inside the scene. A pet too big for its own span gets the
 * centre rather than a band that runs backwards.
 */
export const wanderBand = (scale: number, span: { left: number; right: number } = { left: RUG.x, right: RUG.x + RUG.w }): WanderBand => {
  const foot = PET_FOOT_REACH * scale;
  const half = PET_HALF_WIDTH * scale;
  const min = Math.max(span.left + foot, half + ROOM_EDGE_MARGIN);
  const max = Math.min(span.right - foot, ROOM_WIDTH - half - ROOM_EDGE_MARGIN);
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
/**
 * Where an elder's brow tufts sit, from the head anchor (SPEC §10.5): the
 * sprite's bottom-centre nine rows below the top of the head outline, so the
 * tufts rest on the brow with one ear either side of them.
 */
const ELDER_BROWS = { x: 0, y: 9 };

/** How this generation feels about the meal it was just fed (SPEC §21.4). */
export type FoodTaste = "favorite" | "disliked";

// Where the framed picture hangs, and how wide its moulding is. It sits on the
// bare wall left of the window and level with it — the two are the only things
// on that wall, and hanging them off each other's centre line is the difference
// between a room and a wall with objects on it. Above the picture rail, and
// clear of the aquarium that stands against the same wall once the room funds
// one (SPEC §22.3).
const PICTURE_X = 40;
const PICTURE_Y = WINDOW.y + Math.round((WINDOW.h - (PORTRAIT_HEIGHT + 4)) / 2);
const PICTURE_MOULDING = 2;

// A shared rare moment holds the room for six seconds (SPEC §21.5).
const AMBIENT_MS = 6000;
const STAR_FLIGHT_MS = 1200;
const STAR_INTERVAL_MS = 2000;
const NOISE_DIM_MS = 700;

export type RoomDecor = {
  decor: string[];
  activeCosmetic: string | null;
  /** The generations before this one, newest first (SPEC §22.10). */
  ancestors: Ancestor[];
};

export class Room {
  readonly atlas = new Atlas();
  readonly machine = new AnimationMachine();
  private readonly particles = new Particles();
  private readonly toasts = new Toasts();
  private readonly backdrop = new Backdrop();
  private readonly portrait = new Portrait();
  private readonly familyWall = new FamilyWall();
  private readonly spectacle = new Spectacle();
  private condition: Condition = "well";
  private seed = 0;
  // Until the first sync lands, the room holds an ordinary clear midday.
  private backdropKey: BackdropKey = {
    venueId: "home",
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
  decor: RoomDecor = { decor: [], activeCosmetic: null, ancestors: [] };

  /** The frame the canvas is currently showing, and the recorder that decides
   *  whether the next one would differ from it (engine/digest.ts). */
  private readonly digest = new DigestContext();
  private painted: number | null = null;

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
      venueId: input.venueId,
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
   * Someone entered the ancient code (SPEC §26.4). The toast lands either
   * way; under reduced motion it and the feed line are the whole event, as
   * they are for every rare moment.
   *
   * The toast names the code but never spells it — a canvas that printed
   * ↑↑↓↓←→←→BA would teach the sequence to every witness, which is the one
   * discovery route §26 deliberately does not take.
   */
  secret(mood: SpectacleMood, nowMs: number): void {
    this.toasts.push(mood === "party" ? "the ancient code" : "the sky opens", nowMs);
    if (this.reducedMotion) return;
    this.spectacle.start(mood, nowMs);
    if (mood === "party") this.machine.trigger("celebrating", nowMs);
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
    // Growing narrows the band — and a day trip moves it — so the pet can
    // find itself standing outside it. Walk it back in rather than leaving
    // it clipped.
    const band = wanderBand(this.petScale, venueSpec(this.backdropKey.venueId).span);
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

  /** Everything the frame changes about the room before anything is drawn.
   *  Split out from painting so `paint` is a pure function of scene state and
   *  can therefore be run twice in a frame — once to hash, once to draw —
   *  without advancing the stroll twice or eating a rare moment. */
  private advance(nowMs: number): void {
    this.updateWander(nowMs);
    const moment = this.moment;
    if (moment && (nowMs - moment.startedMs < 0 || nowMs - moment.startedMs > AMBIENT_MS)) this.moment = null;
    this.spectacle.advance(nowMs);
    // The cheer is a one-shot and the party outlasts it several times over,
    // so it is re-armed as it lapses rather than played once at the top.
    if (this.spectacle.active && this.spectacle.currentMood === "party" && this.machine.activeOneShot(nowMs) === null) {
      this.machine.trigger("celebrating", nowMs);
    }
  }

  /**
   * One frame, one layer (SPEC §10.1). The loop swallows a throwing frame to
   * keep the scene alive (engine/loop.ts), so everything this frame does to
   * the context — a mirror, a clip, a fade — has to come back off it even
   * when the frame dies half-drawn. Nothing downstream repairs it: the
   * backdrop blit is the only full-canvas paint, and a leaked transform or
   * clip is precisely what stops that blit from covering the canvas, which
   * welds the surviving pixels of older frames into the scene for good.
   *
   * A frame that would land the same pixels as the one already on the canvas
   * is not drawn at all. At the loop's 15fps cadence most frames are exactly
   * that — the pet's clips run about a frame a second and two clouds cross
   * the sky at a pixel a second — and every needless paint costs a texture
   * upload plus a re-blur of every frosted panel above it. What "the same
   * pixels" means is decided by replaying the frame into a recorder rather
   * than by predicting it from state, so the test cannot drift from the
   * drawing (engine/digest.ts).
   */
  render(ctx: SceneContext, nowMs: number): void {
    this.advance(nowMs);

    this.digest.reset();
    // The architecture arrives as a cached blit whose draw call says nothing
    // about what is in it; the key that composed those pixels does.
    this.digest.text(keyOf({ ...this.backdropKey, condition: this.condition }));
    layer(this.digest, () => this.paint(this.digest, nowMs));
    if (this.digest.value === this.painted) return;
    this.painted = this.digest.value;

    layer(ctx, () => this.paint(ctx, nowMs));
  }

  /** Forces the next frame to paint, whatever it looks like. The canvas is
   *  not ours alone — a resize or a context loss clears it out from under us,
   *  and the room has to be put back even though nothing in it moved. */
  invalidate(): void {
    this.painted = null;
    this.backdrop.invalidate();
  }

  private paint(ctx: SceneContext, nowMs: number): void {
    ctx.imageSmoothingEnabled = false;
    // The context is shared and its state is sticky, so the frame starts from
    // a baseline rather than from whatever was left on it. The clip is the
    // one piece that cannot be re-established from the inside — `layer` is
    // what keeps one from ever leaking here.
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;

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
    // Behind the pet on purpose (SPEC §26.4): the wash sinks the room without
    // taking the animal with it, and a meteor passes at depth.
    this.spectacle.renderBehind(ctx, nowMs);

    if (this.atlas.ready) {
      const frame = this.walking
        ? WALK_CLIP.frames[Math.floor(nowMs / WALK_CLIP.frameMs) % WALK_CLIP.frames.length]!
        : this.machine.frameAt(nowMs);
      const x = Math.round(this.petX);
      const scale = this.petScale;
      // The art faces left; strolling right mirrors it around the anchor. The
      // facing outlives the stroll, and the gravestone must not inherit it:
      // its letters have to read whichever way the pet was last walking.
      const mirrored = this.facingRight && this.machine.baseKey !== "dead";
      layer(ctx, () => {
        ctx.translate(x, 0);
        if (mirrored) ctx.scale(-1, 1);
        this.atlas.draw(ctx, frame, 0, PET_Y, scale);
        // Whatever the head wears is drawn in the same transform, so it
        // mirrors with the pet and finds the head wherever this frame put it.
        this.renderHead(ctx, frame, scale);
      });
    }

    this.particles.render(ctx);
    this.renderAmbient(ctx, nowMs);
    this.spectacle.renderFront(ctx, nowMs);

    // Night dims the room without hiding it — unless the sky is already open,
    // whose deeper wash stands in for it (SPEC §26.4).
    if (this.asleep && !this.spectacle.supersedesNightDim) {
      ctx.fillStyle = "rgba(9, 8, 24, 0.22)";
      ctx.fillRect(0, 0, ROOM_WIDTH, ROOM_HEIGHT);
    }

    this.toasts.render(ctx, nowMs, PET_X, PET_Y - 110);
  }

  /**
   * The rare moment's six seconds of theatre: a streak across the night sky,
   * a butterfly on a sine path, or a beat of darkness. The dig needs nothing
   * here — its one-shot and sparkles say it already. Retiring a moment that
   * has run its course belongs to `advance`, not here: this draws, and draws
   * the same thing however many times it is called for one frame.
   */
  private renderAmbient(ctx: SceneContext, nowMs: number): void {
    const moment = this.moment;
    if (!moment) return;
    const age = nowMs - moment.startedMs;
    if (age < 0 || age > AMBIENT_MS) return;
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

  /** Communal decor (SPEC §13.2, §21.8), drawn procedurally save for the one
   *  item that is a picture. It furnishes the room — away venues carry none
   *  of it (SPEC §22.8). */
  private renderDecor(ctx: SceneContext, nowMs: number): void {
    if (!venueSpec(this.backdropKey.venueId).decor) return;
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
      // Only the moulding is furniture; the picture inside it is art, and
      // comes from scene/portrait.ts as one blit. The bevel is lit along its
      // top and left like every other frame in the room (SPEC §22.3).
      const width = PORTRAIT_WIDTH + PICTURE_MOULDING * 2;
      const height = PORTRAIT_HEIGHT + PICTURE_MOULDING * 2;
      px(PICTURE_X, PICTURE_Y, width, height, "#6a5238");
      px(PICTURE_X, PICTURE_Y, width, 1, "#8a6d4a");
      px(PICTURE_X, PICTURE_Y, 1, height, "#8a6d4a");
      px(PICTURE_X, PICTURE_Y + height - 1, width, 1, "#4a3828");
      px(PICTURE_X + width - 1, PICTURE_Y, 1, height, "#4a3828");
      this.portrait.render(ctx, PICTURE_X + PICTURE_MOULDING, PICTURE_Y + PICTURE_MOULDING);
    }
    // The generations before this one, on the same wall (SPEC §22.10).
    this.familyWall.render(ctx, this.decor.ancestors);
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
   * a hatchling's hat is a hatchling-sized hat, and at this frame's own head
   * anchor (SPEC §10.5) so it sits between the ears wherever the pose put
   * them. An elder's brow tufts stack underneath whatever cosmetic is on top
   * of them (SPEC §21.9). A frame with no anchor has no head to speak of —
   * the egg, the gravestone — and wears nothing.
   */
  private renderHead(ctx: SceneContext, frame: FrameName, scale: number): void {
    const anchor = HEAD_ANCHORS[frame];
    if (!anchor) return;
    layer(ctx, () => {
      ctx.translate(0, PET_Y);
      ctx.scale(scale, scale);
      ctx.translate(anchor.x, anchor.y);
      if (this.stage === "ELDER") this.atlas.draw(ctx, "elderBrows", ELDER_BROWS.x, ELDER_BROWS.y);
      this.renderCosmetic(ctx);
    });
  }

  /**
   * The worn cosmetic, drawn around the head anchor: x = 0 is the column
   * midway between the ears, y = 0 the top of the head outline in the dip,
   * so a hat's base row is y = -1. The crown's band is 27 wide — the width
   * of the front view's dip — so it fills it edge to edge and no ear outline
   * shows beside it.
   */
  private renderCosmetic(ctx: SceneContext): void {
    const hat = this.decor.activeCosmetic;
    if (!hat) return;
    const px = (dx: number, dy: number, w: number, h: number, color: string): void => {
      ctx.fillStyle = color;
      ctx.fillRect(dx, dy, w, h);
    };
    if (hat === "bow") {
      px(-10, -5, 8, 8, "#d9538a");
      px(2, -5, 8, 8, "#d9538a");
      px(-2, -3, 4, 4, "#a83766");
    } else if (hat === "cap") {
      px(-13, -7, 27, 6, "#3b6ea5");
      px(-15, -1, 31, 3, "#2c5480");
    } else if (hat === "crown") {
      px(-13, -7, 27, 7, "#e8c76a");
      px(-13, -13, 5, 6, "#e8c76a");
      px(-2, -13, 5, 6, "#e8c76a");
      px(9, -13, 5, 6, "#e8c76a");
      px(-1, -5, 3, 3, "#d9538a");
    }
  }
}
