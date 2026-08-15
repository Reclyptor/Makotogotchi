"use client";

// Dust Dash (SPEC §13.3): a 20-second runner. Makoto jogs; dust bunnies
// tumble in; tap, click, or press space to hop them. Every cleared bunny is
// a point; a collision ends the run. Score reports go up every 2 seconds so
// everyone else can spectate, and the final score scales the joy restored
// plus the coins earned.

import { useCallback, useEffect, useRef, useState } from "react";
import { SPRITE_FRAMES } from "@/game/atlas.generated";

const W = 260;
const H = 120;
const GROUND_Y = 104;
const RUN_MS = 20_000;
const GRAVITY = 640; // px/s²
const JUMP_VELOCITY = -230;

type Bunny = { x: number; passed: boolean };

type Result = { score: number; applied: number; coins: number } | { error: string };

export type DustDashProps = {
  onClose: (finished: boolean) => void;
};

export default function DustDash({ onClose }: DustDashProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [phase, setPhase] = useState<"loading" | "playing" | "reporting" | "done" | "refused">("loading");
  const [finalResult, setFinalResult] = useState<Result | null>(null);
  const scoreRef = useRef(0);
  const inputsRef = useRef(0);

  const finish = useCallback(async (): Promise<void> => {
    setPhase("reporting");
    const response = await fetch("/api/play", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phase: "finish", score: scoreRef.current, inputs: inputsRef.current }),
    }).catch(() => null);
    if (response?.ok) {
      const body = (await response.json()) as { applied: number; coins: number; score: number };
      setFinalResult({ score: body.score, applied: body.applied, coins: body.coins });
    } else {
      setFinalResult({ error: "The result couldn't be recorded." });
    }
    setPhase("done");
  }, []);

  useEffect(() => {
    let disposed = false;

    void (async () => {
      const response = await fetch("/api/play", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phase: "start" }),
      }).catch(() => null);
      if (disposed) return;
      if (!response?.ok) {
        setPhase("refused");
        return;
      }
      setPhase("playing");
    })();

    return () => {
      disposed = true;
    };
  }, []);

  useEffect(() => {
    if (phase !== "playing") return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    const sheet = new Image();
    sheet.src = "/sprites.png";

    let petY = GROUND_Y;
    let petVy = 0;
    let bunnies: Bunny[] = [];
    let nextSpawn = 900;
    let elapsed = 0;
    let lastReport = 0;
    let alive = true;
    let raf = 0;
    let last = performance.now();

    const jump = (): void => {
      inputsRef.current += 1;
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

    const frame = (now: number): void => {
      const dt = Math.min(50, now - last) / 1000;
      last = now;
      elapsed += dt * 1000;

      // Physics.
      petVy += GRAVITY * dt;
      petY = Math.min(GROUND_Y, petY + petVy * dt);
      nextSpawn -= dt * 1000;
      if (nextSpawn <= 0) {
        bunnies.push({ x: W + 20, passed: false });
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
            scoreRef.current += 1;
          }
        }
      }
      bunnies = bunnies.filter((bunny) => bunny.x > -20);

      // Spectator score reports, throttled client-side to the server's guard.
      if (elapsed - lastReport >= 2000) {
        lastReport = elapsed;
        void fetch("/api/play", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ phase: "score", score: scoreRef.current }),
        }).catch(() => null);
      }

      // Render.
      ctx.imageSmoothingEnabled = false;
      ctx.fillStyle = "#1d1825";
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = "#3a3145";
      ctx.fillRect(0, GROUND_Y + 8, W, H - GROUND_Y);
      const jog = SPRITE_FRAMES[elapsed % 300 < 150 ? "jog1" : "jog2"];
      ctx.drawImage(sheet, jog.x, jog.y, jog.w, jog.h, 20, Math.round(petY - 44), 46, 46);
      ctx.fillStyle = "#cfc8d8";
      for (const bunny of bunnies) {
        ctx.beginPath();
        ctx.arc(Math.round(bunny.x), GROUND_Y - 4, 7, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = "#f5f0dc";
      ctx.font = "10px monospace";
      ctx.fillText(`score ${scoreRef.current}`, 8, 14);
      ctx.fillText(`${Math.max(0, Math.ceil((RUN_MS - elapsed) / 1000))}s`, W - 28, 14);

      if (!alive || elapsed >= RUN_MS) {
        canvas.removeEventListener("pointerdown", jump);
        window.removeEventListener("keydown", onKey);
        void finish();
        return;
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      canvas.removeEventListener("pointerdown", jump);
      window.removeEventListener("keydown", onKey);
    };
  }, [phase, finish]);

  return (
    <div role="dialog" aria-label="Dust Dash minigame" className="fixed inset-0 z-10 flex items-center justify-center bg-black/70 p-4">
      <div className="flex w-full max-w-md flex-col items-center gap-3 rounded-xl bg-surface p-4">
        <h2 className="text-sm font-semibold">🎮 Dust Dash</h2>
        {phase === "refused" && (
          <>
            <p className="text-sm text-muted">Makoto can&apos;t play right now (busy, tired, or someone else is playing).</p>
            <button type="button" onClick={() => onClose(false)} className="rounded-md bg-accent/30 px-3 py-1 text-sm">
              Close
            </button>
          </>
        )}
        {(phase === "playing" || phase === "loading" || phase === "reporting") && (
          <>
            <canvas ref={canvasRef} width={W} height={H} className="w-full [image-rendering:pixelated]" />
            <p className="text-xs text-muted">Tap, click, or press space to hop the dust bunnies!</p>
          </>
        )}
        {phase === "done" && finalResult && (
          <>
            {"error" in finalResult ? (
              <p className="text-sm text-rose-300">{finalResult.error}</p>
            ) : (
              <p className="text-sm">
                Scored <strong>{finalResult.score}</strong> — Makoto&apos;s joy +
                {(finalResult.applied / 10_000).toFixed(1)}% · 🪙 +{finalResult.coins}
              </p>
            )}
            <button type="button" onClick={() => onClose(true)} className="rounded-md bg-accent/30 px-3 py-1 text-sm">
              Done
            </button>
          </>
        )}
      </div>
    </div>
  );
}
