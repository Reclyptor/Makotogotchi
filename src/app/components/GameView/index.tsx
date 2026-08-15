"use client";

// The game screen (SPEC §11.2): header, room canvas, meters, actions, and
// the live feed — mobile-first single column. Owns the stream connection,
// a 4 Hz UI projection tick (the canvas runs its own rAF loop), the feed
// log, and the audio toggle. During incubation the naming vote takes the
// action bar's place; after death, the memorial link does.

import { useEffect, useRef, useState } from "react";
import { derive, type DerivedState } from "@/sim/derive";
import { stageAt, type PetState } from "@/sim/model";
import { TICKS_PER_DAY, TICKS_PER_HOUR, type CareAction } from "@/sim/tuning";
import { GameAudio } from "@/game/audio";
import PetCanvas from "@/app/components/PetCanvas";
import Meters from "@/app/components/Meters";
import ActionBar from "@/app/components/ActionBar";
import FeedLog, { type FeedEntry } from "@/app/components/FeedLog";
import VotePanel from "@/app/components/VotePanel";
import NicknameEditor from "@/app/components/NicknameEditor";
import PushToggle from "@/app/components/PushToggle";
import { usePetStream } from "@/app/hooks/usePetStream";

const STAGE_LABELS: Record<string, string> = {
  EGG: "Egg",
  HATCHLING: "Hatchling",
  PUP: "Pup",
  JUVENILE: "Juvenile",
  ADULT: "Adult",
  ELDER: "Elder",
};

const actionFeedText = (petName: string): Record<CareAction, string> => ({
  FEED: `fed ${petName}`,
  PLAY: `played with ${petName}`,
  CLEAN: `gave ${petName} a dust bath`,
  PET: `petted ${petName}`,
  LULLABY: `sang ${petName} a lullaby`,
  MEDICATE: `gave ${petName} medicine`,
});

const milestoneFeedText = (petName: string): Record<string, string> => ({
  HATCHED: `🎉 ${petName} hatched!`,
  BECAME_SICK: `${petName} got sick! 🌡️`,
  RECOVERED: `${petName} recovered!`,
  SLEPT: `${petName} fell asleep 💤`,
  WOKE: `${petName} woke up ☀️`,
  DIED: `${petName} has died. 🪦`,
  EVOLVED: `${petName} evolved! ✨`,
  CRITICAL: "A need is critically low! ⚠️",
});

const age = (state: PetState): string => {
  if (state.bornAtTick === null) return "incubating";
  const ticks = state.tick - state.bornAtTick;
  const days = Math.floor(ticks / TICKS_PER_DAY);
  const hours = Math.floor((ticks % TICKS_PER_DAY) / TICKS_PER_HOUR);
  return days > 0 ? `${days}d ${hours}h` : `${hours}h`;
};

export default function GameView() {
  const stream = usePetStream();
  const { projectNow, context, onCare, onMilestone, caretakerId, profile } = stream;
  const [ui, setUi] = useState<{ state: PetState; derived: DerivedState } | null>(null);
  const [feed, setFeed] = useState<FeedEntry[]>([]);
  const [muted, setMuted] = useState(true);
  const audioRef = useRef<GameAudio | null>(null);
  const feedId = useRef(0);
  const caretakerRef = useRef<string | null>(null);
  const petNameRef = useRef("Makoto");
  const greetedRef = useRef(false);

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
      if (state) {
        petNameRef.current = state.generation.name ?? "Makoto";
        setUi({ state, derived: derive(state) });
      }
    };
    tick();
    const timer = setInterval(tick, 250);
    return () => clearInterval(timer);
  }, [projectNow]);

  const pushFeed = (text: string): void => {
    feedId.current += 1;
    const entry: FeedEntry = {
      id: feedId.current,
      text,
      at: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    };
    setFeed((current) => [...current.slice(-49), entry]);
  };

  // Returning caretakers get greeted by name (SPEC §2.11).
  useEffect(() => {
    if (profile?.nickname && !greetedRef.current) {
      greetedRef.current = true;
      pushFeed(
        `Welcome back, ${profile.nickname}!${profile.streakDays > 1 ? ` 🔥 ${profile.streakDays}-day streak` : ""}`,
      );
    }
  }, [profile]);

  useEffect(() => {
    const offCare = onCare((notice) => {
      const who =
        notice.caretakerId === caretakerRef.current ? "You" : (notice.caretakerName ?? `Friend ${notice.caretakerId.slice(0, 4)}`);
      const amount = notice.applied >= 1000 ? ` (+${(notice.applied / 10_000).toFixed(1)}%)` : "";
      pushFeed(`${who} ${actionFeedText(petNameRef.current)[notice.action]}${amount}`);
      audioRef.current?.playAction(notice.action);
    });
    const offMilestone = onMilestone((notice) => {
      const text = milestoneFeedText(notice.kind === "HATCHED" && notice.detail ? notice.detail : petNameRef.current)[
        notice.kind
      ];
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
  const isEgg = ui !== null && ui.state.bornAtTick === null;
  const isDead = ui !== null && ui.state.diedAtTick !== null;

  return (
    <div className="flex w-full max-w-xl flex-col items-center gap-4">
      <header className="flex w-full items-center justify-between gap-2 text-sm">
        <div className="flex items-baseline gap-2">
          <span className="text-lg font-bold">{isEgg ? "???" : petName}</span>
          {ui && (
            <span className="text-muted">
              {age(ui.state)} · {STAGE_LABELS[stage ?? ""] ?? ""}
              {ui.state.form ? ` · ${ui.state.form.toLowerCase()}` : ""}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <span
            className="text-muted"
            aria-live="polite"
            title={stream.presenceNames.length > 0 ? stream.presenceNames.join(", ") : undefined}
          >
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
          ? isDead
            ? `${petName} has died. A new egg will appear soon.`
            : isEgg
              ? "The egg is incubating…"
              : ui.state.asleep
                ? `${petName} is asleep.`
                : ui.derived.ailments.length > 0
                  ? `${petName} is ${ui.derived.ailments.join(", ").toLowerCase()}.`
                  : `${petName} is doing fine.`
          : "Connecting…"}
      </p>

      {ui && !isEgg && <Meters percentages={ui.derived.percentages} />}
      {isEgg && <VotePanel />}
      {ui && !isEgg && !isDead && ctx && caretakerId && (
        <ActionBar state={ui.state} ctx={ctx} caretakerId={caretakerId} petName={petName} />
      )}
      <FeedLog entries={feed} />

      <footer className="flex w-full flex-wrap items-center justify-between gap-2 border-t border-white/10 pt-3 text-sm">
        <NicknameEditor key={profile?.nickname ?? ""} current={profile?.nickname ?? null} />
        <PushToggle />
        <nav className="flex gap-4 text-muted">
          <a href="/leaderboard" className="underline underline-offset-2 hover:text-foreground">
            leaderboard
          </a>
          <a href="/memorial" className="underline underline-offset-2 hover:text-foreground">
            memorial
          </a>
          <a href="/about" className="underline underline-offset-2 hover:text-foreground">
            about
          </a>
        </nav>
      </footer>
    </div>
  );
}
