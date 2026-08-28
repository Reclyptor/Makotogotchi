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
import { FREE_VENUES, petClock } from "@/game/scene/backdrop";
import { isVenueId } from "@/sim/atmosphere";
import { startLoop } from "@/game/engine/loop";
import { wantToast } from "@/app/components/WantBanner/copy";
import type { PetStream } from "@/app/hooks/usePetStream";
import type { SpectacleMood } from "@/sim/secret";

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
  /**
   * A spectacle to play on this screen alone (SPEC §26.2). Set when the
   * caretaker entered the ancient code but lost the room-wide guard, so no
   * broadcast is coming back to drive it. The nonce is what makes a second
   * throttled entry of the same mood a second spectacle rather than a no-op.
   */
  localSecret?: { mood: SpectacleMood; nonce: number } | null;
  /** Retro display, the ancient code's keepsake (SPEC §26.5). */
  retro?: boolean;
};

export default function PetCanvas({ stream, localSecret = null, retro = false }: PetCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const { projectNow, onCare, onMilestone, onWant, onMinigame, onReact, onSecret, caretakerId, room: roomView, timeZone, presenceCount } =
    stream;
  const roomRef = useRef<Room | null>(null);
  const roomViewRef = useRef(roomView);
  useEffect(() => {
    roomViewRef.current = roomView;
  }, [roomView]);
  const retroRef = useRef(retro);
  useEffect(() => {
    retroRef.current = retro;
    // The pass is part of the frame, so flipping it has to invalidate the one
    // already on the canvas — otherwise the room believes it has painted this
    // exact scene and skips, and the television never switches on.
    roomRef.current?.invalidate();
  }, [retro]);
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

    // The room only repaints when the next frame would differ from the one
    // already on the canvas (scene/room.ts). That reasoning assumes the canvas
    // still holds it — and it does not survive the backing store being thrown
    // away, which browsers do under memory pressure and which the loop's
    // parking makes likelier by leaving the canvas untouched for long
    // stretches. Restoring it means telling the room what it is looking at is
    // gone; without this the room stays blank because it believes it already
    // painted.
    const onContextRestored = (): void => room.invalidate();
    canvas.addEventListener("contextrestored", onContextRestored);

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
      if (notice.kind === "WANT_FULFILLED") {
        // A wish came true (SPEC §25.3) — hearts, in the same burst as the
        // care beat that granted it.
        room.celebrate(performance.now(), "heart");
        room.onMilestone("⭐ wish granted!", performance.now());
        return;
      }
      const label = MILESTONE_LABELS[notice.kind];
      if (label) room.onMilestone(label, performance.now());
    });
    const offWant = onWant((notice) => {
      if (notice.edge === "opened") {
        room.onMilestone(`💭 ${wantToast(notice.want?.kind ?? "", notice.want?.itemId)}`, performance.now());
        return;
      }
      // The sulk beat (SPEC §25.3): a brief sob, reduced motion holds the
      // first frame like every one-shot.
      room.machine.trigger("sulking", performance.now());
      room.onMilestone("😔", performance.now());
    });
    // The ancient code (SPEC §26.4). The mood is decided server-side and
    // carried in the message, so every room opens the same sky at once.
    const offSecret = onSecret((notice) => {
      room.secret(notice.mood, performance.now());
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
            // The rotation pool (SPEC §22.8): the free venues plus any
            // funded grand-item venues the room owns (§22.7 B7).
            ownedVenues: [...FREE_VENUES, ...(roomViewRef.current?.decor ?? []).filter(isVenueId)],
          });
        }
        if (state) {
          room.syncDerived(derive(state), state.asleep, now);
          maybeGreet(state.bornAtTick !== null && state.diedAtTick === null && !state.asleep, now);
        }
        const view = roomViewRef.current;
        if (view) room.decor = { decor: view.decor, activeCosmetic: view.activeCosmetic };
        room.retro = retroRef.current;
        room.render(ctx, now);
      },
    });

    return () => {
      stop();
      roomRef.current = null;
      offCare();
      offMilestone();
      offWant();
      offMinigame();
      offReact();
      offSecret();
      media.removeEventListener("change", onMotionChange);
      canvas.removeEventListener("contextrestored", onContextRestored);
    };
  }, [onCare, onMilestone, onWant, onMinigame, onReact, onSecret, projectNow]);

  useEffect(() => {
    if (!localSecret) return;
    roomRef.current?.secret(localSecret.mood, performance.now());
  }, [localSecret]);

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
