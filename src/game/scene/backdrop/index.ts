// The backdrop, assembled (SPEC §22.2). The architecture and its dithered
// gradients are expensive and change only every few minutes, so they compose
// into an offscreen canvas behind a cache key; everything that actually moves
// — the sun crossing the pane, clouds, rain, snow, the twinkle of stars —
// draws over that blit each frame, clipped to the glass.

import type { Celestial, Weather } from "@/sim/atmosphere";
import { keyOf, ROOM_HEIGHT, ROOM_WIDTH, type BackdropKey } from "./compose";
import { venueSpec, type SkyRect } from "./venues";
import { hex, themeFor, type RGB } from "./theme";

export { ROOM_WIDTH, ROOM_HEIGHT, RUG, WINDOW, GLASS, FLOOR_Y, type BackdropKey, type Condition } from "./compose";
export { FREE_VENUES, venueSpec, VENUES, type VenueSpec } from "./venues";
export { themeFor, THEMES } from "./theme";
export { petClock, type PetClock } from "./clock";

const STAR_COUNT = 14;
const CLOUD_DRIFT_MS = 90_000;
const RAIN_DROPS = 26;
const SNOW_FLAKES = 22;
const PANE_DROPS = 3;

type CloudShape = readonly (readonly [number, number])[];

// Three rows of runs: a cloud is a cluster, not a scatter of pixels.
const CLOUD: CloudShape = [
  [2, 3],
  [1, 5],
  [0, 7],
];

const CLOUD_TINT: Record<Weather, { light: RGB; shade: RGB; count: number }> = {
  clear: { light: [246, 248, 252], shade: [206, 216, 236], count: 2 },
  cloudy: { light: [214, 218, 228], shade: [166, 174, 192], count: 4 },
  rain: { light: [150, 156, 172], shade: [110, 116, 134], count: 4 },
  snow: { light: [238, 242, 250], shade: [198, 208, 226], count: 3 },
};

/** A small deterministic hash, so every viewer sees the same sky furniture. */
const hash = (n: number): number => {
  let h = Math.imul(n ^ 0x9e3779b9, 2654435761);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
};

const makeCanvas = (width: number, height: number): HTMLCanvasElement | null => {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
};

export class Backdrop {
  private canvas: HTMLCanvasElement | null = null;
  private cacheKey = "";

  /** Drops the composed image so the next render rebuilds it. */
  invalidate(): void {
    this.cacheKey = "";
  }

  render(
    ctx: CanvasRenderingContext2D,
    key: BackdropKey,
    celestial: Celestial,
    seed: number,
    nowMs: number,
    reducedMotion: boolean,
  ): void {
    const venue = venueSpec(key.venueId);
    const sky = venue.sky;
    this.blitArchitecture(ctx, key);
    // Held still, the room keeps its hour but loses its weather and drift.
    const clock = reducedMotion ? 0 : nowMs;

    ctx.save();
    ctx.beginPath();
    ctx.rect(sky.x, sky.y, sky.w, sky.h);
    ctx.clip();

    const density = venue.weatherDensity;
    if (celestial.body === "moon") this.renderStars(ctx, sky, density, seed, clock, reducedMotion);
    this.renderCelestial(ctx, sky, venue.horizonAt, celestial, key.weather, key.themeId);
    this.renderClouds(ctx, sky, density, key.weather, seed, clock);
    if (key.weather === "rain") this.renderRain(ctx, sky, density, venue.glassPane, seed, clock);
    if (key.weather === "snow") this.renderSnow(ctx, sky, density, seed, clock);

    ctx.restore();

    venue.renderLive?.(ctx, clock);
  }

  private blitArchitecture(ctx: CanvasRenderingContext2D, key: BackdropKey): void {
    const wanted = keyOf(key);
    if (wanted !== this.cacheKey || !this.canvas) {
      const canvas = this.canvas ?? makeCanvas(ROOM_WIDTH, ROOM_HEIGHT);
      const target = canvas?.getContext("2d");
      if (!canvas || !target) return;
      const image = target.createImageData(ROOM_WIDTH, ROOM_HEIGHT);
      image.data.set(venueSpec(key.venueId).compose(key));
      target.putImageData(image, 0, 0);
      this.canvas = canvas;
      this.cacheKey = wanted;
    }
    ctx.drawImage(this.canvas, 0, 0);
  }

  /** Fixed constellations that breathe, rather than a field of noise. */
  private renderStars(
    ctx: CanvasRenderingContext2D,
    sky: SkyRect,
    density: number,
    seed: number,
    nowMs: number,
    reducedMotion: boolean,
  ): void {
    for (let index = 0; index < STAR_COUNT * density; index++) {
      const x = sky.x + Math.floor(hash(seed + index * 31) * sky.w);
      const y = sky.y + Math.floor(hash(seed + index * 57) * (sky.h * 0.62));
      const phase = reducedMotion ? 0.5 : (Math.sin(nowMs / 900 + index * 1.7) + 1) / 2;
      if (phase < 0.25) continue;
      ctx.fillStyle = phase > 0.75 ? "#fdfbf0" : "#c8cbe4";
      ctx.fillRect(x, y, 1, 1);
    }
  }

