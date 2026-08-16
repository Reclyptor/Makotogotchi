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
import ShopPanel from "@/app/components/ShopPanel";
import DustDash from "@/app/components/DustDash";
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
  const { projectNow, context, onCare, onMilestone, onMinigame, onReact, caretakerId, profile } = stream;
  const [ui, setUi] = useState<{ state: PetState; derived: DerivedState } | null>(null);
  const [feed, setFeed] = useState<FeedEntry[]>([]);
  const [muted, setMuted] = useState(true);
  const [shopOpen, setShopOpen] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [spectating, setSpectating] = useState<{ name: string; score: number } | null>(null);
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
    // The minigame spectacle (SPEC §13.3): a banner with the live score for
    // everyone who isn't the one playing. A staleness timeout backstops the
    // finish broadcast — a crashed or abandoned game (closed tab, lost
    // network) must never pin the banner forever.
    let spectateTimeout: ReturnType<typeof setTimeout> | null = null;
    const armSpectateTimeout = (): void => {
      if (spectateTimeout) clearTimeout(spectateTimeout);
      spectateTimeout = setTimeout(() => setSpectating(null), 35_000);
    };
    const offMinigame = onMinigame((notice) => {
      const name = notice.caretakerId === caretakerRef.current ? "You" : (notice.caretakerName ?? "A friend");
      if (notice.phase === "start") {
        setSpectating({ name, score: 0 });
        armSpectateTimeout();
        pushFeed(`${name} started a game of Dust Dash! 🎮`);
      } else if (notice.phase === "score" && notice.score !== undefined) {
        setSpectating((current) => (current ? { ...current, score: notice.score! } : { name, score: notice.score! }));
        armSpectateTimeout();
      } else if (notice.phase === "finish") {
        if (spectateTimeout) clearTimeout(spectateTimeout);
        setSpectating(null);
        if (notice.score !== undefined) pushFeed(`${name} scored ${notice.score} at Dust Dash!`);
      }
    });
    const offReact = onReact((notice) => {
      const who = notice.caretakerId === caretakerRef.current ? "You" : notice.caretakerName;
      pushFeed(`${who} reacted ${notice.emoji}`);
    });
    return () => {
      offCare();
      offMilestone();
      offMinigame();
      offReact();
      if (spectateTimeout) clearTimeout(spectateTimeout);
    };
  }, [onCare, onMilestone, onMinigame, onReact]);

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

      {spectating && (
        <p aria-live="polite" className="w-full rounded-md bg-accent/20 px-3 py-1.5 text-center text-sm">
          🎮 {spectating.name === "You" ? "You are" : `${spectating.name} is`} playing Dust Dash — score{" "}
          <strong className="tabular-nums">{spectating.score}</strong>
        </p>
      )}

      {ui && !isEgg && <Meters percentages={ui.derived.percentages} />}
      {isEgg && <VotePanel />}
      {ui && !isEgg && !isDead && ctx && caretakerId && (
        <ActionBar
          state={ui.state}
          ctx={ctx}
          caretakerId={caretakerId}
          petName={petName}
          onPlay={() => setPlaying(true)}
        />
      )}
      {ui && !isEgg && !isDead && (
        <button
          type="button"
          onClick={() => setShopOpen((open) => !open)}
          aria-expanded={shopOpen}
          className="self-start text-sm text-muted underline underline-offset-2 hover:text-foreground"
        >
          {shopOpen ? "hide shop" : "🛒 open shop"}
        </button>
      )}
      {shopOpen && <ShopPanel onClose={() => setShopOpen(false)} />}
      {playing && <DustDash onClose={() => setPlaying(false)} />}

      {/* Emoji reactions (SPEC §2.11): zero moderation surface, high
          expressiveness — everyone sees them instantly. */}
      <div role="group" aria-label="React" className="flex items-center gap-1">
        {["❤️", "💛", "😂", "😮", "😢", "🎉"].map((emoji) => (
          <button
            key={emoji}
            type="button"
            aria-label={`React with ${emoji}`}
            onClick={() =>
              void fetch("/api/react", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ emoji }),
              }).catch(() => null)
            }
            className="rounded-md px-1.5 py-0.5 text-lg outline-offset-2 transition-transform hover:scale-125"
          >
            {emoji}
          </button>
        ))}
      </div>

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
