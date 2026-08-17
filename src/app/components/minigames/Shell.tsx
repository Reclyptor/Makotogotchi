"use client";

// The minigame shell (SPEC §13.3): one dialog that owns the whole
// start → play → finish protocol against /api/play, so each game component
// is nothing but a canvas and its mechanics. The chosen game is named at
// start and pinned server-side; the Shell loads the sprite sheet before the
// game mounts so no game ever renders an empty run.
//
// It also owns the crowd noise (SPEC §21.6): while a run is live, every
// reaction the room sends floats up over the canvas. The overlay is plain
// DOM sitting above the game — no game component ever learns it exists.

import { useCallback, useEffect, useRef, useState } from "react";
import { MINIGAMES, type MinigameId } from "@/sim/minigames";
import { loadSpriteSheet } from "@/game/engine/atlas";
import { SPRITE_SHEET_URL } from "@/game/atlas.generated";
import type { ReactNotice } from "@/app/hooks/usePetStream";
import { GAMES } from "./registry";

const SCORE_BROADCAST_MS = 2000;

// Cheers float for this long, and never more than this many at once — past
// the cap the extras drop silently rather than burying the game.
const CHEER_LIFE_MS = 2500;
const CHEER_CAP = 6;

type Cheer = { id: number; emoji: string; leftPercent: number };

type Result = { score: number; applied: number; coins: number } | { error: string };

export type ShellProps = {
  gameId: MinigameId;
  onClose: (finished: boolean) => void;
  /** The room's live reactions, which become crowd noise while playing. */
  onReact: (listener: (notice: ReactNotice) => void) => () => void;
};

export default function Shell({ gameId, onClose, onReact }: ShellProps) {
  const def = MINIGAMES[gameId];
  const game = GAMES[gameId];
  const [phase, setPhase] = useState<"loading" | "playing" | "reporting" | "done" | "refused">("loading");
  const [result, setResult] = useState<Result | null>(null);
  const [sheet, setSheet] = useState<HTMLImageElement | null>(null);
  const [cheers, setCheers] = useState<Cheer[]>([]);
  const scoreRef = useRef(0);
  const cheerIdRef = useRef(0);
  const finishedRef = useRef(false);

  // Start the run and load the sheet together; play begins when both land.
  useEffect(() => {
    let disposed = false;
    void (async () => {
      const [response, image] = await Promise.all([
        fetch("/api/play", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ phase: "start", game: gameId }),
        }).catch(() => null),
        loadSpriteSheet(SPRITE_SHEET_URL),
      ]);
      if (disposed) return;
      if (!response?.ok || !image) {
        setPhase("refused");
        return;
      }
      setSheet(image);
      setPhase("playing");
    })();
    return () => {
      disposed = true;
    };
  }, [gameId]);

  // Broadcast the latest score at the server guard's cadence while playing.
  useEffect(() => {
    if (phase !== "playing") return;
    const interval = setInterval(() => {
      void fetch("/api/play", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phase: "score", score: scoreRef.current }),
      }).catch(() => null);
    }, SCORE_BROADCAST_MS);
    return () => clearInterval(interval);
  }, [phase]);

  // Crowd noise only while there is a run to cheer for.
  useEffect(() => {
    if (phase !== "playing") return;
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const off = onReact((notice) => {
      cheerIdRef.current += 1;
      const id = cheerIdRef.current;
      // Fan the floaters across the canvas by arrival order — no randomness
      // needed, and consecutive cheers never stack on one another.
      const cheer: Cheer = { id, emoji: notice.emoji, leftPercent: 6 + ((id * 37) % 82) };
      setCheers((current) => (current.length >= CHEER_CAP ? current : [...current, cheer]));
      const timer = setTimeout(() => {
        timers.delete(timer);
        setCheers((current) => current.filter((entry) => entry.id !== id));
      }, CHEER_LIFE_MS);
      timers.add(timer);
    });
    return () => {
      off();
      for (const timer of timers) clearTimeout(timer);
      setCheers([]);
    };
  }, [phase, onReact]);

  const reportScore = useCallback((score: number) => {
    scoreRef.current = score;
  }, []);

  const finish = useCallback(async (score: number, inputs: number): Promise<void> => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    scoreRef.current = score;
    setPhase("reporting");
    const response = await fetch("/api/play", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phase: "finish", score, inputs }),
    }).catch(() => null);
    if (response?.ok) {
      const body = (await response.json()) as { applied: number; coins: number; score: number };
      setResult({ score: body.score, applied: body.applied, coins: body.coins });
    } else {
      const body = (await response?.json().catch(() => null)) as { error?: string; reason?: string } | null;
      setResult({
        error:
          body?.error === "implausible"
            ? "That run didn't look right — the score wasn't counted."
            : body?.reason === "COOLDOWN_GLOBAL" || body?.reason === "COOLDOWN_CARETAKER"
              ? "Makoto is worn out from playing — the joy didn't count this time."
              : body?.error === "no_session"
                ? "The game session expired before the result arrived."
                : "The result couldn't be recorded.",
      });
    }
    setPhase("done");
  }, []);

  const Game = game.Component;
  return (
    <div
      role="dialog"
      aria-label={`${def.title} minigame`}
      className="fixed inset-0 z-10 flex items-center justify-center bg-black/70 p-4"
    >
      <div className="panel animate-pop flex w-full max-w-md flex-col items-center gap-3 !rounded-2xl p-5">
        <h2 className="text-sm font-semibold">
          {def.emoji} {def.title}
        </h2>
        {phase === "refused" && (
          <>
            <p className="text-sm text-muted">Makoto can&apos;t play right now (busy, tired, or someone else is playing).</p>
            <button
              type="button"
              onClick={() => onClose(false)}
              className="press rounded-lg bg-accent-strong px-4 py-1.5 text-sm font-semibold text-white"
            >
              Close
            </button>
          </>
        )}
        {(phase === "playing" || phase === "loading" || phase === "reporting") && (
          <>
            <div className="relative w-full">
              {phase === "playing" && sheet ? (
                <Game sheet={sheet} reportScore={reportScore} finish={finish} />
              ) : (
                <p className="text-sm text-muted">{phase === "reporting" ? "Recording the result…" : "Warming up…"}</p>
              )}
              {cheers.map((cheer) => (
                <span
                  key={cheer.id}
                  className="animate-rise pointer-events-none absolute bottom-1 text-2xl drop-shadow-[0_2px_6px_rgba(0,0,0,0.6)]"
                  style={{ left: `${cheer.leftPercent}%` }}
                >
                  {cheer.emoji}
                </span>
              ))}
            </div>
            <p className="text-xs text-muted">{game.hint}</p>
          </>
        )}
        {phase === "done" && result && (
          <>
            {"error" in result ? (
              <p className="text-sm text-rose-300">{result.error}</p>
            ) : (
              <p className="text-sm">
                Scored <strong>{result.score}</strong> — Makoto&apos;s joy +{(result.applied / 10_000).toFixed(1)}% · 🪙 +
                {result.coins}
              </p>
            )}
            <button
              type="button"
              onClick={() => onClose(true)}
              className="press rounded-lg bg-accent-strong px-4 py-1.5 text-sm font-semibold text-white"
            >
              Done
            </button>
          </>
        )}
      </div>
    </div>
  );
}
