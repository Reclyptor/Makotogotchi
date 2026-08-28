"use client";

// The game screen (SPEC §11.2): identity bar, the habitat, meters, actions,
// reactions, and the persistent activity feed — mobile-first, springy, and
// fast. Owns the stream connection, a 4 Hz UI projection tick (the canvas
// runs its own rAF loop), feed history + live merge, and the audio toggle.
// During incubation the naming vote takes the action bar's place; after
// death, the memorial takes over.

import { useCallback, useEffect, useRef, useState } from "react";
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
import QuestBanner from "@/app/components/QuestBanner";
import WantBanner from "@/app/components/WantBanner";
import { wantAsk, wantGranted, wantLapse } from "@/app/components/WantBanner/copy";
import MinigameShell from "@/app/components/minigames/Shell";
import { isMinigameId, MINIGAME_IDS, MINIGAMES, type MinigameId } from "@/sim/minigames";
import { isAmbientEvent, type AmbientEvent } from "@/sim/ambient";
import { isTitleId, TITLES } from "@/sim/titles";
import { isVenueId, venueAt } from "@/sim/atmosphere";
import { FREE_VENUES, petClock, venueSpec } from "@/game/scene/backdrop";
import { usePetStream } from "@/app/hooks/usePetStream";
import { useKonami } from "@/app/hooks/useKonami";
import { useRetro } from "@/app/hooks/useRetro";
import type { SpectacleMood } from "@/sim/secret";
import type { FeedEntryPayload } from "@/app/api/feed/route";

const STAGE_LABELS: Record<string, string> = {
  EGG: "Egg",
  HATCHLING: "Hatchling",
  PUP: "Pup",
  JUVENILE: "Juvenile",
  ADULT: "Adult",
  ELDER: "Elder",
};

const ACTION_EMOJI: Record<CareAction, string> = {
  FEED: "🍖",
  PLAY: "🎮",
  CLEAN: "🌪️",
  PET: "💛",
  LULLABY: "🎵",
  MEDICATE: "💊",
};

const MILESTONE_ICONS: Record<string, string> = {
  HATCHED: "🐣",
  EVOLVED: "✨",
  BECAME_SICK: "🌡️",
  RECOVERED: "💊",
  SLEPT: "💤",
  WOKE: "☀️",
  DIED: "🪦",
  CRITICAL: "⚠️",
};

const actionFeedText = (petName: string): Record<CareAction, string> => ({
  FEED: `fed ${petName}`,
  PLAY: `played with ${petName}`,
  CLEAN: `gave ${petName} a dust bath`,
  PET: `petted ${petName}`,
  LULLABY: `sang ${petName} a lullaby`,
  MEDICATE: `gave ${petName} medicine`,
});

const AMBIENT_ICONS: Record<AmbientEvent, string> = {
  "shooting-star": "🌠",
  butterfly: "🦋",
  "coin-dig": "✨",
  "mystery-noise": "👂",
};

const ambientFeedText = (petName: string): Record<AmbientEvent, string> => ({
  "shooting-star": "A shooting star crossed the window.",
  butterfly: "A butterfly drifted through the room.",
  "coin-dig": `${petName} dug up something shiny!`,
  "mystery-noise": "…did you hear that?",
});

/**
 * What the feed says when someone opens the sky (SPEC §26.4). The mood tells
 * confetti from meteors; only the local state can tell a sleeping pet from a
 * dead one, and the difference is the whole tone of the line.
 */
const secretFeedText = (mood: SpectacleMood, petName: string, dead: boolean): string => {
  if (mood === "party") return "Someone remembered the ancient code.";
  return dead
    ? "Someone remembered the ancient code. The sky remembered too."
    : `Someone tried the ancient code. ${petName} slept right through it.`;
};

const GRAND_LABELS: Record<string, string> = {
  window_seat: "Window Seat",
  aquarium: "Aquarium",
  kotatsu: "Kotatsu",
};