  /** The sun or the moon, riding its arc across the venue's sky. */
  private renderCelestial(
    ctx: CanvasRenderingContext2D,
    sky: SkyRect,
    horizonAt: (theme: ReturnType<typeof themeFor>, sx: number) => number,
    celestial: Celestial,
    weather: Weather,
    themeId: string,
  ): void {
    // Overcast skies swallow the disc; a hint survives so the hour still reads.
    const veiled = weather === "rain" || weather === "cloudy";
    const x = Math.round(sky.x + 4 + celestial.t * (sky.w - 8));
    const y = Math.round(sky.y + sky.h - 6 - celestial.height * (sky.h - 14));
    // The sun rises from behind the horizon and sets behind it: clip the disc
    // to the sky above whatever stands in its column.
    const horizon = sky.y + sky.h - horizonAt(themeFor(themeId), x - sky.x);
    ctx.save();
    ctx.beginPath();
    ctx.rect(sky.x, sky.y, sky.w, Math.max(0, horizon - sky.y));
    ctx.clip();
    if (celestial.body === "sun") {
      ctx.fillStyle = veiled ? "#c9c6b4" : "#ffe9a8";
      ctx.fillRect(x - 2, y - 1, 5, 3);
      ctx.fillRect(x - 1, y - 2, 3, 5);
      if (!veiled) {
        ctx.fillStyle = "#fff8d8";
        ctx.fillRect(x - 1, y - 1, 3, 3);
      }
      ctx.restore();
      return;
    }
    ctx.fillStyle = veiled ? "#b9bcc8" : "#eef0ff";
    ctx.fillRect(x - 2, y - 1, 5, 3);
    ctx.fillRect(x - 1, y - 2, 3, 5);
    // A bite out of the disc reads as a crescent without another colour.
    ctx.fillStyle = hex(themeFor(themeId).wall[0]);
    ctx.fillRect(x + 1, y - 1, 2, 2);
    ctx.restore();
  }

  private renderClouds(
    ctx: CanvasRenderingContext2D,
    sky: SkyRect,
    density: number,
    weather: Weather,
    seed: number,
    nowMs: number,
  ): void {
    const tint = CLOUD_TINT[weather];
    const span = sky.w + 24;
    for (let index = 0; index < tint.count * density; index++) {
      const drift = (nowMs / (CLOUD_DRIFT_MS * (0.7 + hash(seed + index * 13) * 0.6))) % 1;
      const x = Math.round(sky.x - 12 + ((drift + hash(seed + index * 97)) % 1) * span);
      const y = sky.y + 3 + Math.floor(hash(seed + index * 41) * (sky.h * 0.4));
      const wide = 1 + Math.floor(hash(seed + index * 7) * 2);
      CLOUD.forEach(([offset, width], row) => {
        ctx.fillStyle = hex(row === CLOUD.length - 1 ? tint.shade : tint.light);
        ctx.fillRect(x + offset, y + row, width * wide, 1);
      });
    }
  }

  private renderRain(
    ctx: CanvasRenderingContext2D,
    sky: SkyRect,
    density: number,
    glassPane: boolean,
    seed: number,
    nowMs: number,
  ): void {
    ctx.fillStyle = "#a9bcd8";
    for (let index = 0; index < RAIN_DROPS * density; index++) {
      const speed = 900 + hash(seed + index * 23) * 400;
      const progress = ((nowMs / speed) + hash(seed + index * 71)) % 1;
      const x = sky.x + Math.floor(hash(seed + index * 11) * sky.w) - Math.floor(progress * 4);
      const y = sky.y + Math.floor(progress * sky.h);
      // A streak leans with its fall, one pixel across three.
      ctx.fillRect(x + 1, y, 1, 1);
      ctx.fillRect(x, y + 1, 1, 2);
    }
    // Droplets clinging to the inside of the glass, sliding down slowly.
    if (!glassPane) return;
    ctx.fillStyle = "#cfe0f2";
    for (let index = 0; index < PANE_DROPS; index++) {
      const progress = ((nowMs / (6000 + index * 1700)) + hash(seed + index * 313)) % 1;
      const x = sky.x + 6 + Math.floor(hash(seed + index * 53) * (sky.w - 12));
      const y = sky.y + Math.floor(progress * sky.h);
      ctx.fillRect(x, y, 1, 2);
    }
  }

  private renderSnow(ctx: CanvasRenderingContext2D, sky: SkyRect, density: number, seed: number, nowMs: number): void {
    ctx.fillStyle = "#f2f6ff";
    for (let index = 0; index < SNOW_FLAKES * density; index++) {
      const speed = 5200 + hash(seed + index * 29) * 3400;
      const progress = ((nowMs / speed) + hash(seed + index * 83)) % 1;
      const sway = Math.sin(nowMs / 1400 + index * 2.1) * 3;
      const x = Math.round(sky.x + hash(seed + index * 17) * sky.w + sway);
      const y = sky.y + Math.floor(progress * sky.h);
      ctx.fillRect(x, y, 1, 1);
    }
  }
}
