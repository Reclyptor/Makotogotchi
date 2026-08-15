"use client";

// The living room: canvas scene driven by the pet stream. The canvas is
// decorative (aria-hidden) — every meaningful signal it shows also exists as
// semantic HTML in the surrounding UI (SPEC §10.4, §11.3).

import { useEffect, useRef } from "react";
import { derive } from "@/sim/derive";
import type { CareAction } from "@/sim/tuning";
import { Room, ROOM_HEIGHT, ROOM_WIDTH } from "@/game/scene/room";
import { startLoop } from "@/game/engine/loop";
import type { PetStream } from "@/app/hooks/usePetStream";

const ACTION_EMOJI: Record<CareAction, string> = {
  FEED: "🍖",
  PLAY: "🎮",
  CLEAN: "🌪️",
  PET: "💛",
  LULLABY: "🎵",
  MEDICATE: "💊",
};

const MILESTONE_LABELS: Record<string, string> = {
  BECAME_SICK: "Makoto got sick!",
  RECOVERED: "All better!",
  SLEPT: "zzz…",
  WOKE: "Good morning!",
  DIED: "Makoto has died.",
  EVOLVED: "Makoto evolved!",
};

export type PetCanvasProps = {
  stream: PetStream;
};

export default function PetCanvas({ stream }: PetCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const { projectNow, onCare, onMilestone, onMinigame, caretakerId, room: roomView } = stream;
  const roomViewRef = useRef(roomView);
  useEffect(() => {
    roomViewRef.current = roomView;
  }, [roomView]);
  const caretakerRef = useRef<string | null>(null);
  useEffect(() => {
    caretakerRef.current = caretakerId;
  }, [caretakerId]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    const room = new Room();
    void room.atlas.load("/sprites.png");

    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    room.reducedMotion = media.matches;
    const onMotionChange = (event: MediaQueryListEvent): void => {
      room.reducedMotion = event.matches;
    };
    media.addEventListener("change", onMotionChange);

    const offCare = onCare((notice) => {
      const who =
        notice.caretakerId === caretakerRef.current
          ? "you"
          : (notice.caretakerName ?? `friend ${notice.caretakerId.slice(0, 4)}`);
      const amount = notice.applied >= 1000 ? `+${(notice.applied / 10_000).toFixed(1)}% ` : "";
      room.onCare(notice.action, `${amount}${ACTION_EMOJI[notice.action]} ${who}`, performance.now());
    });
    const offMilestone = onMilestone((notice) => {
      const label = MILESTONE_LABELS[notice.kind];
      if (label) room.onMilestone(label, performance.now());
    });
    // Spectators watch the run live (SPEC §13.3): the pet plays on every
    // screen while the minigame is on.
    const offMinigame = onMinigame((notice) => {
      if (notice.phase === "start" || notice.phase === "score") {
        room.machine.trigger("playing", performance.now());
      }
      if (notice.phase === "finish" && notice.score !== undefined) {
        room.onMilestone(`🎮 scored ${notice.score}!`, performance.now());
      }
    });

    const stop = startLoop({
      update: (dt) => room.update(dt),
      render: (now) => {
        const state = projectNow();
        if (state) room.syncDerived(derive(state), state.asleep, now);
        const view = roomViewRef.current;
        if (view) room.decor = { decor: view.decor, activeCosmetic: view.activeCosmetic };
        room.render(ctx, now);
      },
    });

    return () => {
      stop();
      offCare();
      offMilestone();
      offMinigame();
      media.removeEventListener("change", onMotionChange);
    };
  }, [onCare, onMilestone, onMinigame, projectNow]);

  // Integer upscaling only (SPEC §10.3): the canvas grows in whole multiples
  // of the logical resolution so pixels stay square and even.
  const containerRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;
    const fit = (): void => {
      const scale = Math.max(1, Math.floor(container.clientWidth / ROOM_WIDTH));
      canvas.style.width = `${ROOM_WIDTH * scale}px`;
      canvas.style.height = `${ROOM_HEIGHT * scale}px`;
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={containerRef} className="flex w-full justify-center">
      <canvas
        ref={canvasRef}
        width={ROOM_WIDTH}
        height={ROOM_HEIGHT}
        aria-hidden="true"
        className="[image-rendering:pixelated]"
      />
    </div>
  );
}