const milestoneFeedText = (petName: string): Record<string, string> => ({
  QUEST_DONE: "Today's goal is done — +15 🪙 to everyone who helped!",
  HATCHED: `${petName} hatched!`,
  BECAME_SICK: `${petName} got sick!`,
  RECOVERED: `${petName} recovered!`,
  SLEPT: `${petName} fell asleep`,
  WOKE: `${petName} woke up`,
  DIED: `${petName} has died.`,
  EVOLVED: `${petName} evolved!`,
  CRITICAL: "A need is critically low!",
});

/** One feed line for a milestone, or null when it has nothing to say. */
const milestoneLine = (kind: string, detail: string | undefined, petName: string): { icon: string; text: string } | null => {
  if (kind === "AMBIENT") {
    return isAmbientEvent(detail) ? { icon: AMBIENT_ICONS[detail], text: ambientFeedText(petName)[detail] } : null;
  }
  if (kind === "FUNDED" && detail !== undefined) {
    return { icon: "🏠", text: `The ${GRAND_LABELS[detail] ?? detail} is funded — it's in the room for good!` };
  }
  if (kind === "WANT_FULFILLED") {
    return { icon: "⭐", text: wantGranted(petName, detail) };
  }
  const name = kind === "HATCHED" && detail !== undefined ? detail : petName;
  const text = milestoneFeedText(name)[kind];
  return text === undefined ? null : { icon: MILESTONE_ICONS[kind] ?? "✨", text };
};

const clockTime = (date: Date): string => date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

const age = (state: PetState): string => {
  if (state.bornAtTick === null) return "incubating";
  const ticks = state.tick - state.bornAtTick;
  const days = Math.floor(ticks / TICKS_PER_DAY);
  const hours = Math.floor((ticks % TICKS_PER_DAY) / TICKS_PER_HOUR);
  return days > 0 ? `${days}d ${hours}h` : `${hours}h`;
};

