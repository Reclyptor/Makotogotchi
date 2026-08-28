"use client";

// Bubble Bath Pop: 25 seconds of Makoto's dust bath foaming over. Bubbles
// drift up from the bath; tap one to pop it for a point, or press Space to
// pop whichever bubble is closest to escaping off the top.

import { useEffect, useRef } from "react";
import type { FrameName } from "@/game/atlas.generated";
import { drawFrame, drawFrameAnchored, GAME_H, GAME_W, startGameLoop } from "./engine";
import type { GameProps } from "./types";

const RUN_MS = 25_000;
// Eight on screen at once caps the pop rate well under the server's 3/s
// envelope even for a perfect player.
const MAX_BUBBLES = 8;
const TAP_SLOP = 6; // extra px of forgiveness around a bubble's radius
const BURST_FRAME_MS = 120; // bubblePop1 then bubblePop2, each this long
const BURST_SIZE = 20;
const SWAY_AMP = 6;

// Small bubbles ride the updraft a touch faster than big ones.
const TIERS: readonly { frame: FrameName; size: number; extraVy: number }[] = [
  { frame: "bubble1", size: 10, extraVy: 7 },
  { frame: "bubble2", size: 16, extraVy: 3 },
  { frame: "bubble3", size: 22, extraVy: 0 },
];

type Bubble = {
  frame: FrameName;
  size: number;
  originX: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  swayFreq: number;
  swayPhase: number;
  ageMs: number;
};

type Burst = { x: number; y: number; ageMs: number };

export default function BubblePop({ sheet, reportScore, finish }: GameProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    let score = 0;
    let inputs = 0;
    let elapsed = 0;
    let bubbles: Bubble[] = [];
    let bursts: Burst[] = [];
    let nextSpawn = 500;

    const pop = (index: number): void => {
      const bubble = bubbles[index]!;
      bubbles.splice(index, 1);
      bursts.push({ x: bubble.x, y: bubble.y, ageMs: 0 });
      score += 1;
      reportScore(score);
    };

    // Every pointerdown counts as an input even on a miss, which keeps the
    // recorded inputs ≥ score for the server's plausibility check.
    const onPointerDown = (event: PointerEvent): void => {
      if (!armed()) return;
      inputs += 1;
      const rect = canvas.getBoundingClientRect();
      const tapX = ((event.clientX - rect.left) / rect.width) * GAME_W;
      const tapY = ((event.clientY - rect.top) / rect.height) * GAME_H;
      // Walk back-to-front so overlapping bubbles pop the one drawn on top.
      for (let i = bubbles.length - 1; i >= 0; i -= 1) {
        const bubble = bubbles[i]!;
        const reach = bubble.size / 2 + TAP_SLOP;
        if (Math.hypot(bubble.x - tapX, bubble.y - tapY) <= reach) {
          pop(i);
          return;
        }
      }
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.code !== "Space") return;
      event.preventDefault();
      if (!armed()) return;
      inputs += 1;
      let best = -1;
      for (let i = 0; i < bubbles.length; i += 1) {
        if (best === -1 || bubbles[i]!.y < bubbles[best]!.y) best = i;
      }
      if (best !== -1) pop(best);
    };
    canvas.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKey);

    const { stop, armed } = startGameLoop((dtMs) => {
      elapsed += dtMs;

      // The bath keeps foaming as long as there is room on screen.
      nextSpawn -= dtMs;
      if (nextSpawn <= 0) {
        if (bubbles.length < MAX_BUBBLES) {
          const tier = TIERS[Math.floor(Math.random() * TIERS.length)]!;
          bubbles.push({
            frame: tier.frame,
            size: tier.size,
            originX: 20 + Math.random() * 50,
            x: 0,
            y: GAME_H - 8 - Math.random() * 6,
            vx: 6 + Math.random() * 14,
            vy: -(28 + Math.random() * 10 + tier.extraVy),
            swayFreq: 2 + Math.random() * 2,
            swayPhase: Math.random() * Math.PI * 2,
            ageMs: 0,
          });
        }
        nextSpawn = 450 + Math.random() * 350;
      }
      for (const bubble of bubbles) {
        bubble.ageMs += dtMs;
        const age = bubble.ageMs / 1000;
        bubble.y += bubble.vy * (dtMs / 1000);
        bubble.x = bubble.originX + bubble.vx * age + Math.sin(age * bubble.swayFreq + bubble.swayPhase) * SWAY_AMP;
      }
      // Escaping off the top costs nothing; the bubble just floats away.
      bubbles = bubbles.filter((bubble) => bubble.y > -bubble.size);
      for (const burst of bursts) burst.ageMs += dtMs;
      bursts = bursts.filter((burst) => burst.ageMs < BURST_FRAME_MS * 2);

      // Render.
      ctx.imageSmoothingEnabled = false;
      ctx.fillStyle = "#1d1825";
      ctx.fillRect(0, 0, GAME_W, GAME_H);
      const bathPose: FrameName = (["dustbath1", "dustbath2", "dustbath3"] as const)[Math.floor(elapsed / 450) % 3]!;
      drawFrameAnchored(ctx, sheet, bathPose, 36, GAME_H - 2, 46);
      for (const bubble of bubbles) {
        drawFrame(ctx, sheet, bubble.frame, bubble.x - bubble.size / 2, bubble.y - bubble.size / 2, bubble.size, bubble.size);
      }
      for (const burst of bursts) {
        const frame: FrameName = burst.ageMs < BURST_FRAME_MS ? "bubblePop1" : "bubblePop2";
        drawFrame(ctx, sheet, frame, burst.x - BURST_SIZE / 2, burst.y - BURST_SIZE / 2, BURST_SIZE, BURST_SIZE);
      }
      ctx.fillStyle = "#f5f0dc";
      ctx.font = "10px monospace";
      ctx.fillText(`score ${score}`, 8, 14);
      ctx.fillText(`${Math.max(0, Math.ceil((RUN_MS - elapsed) / 1000))}s`, GAME_W - 28, 14);

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
