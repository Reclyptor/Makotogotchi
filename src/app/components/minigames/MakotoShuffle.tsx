"use client";

// Makoto Shuffle: the shell game. Makoto sits under one of three overturned
// bowls, they swap in pairs, and the player picks. Every round adds a swap and
// tightens the pace; a wrong pick ends the run, so the tension is cumulative.
// The bowls are the atlas's food bowl, flipped.

import { useEffect, useRef } from "react";
import type { FrameName } from "@/game/atlas.generated";
import { drawFrameAnchored, drawFrameFlipped, GAME_H, GAME_W, startGameLoop } from "./engine";
import type { GameProps } from "./types";

const RUN_MS = 80_000; // hard stop, comfortably inside the 90s envelope
const MAX_ROUNDS = 12;

const SLOT_X = [62, 130, 198] as const;
const FLOOR_Y = 100;
const BOWL_W = 54;
const BOWL_H = 40;
const LIFT = 34; // how far a bowl rises to show what is under it
const PET_H = 34;

const PEEK_MS = 1000;
const LOWER_MS = 320;
const REVEAL_MS = 1000;
// Swaps start leisurely and tighten every round, but never past what an eye
// can follow.
const swapMs = (round: number): number => Math.max(230, 520 - round * 26);
const swapsFor = (round: number): number => 2 + round;

type Stage = "peek" | "lower" | "swap" | "choose" | "reveal";
/** A bowl's identity is its index; `slot` is which of the three spots it sits in. */
type Bowl = { slot: number };

const lerp = (from: number, to: number, t: number): number => from + (to - from) * t;