export default function GameView() {
  const stream = usePetStream();
  const {
    projectNow,
    nowTickExact,
    context,
    onCare,
    onMilestone,
    onWant,
    onTitle,
    onMinigame,
    onRecord,
    onFunded,
    onReact,
    onSecret,
    caretakerId,
    profile,
  } = stream;
  const [ui, setUi] = useState<{ state: PetState; derived: DerivedState; nowTickExact: number } | null>(null);
  // Play launches a random game from the roster; a ?game= query pins it —
  // handy for sharing a favourite and for deterministic e2e runs.
  const pickGame = (): MinigameId => {
    const pinned = new URLSearchParams(window.location.search).get("game");
    if (isMinigameId(pinned)) return pinned;
    return MINIGAME_IDS[Math.floor(Math.random() * MINIGAME_IDS.length)]!;
  };
  const [feed, setFeed] = useState<FeedEntry[]>([]);
  // Care and milestones are the two things that can move today's goal; the
  // banner debounces the refetch itself.
  const questNudge = useCallback(
    (listener: () => void) => {
      const offCare = onCare(() => listener());
      const offMilestone = onMilestone(() => listener());
      return () => {
        offCare();
        offMilestone();
      };
    },
    [onCare, onMilestone],
  );
  const [muted, setMuted] = useState(true);
  const [shopOpen, setShopOpen] = useState(false);
  const [playing, setPlaying] = useState<MinigameId | null>(null);
  const [spectating, setSpectating] = useState<{ name: string; game: string; score: number } | null>(null);
  const [localSecret, setLocalSecret] = useState<{ mood: SpectacleMood; nonce: number } | null>(null);
  const retro = useRetro();
  const secretNonce = useRef(0);
  const audioRef = useRef<GameAudio | null>(null);
  const localId = useRef(0);
  const maxSeqRef = useRef(-1);
  const caretakerRef = useRef<string | null>(null);
  const petNameRef = useRef("Makoto");
  const greetedRef = useRef(false);
  const historyLoadedRef = useRef(false);

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
      const exact = nowTickExact();
      if (state && exact !== null) {
        petNameRef.current = state.generation.name ?? "Makoto";
        setUi({ state, derived: derive(state), nowTickExact: exact });
      }
    };
    tick();
    const timer = setInterval(tick, 250);
    return () => clearInterval(timer);
  }, [projectNow, nowTickExact]);

  const pushFeed = (icon: string, text: string, id?: number | string, at?: Date): void => {
    localId.current += 1;
    const entry: FeedEntry = {
      id: id ?? `local-${localId.current}`,
      icon,
      text,
      at: clockTime(at ?? new Date()),
    };
    setFeed((current) => [...current.slice(-119), entry]);
  };

  // Seed the feed from history once identity is known, so "You" attribution
  // works for past entries too. Live events with seq ≤ the newest historical
  // seq are duplicates from the connect race and are dropped.
  useEffect(() => {
    if (!caretakerId || historyLoadedRef.current) return;
    historyLoadedRef.current = true;
    void (async () => {
      const response = await fetch("/api/feed").catch(() => null);
      if (!response?.ok) return;
      const body = (await response.json()) as { generationName: string | null; entries: FeedEntryPayload[] };
      const petName = body.generationName ?? "Makoto";
      const seeded: FeedEntry[] = body.entries.flatMap((entry): FeedEntry[] => {
        if (entry.type === "care") {
          const who = entry.caretakerId === caretakerId ? "You" : (entry.caretakerName ?? "A friend");
          const amount = (entry.applied ?? 0) >= 1000 ? ` (+${((entry.applied ?? 0) / 10_000).toFixed(1)}%)` : "";
          return [
            {
              id: entry.seq,
              icon: ACTION_EMOJI[entry.action as CareAction] ?? "✨",
              text: `${who} ${actionFeedText(petName)[entry.action as CareAction]}${amount}`,
              at: clockTime(new Date(entry.at)),
            },
          ];
        }
        if (entry.type === "want") {
          const text =
            entry.edge === "opened"
              ? wantAsk(petName, entry.wantKind ?? "", entry.wantItemId)
              : wantLapse(petName, entry.wantKind, entry.wantItemId);
          return [{ id: entry.seq, icon: entry.edge === "opened" ? "💭" : "😔", text, at: clockTime(new Date(entry.at)) }];
        }
        const line = milestoneLine(entry.kind ?? "", entry.detail, petName);
        return line === null ? [] : [{ id: entry.seq, icon: line.icon, text: line.text, at: clockTime(new Date(entry.at)) }];
      });
      const newestSeq = body.entries[body.entries.length - 1]?.seq;
      if (newestSeq !== undefined) maxSeqRef.current = Math.max(maxSeqRef.current, newestSeq);
      setFeed((live) => [...seeded, ...live.filter((entry) => typeof entry.id === "string")]);
    })();
  }, [caretakerId]);

  // Returning caretakers get greeted by name (SPEC §2.11).
  useEffect(() => {
    if (profile?.nickname && !greetedRef.current) {
      greetedRef.current = true;
      pushFeed(
        "👋",
        `Welcome back, ${profile.nickname}!${profile.streakDays > 1 ? ` 🔥 ${profile.streakDays}-day streak` : ""}`,
      );
    }
  }, [profile]);

  useEffect(() => {
    const offCare = onCare((notice) => {
      if (notice.seq <= maxSeqRef.current) return;
      maxSeqRef.current = notice.seq;
      const who =
        notice.caretakerId === caretakerRef.current ? "You" : (notice.caretakerName ?? `Friend ${notice.caretakerId.slice(0, 4)}`);
      const amount = notice.applied >= 1000 ? ` (+${(notice.applied / 10_000).toFixed(1)}%)` : "";
      pushFeed(ACTION_EMOJI[notice.action], `${who} ${actionFeedText(petNameRef.current)[notice.action]}${amount}`, notice.seq);
      audioRef.current?.playAction(notice.action);
    });
    const offMilestone = onMilestone((notice) => {
      if (notice.seq <= maxSeqRef.current) return;
      maxSeqRef.current = notice.seq;
      const line = milestoneLine(notice.kind, notice.detail, petNameRef.current);
      if (line) pushFeed(line.icon, line.text, notice.seq);
      if (notice.kind === "CRITICAL" || notice.kind === "BECAME_SICK" || notice.kind === "DIED") {
        audioRef.current?.playAlert();
      }
    });
    // The pet's asks and their lapses (SPEC §25.7); fulfillment arrives as a
    // WANT_FULFILLED milestone and is handled above.
    const offWant = onWant((notice) => {
      if (notice.seq <= maxSeqRef.current) return;
      maxSeqRef.current = notice.seq;
      if (notice.edge === "opened") {
        pushFeed("💭", wantAsk(petNameRef.current, notice.want?.kind ?? "", notice.want?.itemId), notice.seq);
      } else {
        pushFeed("😔", wantLapse(petNameRef.current, notice.want?.kind, notice.want?.itemId), notice.seq);
      }
    });
    // A contested title changed hands (SPEC §24.2).
    const offTitle = onTitle((notice) => {
      const meta = isTitleId(notice.titleId) ? TITLES[notice.titleId] : null;
      const winner = notice.caretakerId === caretakerRef.current ? "You" : notice.caretakerName;
      const loser = notice.previousId === caretakerRef.current ? "you" : notice.previousName;
      pushFeed(meta?.chip ?? "🏷️", `${winner} took ${meta?.label ?? notice.titleId} from ${loser}!`);
    });
    // The minigame spectacle (SPEC §13.3), with a staleness backstop so a
    // crashed game can never pin the banner.
    let spectateTimeout: ReturnType<typeof setTimeout> | null = null;
    const armSpectateTimeout = (): void => {
      if (spectateTimeout) clearTimeout(spectateTimeout);
      spectateTimeout = setTimeout(() => setSpectating(null), 35_000);
    };
    const offMinigame = onMinigame((notice) => {
      const name = notice.caretakerId === caretakerRef.current ? "You" : (notice.caretakerName ?? "A friend");
      const game = isMinigameId(notice.game) ? MINIGAMES[notice.game].title : "Dust Dash";
      if (notice.phase === "start") {
        setSpectating({ name, game, score: 0 });
        armSpectateTimeout();
        pushFeed("🎮", `${name} started a game of ${game}!`);
      } else if (notice.phase === "score" && notice.score !== undefined) {
        setSpectating((current) => (current ? { ...current, score: notice.score! } : { name, game, score: notice.score! }));
        armSpectateTimeout();
      } else if (notice.phase === "finish") {
        if (spectateTimeout) clearTimeout(spectateTimeout);
        setSpectating(null);
        if (notice.score !== undefined) pushFeed("🏆", `${name} scored ${notice.score} at ${game}!`);
      }
    });
    // A new high score is worth saying out loud (SPEC §21.3); the all-time
    // board is the one that gets the shout when a run takes both.
    const offRecord = onRecord((notice) => {
      if (notice.scope !== "alltime") return;
      const who = notice.caretakerId === caretakerRef.current ? "You" : notice.caretakerName;
      pushFeed("🏅", `${who} set the ${MINIGAMES[notice.game].title} record — ${notice.score}!`);
    });
    const offFunded = onFunded((notice) => {
      const names = notice.contributors.map((entry) => entry.name);
      const credit =
        names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}` : (names[0] ?? "Everyone");
      pushFeed("🪙", `${credit} led the way on the ${notice.label}.`);
    });
    const offReact = onReact((notice) => {
      const who = notice.caretakerId === caretakerRef.current ? "You" : notice.caretakerName;
      pushFeed(notice.emoji, `${who} reacted ${notice.emoji}`);
    });
    // The ancient code (SPEC §26). Unattributed on purpose — nobody is told
    // who did it, which is what sends everyone else hunting for it.
    const offSecret = onSecret((notice) => {
      pushFeed("🎮", secretFeedText(notice.mood, petNameRef.current, projectNow()?.diedAtTick != null));
      audioRef.current?.playSecret(notice.mood);
    });
    return () => {
      offCare();
      offMilestone();
      offWant();
      offTitle();
      offMinigame();
      offRecord();
      offFunded();
      offReact();
      offSecret();
      if (spectateTimeout) clearTimeout(spectateTimeout);
    };
  }, [onCare, onMilestone, onWant, onTitle, onMinigame, onRecord, onFunded, onReact, onSecret, projectNow]);

  // The ancient code (SPEC §26). Inert while a dialog owns the keyboard:
  // four of the five minigames bind arrow keys, and GameView is the only
  // place that knows both dialogs' open state.
  const onKonami = useCallback(() => {
    // The keepsake first, and unconditionally: it is this caretaker's alone,
    // so it must not depend on the network, the guard, or anyone watching.
    if (retro.unlock()) pushFeed("📺", "RETRO MODE UNLOCKED");
    void (async () => {
      const response = await fetch("/api/konami", { method: "POST" }).catch(() => null);
      if (!response?.ok) return;
      const body = (await response.json().catch(() => null)) as { broadcast: boolean; mood: SpectacleMood } | null;
      if (!body) return;
      // A won broadcast comes back to this screen over its own stream, so the
      // feed line is pushed once, there. Losing the guard means no message is
      // coming — and the finder is never told they were second, so the line is
      // written locally instead. The canvas is aria-hidden, which makes the
      // feed the only carrier this reaches (SPEC §11.3); skipping it would
      // leave a throttled screen-reader user with nothing at all.
      if (!body.broadcast) {
        pushFeed("🎮", secretFeedText(body.mood, petNameRef.current, projectNow()?.diedAtTick != null));
        audioRef.current?.playSecret(body.mood);
        secretNonce.current += 1;
        setLocalSecret({ mood: body.mood, nonce: secretNonce.current });
      }
    })();
  }, [projectNow, retro]);
  useKonami(onKonami, !playing && !shopOpen);

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

  // Where the day is being spent (SPEC §22.8) — the same pure draw the
  // canvas dresses itself with, so caption and scene can never disagree.
  const venueLabel = (() => {
    if (!ui || !stream.timeZone || isEgg || isDead) return null;
    const owned = [...FREE_VENUES, ...(stream.room?.decor ?? []).filter(isVenueId)];
    const venueId = venueAt(ui.state.generation.seed, petClock(stream.timeZone).dayIndex, owned);
    return venueId === "home" ? null : venueSpec(venueId).label;
  })();

  const statusText = ui
    ? isDead
      ? `${petName} has died. A new egg will appear soon.`
      : isEgg
        ? "The egg is incubating…"
        : ui.state.asleep
          ? `${petName} is asleep.`
          : ui.derived.ailments.length > 0
            ? `${petName} is ${ui.derived.ailments.join(", ").toLowerCase()}.`
            : `${petName} is doing fine.`
    : "Connecting…";

  return (
    <div className="flex w-full max-w-xl flex-col items-center gap-3">
      {/* Top bar: wordmark + live status cluster */}
      <header className="flex w-full items-center justify-between gap-2">
        <span className="font-pixel text-[13px] tracking-tight text-accent drop-shadow-[0_0_12px_rgba(167,139,250,0.5)]">
          MAKOTOGOTCHI
        </span>
        {/* Four pills and a wordmark do not fit a narrow phone on one line, so
            the cluster wraps rather than pushing "live" off the edge. */}
        <div className="flex flex-wrap items-center justify-end gap-2">
          {/* What caring has earned you, live (SPEC §13.1). It is the same
              number the shop's header shows, from the same place, so opening
              the shop can never disagree with the bar above it. Labelled, not
              bare: "🪙 330" read aloud is just "330". */}
          {stream.purse && (
            <span
              aria-label={`${stream.purse.coins} coins`}
              className="panel shrink-0 whitespace-nowrap !rounded-full px-2.5 py-1 text-xs font-semibold tabular-nums text-gold"
            >
              <span aria-hidden="true">🪙 </span>
              {stream.purse.coins}
            </span>
          )}
          {/* "👥 7 watching", as §11.2 draws it — now expandable into the
              presence list §2.11 promised: names, title chips, and the
              leader's crown (SPEC §24.4). A bare count read out as "busts in
              silhouette, 2" says nothing, and the emoji-and-a-digit shape is
              ambiguous besides — the meters carry a "👥 N caretakers this
              week" line that looks the same (SPEC §11.3). */}
          <details className="relative">
            <summary
              aria-live="polite"
              className="panel cursor-pointer list-none whitespace-nowrap !rounded-full px-2.5 py-1 text-xs text-muted [&::-webkit-details-marker]:hidden"
            >
              <span aria-hidden="true">👥 </span>
              {stream.presenceCount} watching
            </summary>
            <ul
              aria-label="Watching now"
              className="panel absolute right-0 top-full z-10 mt-1 flex min-w-44 flex-col gap-1 !rounded-2xl p-2.5 text-xs"
            >
              {stream.presenceCaretakers.map((watcher) => (
                <li key={watcher.id} className="flex items-center justify-between gap-3">
                  <span className="truncate">
                    {stream.crownedId === watcher.id && <span aria-label="current leader">👑 </span>}
                    {watcher.id === caretakerId ? "You" : watcher.name}
                  </span>
                  {watcher.titles.length > 0 && (
                    <span className="shrink-0">
                      {watcher.titles.map((titleId) =>
                        isTitleId(titleId) ? (
                          <span key={titleId} title={TITLES[titleId].label} aria-label={TITLES[titleId].label}>
                            {TITLES[titleId].chip}
                          </span>
                        ) : null,
                      )}
                    </span>
                  )}
                </li>
              ))}
              {stream.presenceCaretakers.length === 0 && <li className="text-muted">nobody yet — stay a while</li>}
            </ul>
          </details>
          {retro.found && (
            <button
              type="button"
              onClick={retro.toggle}
              aria-pressed={retro.on}
              aria-label="Retro display"
              className="press panel !rounded-full px-2.5 py-1 text-xs"
            >
              📺
            </button>
          )}
          <button
            type="button"
            onClick={toggleAudio}
            aria-pressed={!muted}
            aria-label={muted ? "Unmute sounds" : "Mute sounds"}
            className="press panel !rounded-full px-2.5 py-1 text-xs"
          >
            {muted ? "🔇" : "🔊"}
          </button>
          <span
            role="status"
            className={`panel flex items-center gap-1.5 !rounded-full px-2.5 py-1 text-xs ${stream.connected ? "text-mint" : "text-muted"}`}
          >
            {/* Steady, not pulsing. The word beside it already says "live";
                the dot only carries the colour. A perpetual animation here
                cost a third of a GPU, because it sits inside a frosted panel
                and re-blurred the whole page on every frame it drew. */}
            <span
              aria-hidden="true"
              className={`inline-block h-1.5 w-1.5 rounded-full ${stream.connected ? "bg-mint" : "bg-muted"}`}
            />
            {stream.connected ? "live" : "connecting"}
          </span>
        </div>
      </header>

      {/* Identity */}
      <div className="flex w-full items-baseline justify-between px-1">
        <h1 className="text-2xl font-extrabold tracking-tight">{isEgg ? "???" : petName}</h1>
        {ui && (
          <span className="flex items-center gap-1.5 text-xs text-muted">
            <span className="panel !rounded-full px-2 py-0.5">{age(ui.state)}</span>
            <span className="panel !rounded-full px-2 py-0.5">{STAGE_LABELS[stage ?? ""] ?? ""}</span>
            {ui.state.form && <span className="panel !rounded-full px-2 py-0.5 capitalize">{ui.state.form.toLowerCase()}</span>}
          </span>
        )}
      </div>

      {/* The habitat */}
      <div className="panel w-full overflow-hidden !rounded-3xl p-1.5">
        <div className="overflow-hidden rounded-[1.15rem] bg-[#2a2333]">
          <PetCanvas stream={stream} localSecret={localSecret} retro={retro.on} />
        </div>
        <p aria-live="polite" className="px-3 py-2 text-center text-sm text-muted">
          {statusText}
          {/* An away day reads as an outing, not a bug (SPEC §22.8). */}
          {venueLabel && ` 🧭 Out at ${venueLabel} today.`}
        </p>
      </div>

      {spectating && (
        <p aria-live="polite" className="panel animate-pop w-full !rounded-full px-4 py-2 text-center text-sm">
          🎮 {spectating.name === "You" ? "You are" : `${spectating.name} is`} playing {spectating.game} — score{" "}
          <strong className="tabular-nums text-gold">{spectating.score}</strong>
        </p>
      )}

      {ui && !isEgg && (
        <Meters
          percentages={ui.derived.percentages}
          population={ui.derived.population}
          careMultiplier={ui.derived.careMultiplier}
          petName={petName}
        />
      )}
      {ui && !isEgg && !isDead && <QuestBanner subscribe={questNudge} />}
      {ui && !isEgg && !isDead && (
        <WantBanner want={ui.state.wantOpen ?? null} nowTickExact={ui.nowTickExact} petName={petName} />
      )}
      {isEgg && <VotePanel />}
      {ui && !isEgg && !isDead && ctx && caretakerId && (
        <ActionBar
          state={ui.state}
          ctx={ctx}
          caretakerId={caretakerId}
          petName={petName}
          nowTickExact={ui.nowTickExact}
          onPlay={() => setPlaying(pickGame())}
        />
      )}

      {/* Reactions + shop in one strip (SPEC §2.11, §13.2) */}
      <div className="flex w-full items-center justify-between gap-2">
        <div role="group" aria-label="React" className="panel flex items-center gap-0.5 !rounded-full px-2 py-1">
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
              className="press rounded-full px-1.5 py-0.5 text-lg hover:bg-white/10"
            >
              {emoji}
            </button>
          ))}
        </div>
        {ui && !isEgg && !isDead && (
          <button
            type="button"
            onClick={() => setShopOpen((open) => !open)}
            aria-expanded={shopOpen}
            aria-label="Shop"
            className="press panel !rounded-full px-4 py-1.5 text-sm font-semibold hover:border-gold/40"
          >
            🛒 Shop
          </button>
        )}
      </div>

      {shopOpen && ui && !isEgg && !isDead && ctx && caretakerId && stream.room && stream.purse && (
        <ShopPanel
          state={ui.state}
          ctx={ctx}
          caretakerId={caretakerId}
          petName={petName}
          room={stream.room}
          purse={stream.purse}
          onFunded={onFunded}
          onClose={() => setShopOpen(false)}
        />
      )}
      {playing && <MinigameShell gameId={playing} onClose={() => setPlaying(null)} onReact={onReact} />}

      <FeedLog entries={feed} />

      <footer className="flex w-full flex-wrap items-center justify-between gap-2 px-1 pt-1 text-sm">
        <NicknameEditor key={profile?.nickname ?? ""} current={profile?.nickname ?? null} />
        <PushToggle />
        <nav className="flex gap-4 text-muted">
          <a href="/leaderboard" className="transition-colors hover:text-foreground">
            leaderboard
          </a>
          <a href="/memorial" className="transition-colors hover:text-foreground">
            memorial
          </a>
          <a href="/about" className="transition-colors hover:text-foreground">
            about
          </a>
          <a href="/about#credits" className="transition-colors hover:text-foreground">
            original sprites by Jingles 🩷
          </a>
        </nav>
      </footer>
    </div>
  );
}
