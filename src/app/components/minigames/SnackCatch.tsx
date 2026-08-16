"use client";

// Snack Catch: 25 seconds of falling food. Steer Makoto with the pointer or
// arrow keys; every caught snack is a point, caught junk costs three. The
// food art comes straight from the atlas's meal frames.

import { useEffect, useRef } from "react";
import type { FrameName } from "@/game/atlas.generated";
import { drawFrame, drawFrameAnchored, GAME_H, GAME_W, startGameLoop } from "./engine";
import type { GameProps } from "./types";

const RUN_MS = 25_000;
const GROUND_Y = 112;
const PET_SPEED = 150; // px/s toward the pointer or held arrow
const CATCH_RANGE_X = 18;
const CATCH_Y = 92;
const JUNK_PENALTY = 3;

const FOODS: readonly FrameName[] = ["fish", "pepper1", "sausage", "pizza", "burger", "onigiri", "bowl", "plate"];
const JUNK: readonly FrameName[] = ["sock1", "rock1"];

type Falling = { frame: FrameName; junk: boolean; x: number; y: number; vy: number };

export default function SnackCatch({ sheet, reportScore, finish }: GameProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    let score = 0;
    let inputs = 0;
    let elapsed = 0;
    let petX = GAME_W / 2;
    let targetX: number | null = null;
    let heldDirection = 0;
    let items: Falling[] = [];
    let nextSpawn = 700;
    let eatUntil = 0; // chomp flash after a catch
    let dizzyUntil = 0; // wobble after junk
    let lastMoveInput = 0;

    const pointerTarget = (event: PointerEvent): void => {
      const rect = canvas.getBoundingClientRect();
      targetX = ((event.clientX - rect.left) / rect.width) * GAME_W;
      // A held drag is one gesture; count it as an input at most 10×/s.
      if (elapsed - lastMoveInput > 100) {
        lastMoveInput = elapsed;
        inputs += 1;
      }
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.code === "ArrowLeft" || event.code === "ArrowRight") {
        event.preventDefault();
        heldDirection = event.code === "ArrowLeft" ? -1 : 1;
        targetX = null;
        inputs += 1;
      }
    };
    const onKeyUp = (event: KeyboardEvent): void => {
      if (event.code === "ArrowLeft" || event.code === "ArrowRight") heldDirection = 0;
    };
    canvas.addEventListener("pointerdown", pointerTarget);
    canvas.addEventListener("pointermove", pointerTarget);
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKeyUp);

    const stop = startGameLoop((dtMs) => {
      const dt = dtMs / 1000;
      elapsed += dtMs;

      // Steering.
      const dizzy = elapsed < dizzyUntil;
      if (!dizzy) {
        if (heldDirection !== 0) petX += heldDirection * PET_SPEED * dt;
        else if (targetX !== null && Math.abs(targetX - petX) > 3) petX += Math.sign(targetX - petX) * PET_SPEED * dt;
      }
      petX = Math.max(20, Math.min(GAME_W - 20, petX));

      // Rain.
      nextSpawn -= dtMs;
      if (nextSpawn <= 0) {
        const junk = Math.random() < 0.22;
        const pool = junk ? JUNK : FOODS;
        items.push({
          frame: pool[Math.floor(Math.random() * pool.length)]!,
          junk,
          x: 20 + Math.random() * (GAME_W - 40),
          y: -10,
          vy: 55 + (elapsed / 1000) * 2 + Math.random() * 15,
        });
        nextSpawn = 900 + Math.random() * 500;
      }
      for (const item of items) {
        item.y += item.vy * dt;
        if (item.y >= CATCH_Y && item.y <= GROUND_Y && Math.abs(item.x - petX) < CATCH_RANGE_X) {
          item.y = GAME_H + 100; // consumed
          if (item.junk) {
            score = Math.max(0, score - JUNK_PENALTY);
            dizzyUntil = elapsed + 700;
          } else {
            score += 1;
            eatUntil = elapsed + 420;
          }
          reportScore(score);
        }
      }
      items = items.filter((item) => item.y < GAME_H + 20);

      // Render.
      ctx.imageSmoothingEnabled = false;
      ctx.fillStyle = "#1d1825";
      ctx.fillRect(0, 0, GAME_W, GAME_H);
      ctx.fillStyle = "#3a3145";
      ctx.fillRect(0, GROUND_Y + 2, GAME_W, GAME_H - GROUND_Y);
      const moving = heldDirection !== 0 || (targetX !== null && Math.abs(targetX - petX) > 3);
      const pose: FrameName = dizzy
        ? "sick1"
        : elapsed < eatUntil
          ? elapsed % 280 < 140
            ? "eat1"
            : "eat2"
          : moving
            ? elapsed % 300 < 150
              ? "jog1"
              : "jog2"
            : "idleFront1";
      drawFrameAnchored(ctx, sheet, pose, petX, GROUND_Y + 4, 44);
      for (const item of items) {
        const size = item.junk ? 16 : 20;
        drawFrame(ctx, sheet, item.frame, item.x - size / 2, item.y - size / 2, size, size);
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
      canvas.removeEventListener("pointerdown", pointerTarget);
      canvas.removeEventListener("pointermove", pointerTarget);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [sheet, reportScore, finish]);

  return <canvas ref={canvasRef} width={GAME_W} height={GAME_H} className="w-full touch-none [image-rendering:pixelated]" />;
}
