// The ancient code's eight seconds (SPEC §26.4). Two moods: confetti over a
// waking room, and a meteor shower for one that is asleep or in mourning.
//
// Everything here is closed-form in the run's elapsed time, and nothing
// mutates while drawing. That is not tidiness: the frame digest (SPEC §10.1)
// replays `paint` twice per frame — once to hash, once to draw — so a
// spectacle that advanced a position or re-rolled a random number on each
// replay would hash differently every frame, repaint constantly, and defeat
// the skip that keeps the room cheap. The whole run is therefore rolled once
// in `start` and only *evaluated* per frame.

import type { SceneContext } from "../engine/digest";
import { ROOM_HEIGHT, ROOM_WIDTH } from "./backdrop";
import type { SpectacleMood } from "@/sim/secret";

/** How long the sky stays open, both moods. */
export const SPECTACLE_MS = 8000;

const CONFETTI_COUNT = 64;
const STAR_COUNT = 40;
const METEOR_COUNT = 14;

const CONFETTI_COLORS = ["#e2536f", "#ffe9a3", "#8fd3f4", "#b48ee0", "#7ddf9a", "#ffa45c"];
/** Six stops the party light cycles through, kept pale — see PARTY_ALPHA. */
const PARTY_HUES = ["#e2536f", "#ffa45c", "#ffe9a3", "#7ddf9a", "#8fd3f4", "#b48ee0"];
const PARTY_ALPHA = 0.1;
const PARTY_HUE_MS = 420;

const STAR_COLORS = ["#fff7d6", "#cfe4ff", "#9fb8e8"];
const NIGHT_WASH = "10, 8, 40";
const NIGHT_ALPHA = 0.75;
const METEOR_HEAD = "#fff7d6";
const METEOR_FLIGHT_MS = 1100;
const METEOR_TAIL = 5;

type Confetti = { x: number; fall: number; drift: number; rate: number; phase: number; delayMs: number; color: string };
type Star = { x: number; y: number; color: string; phase: number };
type Meteor = { x: number; y: number; vx: number; vy: number; delayMs: number; length: number };

/** The same cheap LCG the particle pool uses — visuals only, never state. */
const lcg = (seed: number) => {
  let value = seed | 0 || 1;
  return (): number => {
    value = (value * 1103515245 + 12345) & 0x7fffffff;
    return value / 0x7fffffff;
  };
};

/** Ramp from 0 to 1 across [from, to), clamped outside it. */
const ramp = (value: number, from: number, to: number): number =>
  value <= from ? 0 : value >= to ? 1 : (value - from) / (to - from);

/** The indigo that sinks the room, and lets it back up again (SPEC §26.4). */
const nightAlpha = (age: number): number =>
  NIGHT_ALPHA * ramp(age, 300, 800) * (1 - ramp(age, 7200, SPECTACLE_MS));

/** The starfield trails the wash in and leaves with it. */
const starAlpha = (age: number): number => ramp(age, 800, 1400) * (1 - ramp(age, 7200, SPECTACLE_MS));

/** The party light blinks on quickly and fades out over the last beat. */
const partyAlpha = (age: number): number =>
  PARTY_ALPHA * ramp(age, 0, 200) * (1 - ramp(age, SPECTACLE_MS - 600, SPECTACLE_MS));

export class Spectacle {
  private mood: SpectacleMood = "party";
  private startedMs: number | null = null;
  private confetti: Confetti[] = [];
  private stars: Star[] = [];
  private meteors: Meteor[] = [];
  /** Rolls forward per run so two spectacles never fall identically. */
  private runs = 0;

  /** Opens the sky. Re-entering mid-run restarts it rather than stacking. */
  start(mood: SpectacleMood, nowMs: number): void {
    this.runs += 1;
    this.mood = mood;
    this.startedMs = nowMs;
    const random = lcg(0x5eed ^ (this.runs * 2654435761));
    this.confetti = mood === "party" ? this.rollConfetti(random) : [];
    this.stars = mood === "stars" ? this.rollStars(random) : [];
    this.meteors = mood === "stars" ? this.rollMeteors(random) : [];
  }

  private rollConfetti(random: () => number): Confetti[] {
    return Array.from({ length: CONFETTI_COUNT }, () => ({
      x: random() * ROOM_WIDTH,
      fall: 45 + random() * 50,
      drift: 3 + random() * 9,
      rate: 1.5 + random() * 2.5,
      phase: random() * Math.PI * 2,
      // Spread the fall over most of the run so it never arrives as one sheet.
      delayMs: random() * 3400,
      color: CONFETTI_COLORS[Math.floor(random() * CONFETTI_COLORS.length)]!,
    }));
  }

  private rollStars(random: () => number): Star[] {
    return Array.from({ length: STAR_COUNT }, () => ({
      x: Math.floor(random() * ROOM_WIDTH),
      y: Math.floor(random() * ROOM_HEIGHT),
      color: STAR_COLORS[Math.floor(random() * STAR_COLORS.length)]!,
      phase: random() * Math.PI * 2,
    }));
  }

