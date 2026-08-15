"use client";

// The game screen (SPEC §11.2): header, room canvas, meters, actions, and
// the live feed — mobile-first single column. Owns the stream connection,
// a 4 Hz UI projection tick (the canvas runs its own rAF loop), the feed
// log, and the audio toggle.

import { useEffect, useRef, useState } from "react";
import { derive, type DerivedState } from "@/sim/derive";
import { stageAt, type PetState } from "@/sim/model";
import { TICKS_PER_DAY, TICKS_PER_HOUR, type CareAction } from "@/sim/tuning";
import { GameAudio } from "@/game/audio";
import PetCanvas from "@/app/components/PetCanvas";
import Meters from "@/app/components/Meters";
import ActionBar from "@/app/components/ActionBar";
import FeedLog, { type FeedEntry } from "@/app/components/FeedLog";
import { usePetStream } from "@/app/hooks/usePetStream";

const STAGE_LABELS: Record<string, string> = {
  EGG: "Egg",
  HATCHLING: "Hatchling",
  PUP: "Pup",
  JUVENILE: "Juvenile",
  ADULT: "Adult",
  ELDER: "Elder",
};

const ACTION_FEED_TEXT: Record<CareAction, string> = {
  FEED: "fed Makoto",
  PLAY: "played with Makoto",
  CLEAN: "gave Makoto a dust bath",
  PET: "petted Makoto",
  LULLABY: "sang Makoto a lullaby",
  MEDICATE: "gave Makoto medicine",
};

const MILESTONE_FEED_TEXT: Record<string, string> = {
  BECAME_SICK: "Makoto got sick! 🌡️",
  RECOVERED: "Makoto recovered!",
  SLEPT: "Makoto fell asleep 💤",
  WOKE: "Makoto woke up ☀️",
  DIED: "Makoto has died. 🪦",
  EVOLVED: "Makoto evolved! ✨",
  CRITICAL: "A need is critically low! ⚠️",
};

const age = (state: PetState): string => {
  if (state.bornAtTick === null) return "incubating";
  const ticks = state.tick - state.bornAtTick;
  const days = Math.floor(ticks / TICKS_PER_DAY);
  const hours = Math.floor((ticks % TICKS_PER_DAY) / TICKS_PER_HOUR);
  return days > 0 ? `${days}d ${hours}h` : `${hours}h`;
};

export default function GameView() {
  const stream = usePetStream();
  const { projectNow, context, onCare, onMilestone, caretakerId } = stream;
  const [ui, setUi] = useState<{ state: PetState; derived: DerivedState } | null>(null);
  const [feed, setFeed] = useState<FeedEntry[]>([]);
  const [muted, setMuted] = useState(true);
  const audioRef = useRef<GameAudio | null>(null);
  const feedId = useRef(0);
  const caretakerRef = useRef<string | null>(null);

  useEffect(() => {
    caretakerRef.current = caretakerId;
  }, [caretakerId]);

  useEffect(() => {
    audioRef.current = new GameAudio();
    setMuted(audioRef.current.muted);
  }, []);

  // UI projection tick — meters and button cooldowns follow the sim between
  // server messages.
  useEffect(() => {
    const tick = (): void => {
      const state = projectNow();
      if (state) setUi({ state, derived: derive(state) });
    };
    tick();
    const timer = setInterval(tick, 250);
    return () => clearInterval(timer);
  }, [projectNow]);

  useEffect(() => {
    const pushFeed = (text: string): void => {
      feedId.current += 1;
      const entry: FeedEntry = {
        id: feedId.current,
        text,
        at: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      };
      setFeed((current) => [...current.slice(-49), entry]);
    };

    const offCare = onCare((notice) => {
      const who = notice.caretakerId === caretakerRef.current ? "You" : `Friend ${notice.caretakerId.slice(0, 4)}`;
      const amount = notice.applied >= 1000 ? ` (+${(notice.applied / 10_000).toFixed(1)}%)` : "";
      pushFeed(`${who} ${ACTION_FEED_TEXT[notice.action]}${amount}`);
      audioRef.current?.playAction(notice.action);
    });
    const offMilestone = onMilestone((notice) => {
      const text = MILESTONE_FEED_TEXT[notice.kind];
      if (text) pushFeed(text);
      if (notice.kind === "CRITICAL" || notice.kind === "BECAME_SICK" || notice.kind === "DIED") {
        audioRef.current?.playAlert();
      }
    });
    return () => {
      offCare();
      offMilestone();
    };
  }, [onCare, onMilestone]);

  const toggleAudio = (): void => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.setMuted(!audio.muted);
    setMuted(audio.muted);
  };

  const ctx = context();
  const petName = ui?.state.generation.name ?? "Makoto";
  const stage = ui ? stageAt(ui.state.bornAtTick, ui.state.tick) : null;

  return (
    <div className="flex w-full max-w-xl flex-col items-center gap-4">
      <header className="flex w-full items-center justify-between gap-2 text-sm">
        <div className="flex items-baseline gap-2">
          <span className="text-lg font-bold">{petName}</span>
          {ui && (
            <span className="text-muted">
              {age(ui.state)} · {STAGE_LABELS[stage ?? ""] ?? ""}
              {ui.state.form ? ` · ${ui.state.form.toLowerCase()}` : ""}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <span className="text-muted" aria-live="polite">
            👥 {stream.presenceCount}
          </span>
          <button
            type="button"
            onClick={toggleAudio}
            aria-pressed={!muted}
            aria-label={muted ? "Unmute sounds" : "Mute sounds"}
            className="rounded-md bg-surface px-2 py-1 outline-offset-2"
          >
            {muted ? "🔇" : "🔊"}
          </button>
          <span className={stream.connected ? "text-emerald-400" : "text-muted"} role="status">
            {stream.connected ? "● live" : "○ connecting"}
          </span>
        </div>
      </header>

      <PetCanvas stream={stream} />

      {/* The pet's condition as plain text — the canvas is decorative. */}
      <p aria-live="polite" className="text-sm text-muted">
        {ui
          ? ui.state.diedAtTick !== null
            ? `${petName} has died.`
            : ui.state.bornAtTick === null
              ? "The egg is incubating…"
              : ui.state.asleep
                ? `${petName} is asleep.`
                : ui.derived.ailments.length > 0
                  ? `${petName} is ${ui.derived.ailments.join(", ").toLowerCase()}.`
                  : `${petName} is doing fine.`
          : "Connecting…"}
      </p>

      {ui && <Meters percentages={ui.derived.percentages} />}
      {ui && ctx && caretakerId && (
        <ActionBar state={ui.state} ctx={ctx} caretakerId={caretakerId} petName={petName} />
      )}
      <FeedLog entries={feed} />
    </div>
  );
}
