"use client";

// Wheel Sprint: a 30-second rhythm game. Makoto runs inside the exercise
// wheel while a spark orbits the ring; tap, click, or press space when the
// spark crosses the top arc to score and build momentum. Momentum spins the
// wheel and the spark faster but decays if you miss or hesitate. The Shell
// owns the server protocol.

import { useEffect, useRef } from "react";
import { drawFrame, drawFrameAnchored, GAME_H, GAME_W, startGameLoop } from "./engine";
import type { GameProps } from "./types";

const RUN_MS = 30_000;
const HUB_X = 130;
const HUB_Y = 64;
const WHEEL_SIZE = 78;
const ORBIT_RADIUS = 46;
// The hit window spans ±28° around 12 o'clock, expressed in radians.
const WINDOW_RAD = (28 * Math.PI) / 180;
const TWO_PI = Math.PI * 2;
// One spark revolution takes 1400ms at rest; momentum shortens it below.
const BASE_ORBIT_MS = 1400;

const WHEEL_FRAMES = ["wheel1", "wheel2", "wheel3"] as const;

export default function WheelSprint({ sheet, reportScore, finish }: GameProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    let score = 0;
    let inputs = 0;
    let momentum = 0;
    let sparkAngle = Math.PI; // Start at 6 o'clock so the first pass is honest.
    let wheelPhase = 0; // Accumulates spin so the spoke animation tracks speed.
    let flashMs = 0;
    let elapsed = 0;

    const tap = (): void => {
      // Every gesture counts as an input, scoring or not, so the server-side
      // inputs >= score invariant holds by construction.
      inputs += 1;
      const wrapped = ((sparkAngle % TWO_PI) + TWO_PI) % TWO_PI;
      const inWindow = wrapped <= WINDOW_RAD || wrapped >= TWO_PI - WINDOW_RAD;
      if (inWindow) {
        score += 1;
        reportScore(score);
        momentum = Math.min(1, momentum + 0.25);
        flashMs = 120;
      } else {
        momentum = Math.max(0, momentum - 0.15);
      }
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.code === "Space") {
        event.preventDefault();
        tap();
      }
    };
    canvas.addEventListener("pointerdown", tap);
    window.addEventListener("keydown", onKey);

    const stop = startGameLoop((dtMs) => {
      const dt = dtMs / 1000;
      elapsed += dtMs;
      flashMs = Math.max(0, flashMs - dtMs);
      momentum = Math.max(0, momentum - 0.06 * dt);

      // Momentum adds 20% orbit speed per quarter of the bar, so a full bar
      // nearly doubles the spark's pace without outrunning a human rhythm.
      const orbitRate = (TWO_PI / (BASE_ORBIT_MS / 1000)) * (1 + 0.8 * momentum);
      sparkAngle += orbitRate * dt;
      // The wheel's spoke animation runs from a lazy 240ms per frame at rest
      // down to 90ms at full momentum; phase accumulates so speed changes
      // never snap the animation backwards.
      wheelPhase += dtMs / (240 - 150 * momentum);

      ctx.imageSmoothingEnabled = false;
      ctx.fillStyle = "#1d1825";
      ctx.fillRect(0, 0, GAME_W, GAME_H);

      const wheelFrame = WHEEL_FRAMES[Math.floor(wheelPhase) % WHEEL_FRAMES.length]!;
      drawFrame(ctx, sheet, wheelFrame, HUB_X - WHEEL_SIZE / 2, HUB_Y - WHEEL_SIZE / 2, WHEEL_SIZE, WHEEL_SIZE);
      drawFrameAnchored(ctx, sheet, elapsed % 300 < 150 ? "jog1" : "jog2", HUB_X, 92, 34);

      // A violet accent ring fades in with momentum, a quiet meter for how
      // hard the wheel is spinning.
      if (momentum > 0) {
        ctx.globalAlpha = momentum;
        ctx.strokeStyle = "#a78bfa";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(HUB_X, HUB_Y, WHEEL_SIZE / 2, 0, TWO_PI);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }

      // The hit window sits at 12 o'clock; it stays faint until a hit lands,
      // then flashes so the player feels the timing connect.
      ctx.globalAlpha = flashMs > 0 ? 1 : 0.25;
      ctx.strokeStyle = flashMs > 0 ? "#fff261" : "#f5f0dc";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(HUB_X, HUB_Y, ORBIT_RADIUS, -Math.PI / 2 - WINDOW_RAD, -Math.PI / 2 + WINDOW_RAD);
      ctx.stroke();
      ctx.globalAlpha = 1;

      const sparkX = HUB_X + ORBIT_RADIUS * Math.sin(sparkAngle);
      const sparkY = HUB_Y - ORBIT_RADIUS * Math.cos(sparkAngle);
      ctx.fillStyle = "#fff261";
      ctx.fillRect(Math.round(sparkX) - 2, Math.round(sparkY) - 2, 4, 4);

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
      canvas.removeEventListener("pointerdown", tap);
      window.removeEventListener("keydown", onKey);
    };
  }, [sheet, reportScore, finish]);

  return <canvas ref={canvasRef} width={GAME_W} height={GAME_H} className="w-full [image-rendering:pixelated]" />;
}
