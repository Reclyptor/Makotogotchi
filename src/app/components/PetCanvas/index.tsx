"use client";

// The living room: canvas scene driven by the pet stream. The canvas is
// decorative (aria-hidden) — every meaningful signal it shows also exists as
// semantic HTML in the surrounding UI (SPEC §10.4, §11.3).

import { useEffect, useRef } from "react";
import { derive } from "@/sim/derive";
import { quirks } from "@/sim/quirks";
import { isAmbientEvent } from "@/sim/ambient";
import type { CareAction } from "@/sim/tuning";
import { SPRITE_SHEET_URL } from "@/game/atlas.generated";
import { Room, ROOM_HEIGHT, ROOM_WIDTH, type FoodTaste } from "@/game/scene/room";
import { petClock } from "@/game/scene/backdrop";
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

// The greeting bow (SPEC §21.1): once per pet-calendar day, per browser,
// landing on a settled room rather than the first painted frame.
const GREET_STORAGE_KEY = "mgc:last-greet";
const GREET_DELAY_MS = 1000;

// Crowd moments (SPEC §21.2): the rising edge past this many watchers is
// worth celebrating, but no more often than this. Module scope on purpose —
// a remount must not hand the room a fresh throttle.
const CROWD_THRESHOLD = 3;
const CROWD_THROTTLE_MS = 10 * 60 * 1000;
let lastCrowdMs = 0;

/** The pet's own calendar date, as a stable YYYY-MM-DD key. */
const petDayKey = (timeZone: string): string =>
  new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

/** localStorage is unavailable in some privacy modes; a lost bow is fine. */
const readStored = (storageKey: string): string | null => {
  try {
    return window.localStorage.getItem(storageKey);
  } catch {
    return null;
  }
};

const writeStored = (storageKey: string, value: string): void => {
  try {
    window.localStorage.setItem(storageKey, value);
  } catch {
    // Nothing to do — the pet simply bows again tomorrow's first load.
  }
};

export type PetCanvasProps = {
  stream: PetStream;
};

