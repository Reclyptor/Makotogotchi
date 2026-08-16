"use client";

// Dust Dash: a 20-second runner. Makoto jogs; dust bunnies tumble in; tap,
// click, or press space to hop them. Every cleared bunny is a point; a
// collision ends the run. The Shell owns the server protocol.

import { useEffect, useRef } from "react";
import { drawFrameAnchored, GAME_H, GAME_W, startGameLoop } from "./engine";
import type { GameProps } from "./types";

const GROUND_Y = 104;
const RUN_MS = 20_000;
const GRAVITY = 640; // px/s²
const JUMP_VELOCITY = -230;

type Bunny = { x: number; passed: boolean };

export default function DustDash({ sheet, reportScore, finish }: GameProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    let score = 0;
    let inputs = 0;
    let petY = GROUND_Y;
    let petVy = 0;
    let bunnies: Bunny[] = [];
    let nextSpawn = 900;
    let elapsed = 0;
    let alive = true;

    const jump = (): void => {
      inputs += 1;
      if (petY >= GROUND_Y) petVy = JUMP_VELOCITY;
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.code === "Space" || event.code === "ArrowUp") {
        event.preventDefault();
        jump();
      }
    };
    canvas.addEventListener("pointerdown", jump);
    window.addEventListener("keydown", onKey);

    const stop = startGameLoop((dtMs) => {
      const dt = dtMs / 1000;
      elapsed += dtMs;

      petVy += GRAVITY * dt;
      petY = Math.min(GROUND_Y, petY + petVy * dt);
      nextSpawn -= dtMs;
      if (nextSpawn <= 0) {
        bunnies.push({ x: GAME_W + 20, passed: false });
        nextSpawn = 1000 + Math.random() * 900;
      }
      const speed = 120 + (elapsed / RUN_MS) * 60;
      for (const bunny of bunnies) {
        bunny.x -= speed * dt;
        if (!bunny.passed && bunny.x < 46) {
          // Collision window: bunny at the pet while the pet is grounded.
          if (petY >= GROUND_Y - 14) {
            alive = false;
          } else {
            bunny.passed = true;
            score += 1;
            reportScore(score);
          }
        }
      }
      bunnies = bunnies.filter((bunny) => bunny.x > -20);

      ctx.imageSmoothingEnabled = false;
      ctx.fillStyle = "#1d1825";
      ctx.fillRect(0, 0, GAME_W, GAME_H);
      ctx.fillStyle = "#3a3145";
      ctx.fillRect(0, GROUND_Y + 8, GAME_W, GAME_H - GROUND_Y);
      drawFrameAnchored(ctx, sheet, elapsed % 300 < 150 ? "jog1" : "jog2", 43, Math.round(petY + 2), 46);
      ctx.fillStyle = "#cfc8d8";
      for (const bunny of bunnies) {
        ctx.beginPath();
        ctx.arc(Math.round(bunny.x), GROUND_Y - 4, 7, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = "#f5f0dc";
      ctx.font = "10px monospace";
      ctx.fillText(`score ${score}`, 8, 14);
      ctx.fillText(`${Math.max(0, Math.ceil((RUN_MS - elapsed) / 1000))}s`, GAME_W - 28, 14);

      if (!alive || elapsed >= RUN_MS) {
        stop();
        finish(score, inputs);
      }
    });

    return () => {
      stop();
      canvas.removeEventListener("pointerdown", jump);
      window.removeEventListener("keydown", onKey);
    };
  }, [sheet, reportScore, finish]);

  return <canvas ref={canvasRef} width={GAME_W} height={GAME_H} className="w-full [image-rendering:pixelated]" />;
}
