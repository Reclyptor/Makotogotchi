// Synthesized chiptune audio (SPEC §11.5): square-wave blips per care
// action, a distinct two-tone alarm, and a barely-there ambient pad. No
// assets, no library — a handful of oscillators. Muted by default; the
// toggle persists. The AudioContext is created lazily on first unmute so we
// never fight autoplay policies.

import type { CareAction } from "@/sim/tuning";
import type { SpectacleMood } from "@/sim/secret";

const STORAGE_KEY = "mgc-audio";

type Note = { freq: number; atMs: number; durMs: number };

const ACTION_TUNES: Record<CareAction, Note[]> = {
  FEED: [
    { freq: 523, atMs: 0, durMs: 70 },
    { freq: 659, atMs: 80, durMs: 70 },
    { freq: 784, atMs: 160, durMs: 110 },
  ],
  PLAY: [
    { freq: 660, atMs: 0, durMs: 60 },
    { freq: 880, atMs: 70, durMs: 60 },
    { freq: 660, atMs: 140, durMs: 60 },
    { freq: 990, atMs: 210, durMs: 90 },
  ],
  CLEAN: [
    { freq: 392, atMs: 0, durMs: 90 },
    { freq: 523, atMs: 100, durMs: 90 },
    { freq: 392, atMs: 200, durMs: 90 },
  ],
  PET: [
    { freq: 784, atMs: 0, durMs: 60 },
    { freq: 1046, atMs: 70, durMs: 120 },
  ],
  LULLABY: [
    { freq: 659, atMs: 0, durMs: 160 },
    { freq: 587, atMs: 180, durMs: 160 },
    { freq: 523, atMs: 360, durMs: 240 },
  ],
  MEDICATE: [
    { freq: 440, atMs: 0, durMs: 80 },
    { freq: 554, atMs: 90, durMs: 80 },
    { freq: 659, atMs: 180, durMs: 140 },
  ],
};

// The ancient code (SPEC §26.4). The party is a rising fanfare; the star
// shower borrows the ambient pad's triangle wave and sits well under it, so
// it reads as the room breathing rather than as an alert.
const SECRET_TUNES: Record<SpectacleMood, { notes: Note[]; volume: number; wave: OscillatorType }> = {
  party: {
    notes: [
      { freq: 523, atMs: 0, durMs: 70 },
      { freq: 659, atMs: 70, durMs: 70 },
      { freq: 784, atMs: 140, durMs: 70 },
      { freq: 1046, atMs: 210, durMs: 90 },
      { freq: 880, atMs: 320, durMs: 70 },
      { freq: 1046, atMs: 400, durMs: 90 },
      { freq: 1318, atMs: 500, durMs: 220 },
    ],
    volume: 0.1,
    wave: "square",
  },
  stars: {
    notes: [
      { freq: 262, atMs: 0, durMs: 900 },
      { freq: 392, atMs: 300, durMs: 900 },
      { freq: 523, atMs: 700, durMs: 900 },
      { freq: 659, atMs: 1200, durMs: 1100 },
      { freq: 784, atMs: 1800, durMs: 1400 },
    ],
    volume: 0.05,
    wave: "triangle",
  },
};

const ALERT_TUNE: Note[] = [
  { freq: 880, atMs: 0, durMs: 140 },
  { freq: 622, atMs: 160, durMs: 140 },
  { freq: 880, atMs: 320, durMs: 140 },
  { freq: 622, atMs: 480, durMs: 200 },
];

export class GameAudio {
  private context: AudioContext | null = null;
  private ambientGain: GainNode | null = null;
  private ambientOscillators: OscillatorNode[] = [];
  private mutedState: boolean;

  constructor() {
    this.mutedState = typeof localStorage === "undefined" || localStorage.getItem(STORAGE_KEY) !== "on";
  }

  get muted(): boolean {
    return this.mutedState;
  }

  setMuted(muted: boolean): void {
    this.mutedState = muted;
    try {
      localStorage.setItem(STORAGE_KEY, muted ? "off" : "on");
    } catch {
      // Private-mode storage failures only cost persistence.
    }
    if (muted) {
      this.stopAmbient();
    } else {
      this.startAmbient();
    }
  }

  private ensureContext(): AudioContext {
    this.context ??= new AudioContext();
    if (this.context.state === "suspended") void this.context.resume();
    return this.context;
  }

  private play(notes: Note[], volume: number, wave: OscillatorType = "square"): void {
    if (this.mutedState) return;
    const ctx = this.ensureContext();
    const now = ctx.currentTime;
    for (const note of notes) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = wave;
      osc.frequency.value = note.freq;
      const start = now + note.atMs / 1000;
      const end = start + note.durMs / 1000;
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(volume, start + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.0001, end);
      osc.connect(gain).connect(ctx.destination);
      osc.start(start);
      osc.stop(end + 0.02);
    }
  }

  playAction(action: CareAction): void {
    this.play(ACTION_TUNES[action], 0.08);
  }

  playAlert(): void {
    this.play(ALERT_TUNE, 0.12);
  }

  playSecret(mood: SpectacleMood): void {
    const tune = SECRET_TUNES[mood];
    this.play(tune.notes, tune.volume, tune.wave);
  }

  private startAmbient(): void {
    if (this.ambientGain) return;
    const ctx = this.ensureContext();
    const gain = ctx.createGain();
    gain.gain.value = 0.015;
    // A soft detuned fifth, slowly breathing via an LFO on the gain.
    for (const freq of [131, 196]) {
      const osc = ctx.createOscillator();
      osc.type = "triangle";
      osc.frequency.value = freq;
      osc.connect(gain);
      osc.start();
      this.ambientOscillators.push(osc);
    }
    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();
    lfo.frequency.value = 0.07;
    lfoGain.gain.value = 0.008;
    lfo.connect(lfoGain).connect(gain.gain);
    lfo.start();
    this.ambientOscillators.push(lfo);
    gain.connect(ctx.destination);
    this.ambientGain = gain;
  }

  private stopAmbient(): void {
    for (const osc of this.ambientOscillators) osc.stop();
    this.ambientOscillators = [];
    this.ambientGain?.disconnect();
    this.ambientGain = null;
  }
}