  private rollMeteors(random: () => number): Meteor[] {
    return Array.from({ length: METEOR_COUNT }, () => {
      const speed = 260 + random() * 170;
      const slope = 0.45 + random() * 0.35;
      const scale = 1 / Math.hypot(1, slope);
      return {
        x: -40 + random() * ROOM_WIDTH * 0.85,
        y: -30 + random() * 70,
        vx: speed * scale,
        vy: speed * slope * scale,
        // The shower starts a beat after the wash and thins before it lifts.
        delayMs: 1000 + random() * 5500,
        length: 4 + random() * 5,
      };
    });
  }

  get active(): boolean {
    return this.startedMs !== null;
  }

  get currentMood(): SpectacleMood {
    return this.mood;
  }

  /**
   * True while a star run owns the dimming. The room's own sleeping dim steps
   * aside for it — both together double-dim, and the scene then comes back to
   * normal in two visible stages instead of one.
   */
  get supersedesNightDim(): boolean {
    return this.startedMs !== null && this.mood === "stars";
  }

  /** Retires a finished run. Belongs with the scene's other state changes,
   *  never inside a paint that gets replayed. */
  advance(nowMs: number): void {
    if (this.startedMs === null) return;
    const age = nowMs - this.startedMs;
    if (age < 0 || age > SPECTACLE_MS) this.startedMs = null;
  }

  private ageAt(nowMs: number): number | null {
    if (this.startedMs === null) return null;
    const age = nowMs - this.startedMs;
    return age < 0 || age > SPECTACLE_MS ? null : age;
  }

  /** The sky: drawn after the decor and *before* the pet, so a meteor passes
   *  at depth and the wash sinks the room without taking the animal with it. */
  renderBehind(ctx: SceneContext, nowMs: number): void {
    const age = this.ageAt(nowMs);
    if (age === null) return;
    if (this.mood === "party") {
      ctx.globalAlpha = partyAlpha(age);
      ctx.fillStyle = PARTY_HUES[Math.floor(age / PARTY_HUE_MS) % PARTY_HUES.length]!;
      ctx.fillRect(0, 0, ROOM_WIDTH, ROOM_HEIGHT);
      ctx.globalAlpha = 1;
      return;
    }
    ctx.fillStyle = `rgba(${NIGHT_WASH}, ${nightAlpha(age).toFixed(3)})`;
    ctx.fillRect(0, 0, ROOM_WIDTH, ROOM_HEIGHT);
    this.renderStars(ctx, age);
    this.renderMeteors(ctx, age);
  }

  private renderStars(ctx: SceneContext, age: number): void {
    const base = starAlpha(age);
    if (base <= 0) return;
    for (const star of this.stars) {
      // Each star breathes on its own phase, so the field never pulses as one.
      const twinkle = 0.55 + 0.45 * Math.sin(age / 420 + star.phase);
      ctx.globalAlpha = base * twinkle;
      ctx.fillStyle = star.color;
      ctx.fillRect(star.x, star.y, 1, 1);
    }
    ctx.globalAlpha = 1;
  }

  private renderMeteors(ctx: SceneContext, age: number): void {
    for (const meteor of this.meteors) {
      const flight = age - meteor.delayMs;
      if (flight < 0 || flight > METEOR_FLIGHT_MS) continue;
      const seconds = flight / 1000;
      const headX = meteor.x + meteor.vx * seconds;
      const headY = meteor.y + meteor.vy * seconds;
      if (headX > ROOM_WIDTH + 8 || headY > ROOM_HEIGHT + 8) continue;
      // The streak dims towards both ends of its flight so it enters and
      // leaves rather than snapping into existence.
      const fade = Math.min(1, ramp(flight, 0, 140) * (1 - ramp(flight, METEOR_FLIGHT_MS - 260, METEOR_FLIGHT_MS)));
      const step = meteor.length / METEOR_TAIL;
      const unit = 1 / Math.hypot(meteor.vx, meteor.vy);
      for (let index = METEOR_TAIL; index >= 0; index--) {
        const back = index * step;
        ctx.globalAlpha = fade * (1 - index / (METEOR_TAIL + 1));
        ctx.fillStyle = METEOR_HEAD;
        const size = index === 0 ? 2 : 1;
        ctx.fillRect(
          Math.round(headX - meteor.vx * unit * back),
          Math.round(headY - meteor.vy * unit * back),
          size,
          size,
        );
      }
    }
    ctx.globalAlpha = 1;
  }

  /** Confetti: in front of everything, because it falls past the camera. */
  renderFront(ctx: SceneContext, nowMs: number): void {
    const age = this.ageAt(nowMs);
    if (age === null || this.mood !== "party") return;
    for (const piece of this.confetti) {
      const seconds = (age - piece.delayMs) / 1000;
      if (seconds < 0) continue;
      const y = -6 + piece.fall * seconds + 12 * seconds * seconds;
      if (y > ROOM_HEIGHT) continue;
      const x = piece.x + Math.sin(seconds * piece.rate + piece.phase) * piece.drift;
      // Tumbling, on a pixel budget: the piece narrows and widens instead of
      // rotating, which is what rotation looks like at this resolution.
      const width = 2 + Math.round(Math.abs(Math.sin(seconds * 4 + piece.phase)) * 2);
      ctx.globalAlpha = 1 - ramp(age, SPECTACLE_MS - 700, SPECTACLE_MS);
      ctx.fillStyle = piece.color;
      ctx.fillRect(Math.round(x), Math.round(y), width, 3);
    }
    ctx.globalAlpha = 1;
  }
}