export default function PetCanvas({ stream }: PetCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const { projectNow, onCare, onMilestone, onMinigame, onReact, caretakerId, room: roomView, timeZone, presenceCount } = stream;
  const roomRef = useRef<Room | null>(null);
  const roomViewRef = useRef(roomView);
  useEffect(() => {
    roomViewRef.current = roomView;
  }, [roomView]);
  const timeZoneRef = useRef(timeZone);
  useEffect(() => {
    timeZoneRef.current = timeZone;
  }, [timeZone]);
  const caretakerRef = useRef<string | null>(null);
  useEffect(() => {
    caretakerRef.current = caretakerId;
  }, [caretakerId]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    const room = new Room();
    roomRef.current = room;
    void room.atlas.load(SPRITE_SHEET_URL);

    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    room.reducedMotion = media.matches;
    const onMotionChange = (event: MediaQueryListEvent): void => {
      room.reducedMotion = event.matches;
    };
    media.addEventListener("change", onMotionChange);

    // The generation's taste is recomputable from the seed the state stream
    // already carries, so a meal needs no extra round trip (SPEC §21.4).
    const tasteOf = (itemId: string | undefined): FoodTaste | undefined => {
      const state = itemId === undefined ? null : projectNow();
      if (!state) return undefined;
      const taste = quirks(state.generation.seed);
      if (itemId === taste.favoriteFood) return "favorite";
      if (itemId === taste.dislikedFood) return "disliked";
      return undefined;
    };

    const offCare = onCare((notice) => {
      const who =
        notice.caretakerId === caretakerRef.current
          ? "you"
          : (notice.caretakerName ?? `friend ${notice.caretakerId.slice(0, 4)}`);
      const amount = notice.applied >= 1000 ? `+${(notice.applied / 10_000).toFixed(1)}% ` : "";
      const taste = notice.action === "FEED" ? tasteOf(notice.itemId) : undefined;
      room.onCare(notice.action, `${amount}${ACTION_EMOJI[notice.action]} ${who}`, performance.now(), taste);
    });
    const offMilestone = onMilestone((notice) => {
      if (notice.kind === "AMBIENT" && isAmbientEvent(notice.detail)) {
        room.ambient(notice.detail, performance.now());
        return;
      }
      if (notice.kind === "QUEST_DONE" || notice.kind === "FUNDED") {
        // Communal wins belong to the whole room, so the whole room cheers.
        room.celebrate(performance.now(), "heart");
        room.onMilestone(notice.kind === "FUNDED" ? "the room grows!" : "goal complete!", performance.now());
        return;
      }
      const label = MILESTONE_LABELS[notice.kind];
      if (label) room.onMilestone(label, performance.now());
    });
    const offReact = onReact((notice) => {
      const who = notice.caretakerId === caretakerRef.current ? "you" : notice.caretakerName;
      room.onMilestone(`${notice.emoji} ${who}`, performance.now());
    });
    // Spectators watch the run live (SPEC §13.3): the pet plays on every
    // screen while the minigame is on.
    const offMinigame = onMinigame((notice) => {
      if (notice.phase === "start" || notice.phase === "score") {
        room.machine.trigger("playing", performance.now());
      }
      if (notice.phase === "finish" && notice.score !== undefined) {
        room.onMilestone(`🎮 scored ${notice.score}!`, performance.now());
        if (notice.score > 0) room.celebrate(performance.now());
      }
    });

    // The greeting is armed the first frame every precondition holds, then
    // fires a beat later so the bow reads as a greeting and not a twitch.
    let greetDueAtMs: number | null = null;
    let greeted = false;
    const maybeGreet = (awake: boolean, nowMs: number): void => {
      if (greeted) return;
      const zone = timeZoneRef.current;
      if (!zone || !room.atlas.ready || !awake) return;
      const today = petDayKey(zone);
      if (readStored(GREET_STORAGE_KEY) === today) {
        greeted = true;
        return;
      }
      if (greetDueAtMs === null) {
        greetDueAtMs = nowMs + GREET_DELAY_MS;
        return;
      }
      if (nowMs < greetDueAtMs) return;
      greeted = true;
      writeStored(GREET_STORAGE_KEY, today);
      room.machine.trigger("greeting", nowMs);
    };

    const stop = startLoop({
      update: (dt) => room.update(dt),
      render: (now) => {
        const state = projectNow();
        const zone = timeZoneRef.current;
        // The room dresses itself for the pet's hour, weather and season
        // (SPEC §22.1) — all of it derived from the shared clock and seed.
        if (state && zone) {
          const clock = petClock(zone);
          room.syncAtmosphere({
            hour: clock.hour,
            minute: clock.minute,
            month: clock.month,
            dayIndex: clock.dayIndex,
            seed: state.generation.seed,
            themeId: roomViewRef.current?.activeTheme ?? null,
          });
        }
        if (state) {
          room.syncDerived(derive(state), state.asleep, now);
          maybeGreet(state.bornAtTick !== null && state.diedAtTick === null && !state.asleep, now);
        }
        const view = roomViewRef.current;
        if (view) room.decor = { decor: view.decor, activeCosmetic: view.activeCosmetic };
        room.render(ctx, now);
      },
    });

    return () => {
      stop();
      roomRef.current = null;
      offCare();
      offMilestone();
      offMinigame();
      offReact();
      media.removeEventListener("change", onMotionChange);
    };
  }, [onCare, onMilestone, onMinigame, onReact, projectNow]);

  // A crowd gathering is a rising edge, not a level: the room celebrates the
  // moment the third watcher arrives, and stays quiet while they linger.
  const previousCrowdRef = useRef(0);
  useEffect(() => {
    const previous = previousCrowdRef.current;
    previousCrowdRef.current = presenceCount;
    const room = roomRef.current;
    if (!room || previous >= CROWD_THRESHOLD || presenceCount < CROWD_THRESHOLD) return;
    const now = Date.now();
    if (now - lastCrowdMs < CROWD_THROTTLE_MS) return;
    lastCrowdMs = now;
    room.celebrate(performance.now(), "heart");
    room.onMilestone("a crowd gathers!", performance.now());
  }, [presenceCount]);

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