export default function MakotoShuffle({ sheet, reportScore, finish }: GameProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    let score = 0;
    let inputs = 0;
    let elapsed = 0;
    let round = 1;
    let stage: Stage = "peek";
    let stageMs = 0;
    let bowls: Bowl[] = [{ slot: 0 }, { slot: 1 }, { slot: 2 }];
    let hiding = 1; // the bowl Makoto is under
    let pending: [number, number][] = []; // swaps still to run this round
    let swapping: [number, number] | null = null;
    let swapFrom: [number, number] = [0, 0];
    let picked: number | null = null;
    let correct = false;

    const startRound = (): void => {
      // Reshuffling the slots between rounds means the pet is not always
      // revealed in the middle, so the peek carries real information.
      const slots = [0, 1, 2].sort(() => Math.random() - 0.5);
      bowls = slots.map((slot) => ({ slot }));
      hiding = Math.floor(Math.random() * 3);
      picked = null;
      pending = [];
      for (let i = 0; i < swapsFor(round); i += 1) {
        const a = Math.floor(Math.random() * 3);
        // Pick a partner that is not the same bowl; either of the other two.
        const b = (a + 1 + Math.floor(Math.random() * 2)) % 3;
        pending.push([a, b]);
      }
      stage = "peek";
      stageMs = 0;
    };

    const nextSwap = (): void => {
      const next = pending.shift();
      if (!next) {
        swapping = null;
        stage = "choose";
        stageMs = 0;
        return;
      }
      swapping = next;
      swapFrom = [bowls[next[0]]!.slot, bowls[next[1]]!.slot];
      stageMs = 0;
    };

    const pick = (slot: number): void => {
      if (stage !== "choose" || !armed()) return;
      inputs += 1;
      picked = bowls.findIndex((bowl) => bowl.slot === slot);
      correct = picked === hiding;
      if (correct) {
        score += 1;
        reportScore(score);
      }
      stage = "reveal";
      stageMs = 0;
    };

    const onPointerDown = (event: PointerEvent): void => {
      const rect = canvas.getBoundingClientRect();
      const x = ((event.clientX - rect.left) / rect.width) * GAME_W;
      let best = 0;
      for (let slot = 1; slot < SLOT_X.length; slot += 1) {
        if (Math.abs(SLOT_X[slot]! - x) < Math.abs(SLOT_X[best]! - x)) best = slot;
      }
      pick(best);
    };
    const KEY_SLOTS: Record<string, number> = {
      Digit1: 0,
      Digit2: 1,
      Digit3: 2,
      ArrowLeft: 0,
      ArrowDown: 1,
      ArrowRight: 2,
    };
    const onKey = (event: KeyboardEvent): void => {
      const slot = KEY_SLOTS[event.code];
      if (slot === undefined) return;
      event.preventDefault();
      pick(slot);
    };
    canvas.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKey);

    // Lay the first round out before the loop starts, so the pre-roll freezes
    // on the opening peek instead of on an empty floor.
    startRound();

    const { stop, armed } = startGameLoop((dtMs) => {
      elapsed += dtMs;
      stageMs += dtMs;

      // Advance the round's state machine.
      if (stage === "peek" && stageMs >= PEEK_MS) {
        stage = "lower";
        stageMs = 0;
      } else if (stage === "lower" && stageMs >= LOWER_MS) {
        stage = "swap";
        nextSwap();
      } else if (stage === "swap" && swapping && stageMs >= swapMs(round)) {
        const [a, b] = swapping;
        bowls[a]!.slot = swapFrom[1];
        bowls[b]!.slot = swapFrom[0];
        nextSwap();
      } else if (stage === "reveal" && stageMs >= REVEAL_MS) {
        if (correct && round < MAX_ROUNDS) {
          round += 1;
          startRound();
        } else {
          stop();
          finish(score, inputs);
          return;
        }
      }

      // How high each bowl is riding, and where.
      const raise = (bowl: number): number => {
        if (stage === "peek") return LIFT;
        if (stage === "lower") return LIFT * (1 - stageMs / LOWER_MS);
        // The reveal lifts the picked bowl, and on a miss the one that was
        // hiding him too — losing without seeing where he was is no fun.
        if (stage === "reveal" && (bowl === picked || (!correct && bowl === hiding))) {
          return LIFT * Math.min(1, stageMs / 200);
        }
        return 0;
      };
      const positionX = (bowl: number): number => {
        if (stage !== "swap" || !swapping) return SLOT_X[bowls[bowl]!.slot]!;
        const t = Math.min(1, stageMs / swapMs(round));
        if (bowl === swapping[0]) return lerp(SLOT_X[swapFrom[0]]!, SLOT_X[swapFrom[1]]!, t);
        if (bowl === swapping[1]) return lerp(SLOT_X[swapFrom[1]]!, SLOT_X[swapFrom[0]]!, t);
        return SLOT_X[bowls[bowl]!.slot]!;
      };
      // The bowl passing in front arcs up so the pair never simply overlaps.
      const arc = (bowl: number): number => {
        if (stage !== "swap" || !swapping || bowl !== swapping[0]) return 0;
        return Math.sin(Math.min(1, stageMs / swapMs(round)) * Math.PI) * 14;
      };

      ctx.imageSmoothingEnabled = false;
      ctx.fillStyle = "#1d1825";
      ctx.fillRect(0, 0, GAME_W, GAME_H);
      ctx.fillStyle = "#3a3145";
      ctx.fillRect(0, FLOOR_Y, GAME_W, GAME_H - FLOOR_Y);

      // Makoto shows during the peek and the reveal; the rest of the round he
      // is under a bowl and the player is on their own.
      const petVisible = stage === "peek" || stage === "lower" || (stage === "reveal" && raise(hiding) > 0);
      if (petVisible) {
        const pose: FrameName =
          stage === "reveal" ? (correct ? (stageMs % 320 < 160 ? "cheer1" : "cheer2") : "cry1") : "idleFront1";
        drawFrameAnchored(ctx, sheet, pose, SLOT_X[bowls[hiding]!.slot]!, FLOOR_Y + 2, PET_H);
      }

      for (let bowl = 0; bowl < bowls.length; bowl += 1) {
        const x = positionX(bowl) - BOWL_W / 2;
        const y = FLOOR_Y - BOWL_H - raise(bowl) - arc(bowl);
        drawFrameFlipped(ctx, sheet, "bowl", x, y, BOWL_W, BOWL_H);
      }

      ctx.fillStyle = "#f5f0dc";
      ctx.font = "10px monospace";
      ctx.fillText(`score ${score}`, 8, 14);
      ctx.fillText(`round ${round}`, GAME_W - 58, 14);
      if (stage === "choose") {
        ctx.fillStyle = "#fff261";
        ctx.fillText("which bowl?", GAME_W / 2 - 32, 14);
      }

      if (elapsed >= RUN_MS) {
        stop();
        finish(score, inputs);
      }
    });

    return () => {
      stop();
      canvas.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [sheet, reportScore, finish]);

  return <canvas ref={canvasRef} width={GAME_W} height={GAME_H} className="w-full touch-none [image-rendering:pixelated]" />;
}
