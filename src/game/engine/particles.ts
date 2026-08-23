// Pooled particle system (SPEC §10.1): hearts, sparkles, sleep-Zs, crumbs,
// and dust puffs, drawn as chunky pixel dots so they read at the art's own
// resolution. The pool is fixed-size; spawning past capacity recycles the
// oldest — no allocation in the hot path.

import type { SceneContext } from "./digest";

export type ParticleKind = "heart" | "sparkle" | "zzz" | "crumb" | "dust";

type Particle = {
  kind: ParticleKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  ageMs: number;
  lifeMs: number;
  seed: number;
};

const POOL_SIZE = 128;

const COLORS: Record<ParticleKind, string[]> = {
  heart: ["#e2536f", "#f08aa0"],
  sparkle: ["#ffe9a3", "#fff7d6", "#b48ee0"],
  zzz: ["#9b91a8", "#c5bccf"],
  crumb: ["#a97142", "#8a5a33"],
  dust: ["#cfc8d8", "#e6e1ee"],
};

export class Particles {
  private readonly pool: Particle[] = [];
  private cursor = 0;
  /** A deterministic-enough PRNG for visuals only — never game state. */
  private rand = 1234567;

  private random(): number {
    this.rand = (this.rand * 1103515245 + 12345) & 0x7fffffff;
    return this.rand / 0x7fffffff;
  }

  spawn(kind: ParticleKind, x: number, y: number, count: number): void {
    for (let i = 0; i < count; i++) {
      const particle: Particle = {
        kind,
        x: x + (this.random() - 0.5) * 30,
        y: y + (this.random() - 0.5) * 12,
        vx: (this.random() - 0.5) * (kind === "dust" ? 40 : 14),
        vy: kind === "crumb" ? 20 + this.random() * 30 : -(12 + this.random() * 22),
        ageMs: 0,
        lifeMs: 900 + this.random() * 900,
        seed: this.random(),
      };
      if (this.pool.length < POOL_SIZE) {
        this.pool.push(particle);
      } else {
        this.pool[this.cursor % POOL_SIZE] = particle;
        this.cursor += 1;
      }
    }
  }

  update(dtMs: number): void {
    const dt = dtMs / 1000;
    for (const particle of this.pool) {
      particle.ageMs += dtMs;
      particle.x += particle.vx * dt;
      particle.y += particle.vy * dt;
      if (particle.kind === "crumb") particle.vy += 60 * dt; // gravity
      if (particle.kind === "zzz") particle.x += Math.sin(particle.ageMs / 300 + particle.seed * 6) * 0.3;
    }
  }

  render(ctx: SceneContext): void {
    for (const particle of this.pool) {
      if (particle.ageMs >= particle.lifeMs) continue;
      const fade = 1 - particle.ageMs / particle.lifeMs;
      const palette = COLORS[particle.kind];
      ctx.globalAlpha = Math.min(1, fade * 1.6);
      ctx.fillStyle = palette[Math.floor(particle.seed * palette.length)]!;
      const size = particle.kind === "heart" || particle.kind === "zzz" ? 3 : 2;
      ctx.fillRect(Math.round(particle.x), Math.round(particle.y), size, size);
    }
    ctx.globalAlpha = 1;
  }

  clear(): void {
    this.pool.length = 0;
    this.cursor = 0;
  }
}
