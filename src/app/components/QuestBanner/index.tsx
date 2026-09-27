"use client";

// The daily communal goal (SPEC §21.7): one slim glass strip between the
// meters and the actions. Progress is derived server-side, so the banner
// just re-asks — on load, and again whenever something happened that could
// plausibly have moved it. Exactness between refreshes is not the point;
// knowing the room is working on something together is.

import { useCallback, useEffect, useRef, useState } from "react";

const REFRESH_DEBOUNCE_MS = 1500;
const COPIED_MS = 2000;

export type QuestPayload = {
  dayIndex: number;
  quest: { id: string; title: string; description: string; unit: string };
  current: number;
  target: number;
  settled: boolean;
  /** Distinct caretakers who have helped today, and how many the day wants. */
  helpers: number;
  handsTarget: number;
};

export type QuestBannerProps = {
  /** Subscribes to the stream events that can move the day's progress. */
  subscribe: (listener: () => void) => () => void;
};

export default function QuestBanner({ subscribe }: QuestBannerProps) {
  const [quest, setQuest] = useState<QuestPayload | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const pendingRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    const response = await fetch("/api/quest").catch(() => null);
    if (response?.ok) setQuest((await response.json()) as QuestPayload);
  }, []);

  // The link carries the day and the count as a cache key (SPEC §21.7): a
  // chat unfurls each distinct URL once, so a link shared at 23/30 and again
  // at 27/30 gets a fresh card both times. The page ignores the query.
  const share = useCallback(async (): Promise<void> => {
    if (!quest) return;
    const url = `${window.location.origin}/?goal=${quest.dayIndex}-${quest.current}`;
    if (typeof navigator.share === "function") {
      await navigator.share({ url }).catch(() => null);
      return;
    }
    const ok = await navigator.clipboard.writeText(url).then(() => true, () => false);
    setCopied(ok ? "Copied — paste it in the chat" : "Couldn't copy — the link is in the address bar");
    setTimeout(() => setCopied(null), COPIED_MS);
  }, [quest]);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/quest")
      .then(async (response) => {
        if (response.ok && !cancelled) setQuest((await response.json()) as QuestPayload);
      })
      .catch(() => null);
    return () => {
      cancelled = true;
    };
  }, []);

  // A burst of care is one refresh, not ten.
  useEffect(() => {
    const off = subscribe(() => {
      if (pendingRef.current) return;
      pendingRef.current = setTimeout(() => {
        pendingRef.current = null;
        void refresh();
      }, REFRESH_DEBOUNCE_MS);
    });
    return () => {
      off();
      if (pendingRef.current) clearTimeout(pendingRef.current);
      pendingRef.current = null;
    };
  }, [subscribe, refresh]);

  if (!quest) return null;

  const fraction = Math.max(0, Math.min(1, quest.current / quest.target));
  return (
    <section aria-label="Today's goal" className="panel relative w-full overflow-hidden !rounded-full px-4 py-2">
      <p className="flex items-baseline justify-between gap-3 text-sm">
        <span className="min-w-0 truncate">
          <span aria-hidden="true">{quest.settled ? "✅ " : "🎯 "}</span>
          <strong>{quest.quest.title}</strong>
          <span className="text-muted"> — {quest.quest.description}</span>
        </span>
        <span aria-live="polite" className="shrink-0 tabular-nums text-muted">
          {copied ? (
            <span className="text-mint">{copied}</span>
          ) : quest.settled ? (
            <span className="font-semibold text-gold">done! +15 🪙 to today&apos;s caretakers</span>
          ) : (
            <>
              {quest.current}/{quest.target}
              {/* Many hands counts caretakers already — saying it twice would
                  just be the same fraction beside itself. */}
              {quest.quest.id !== "many-hands" && (
                <>
                  {" · "}
                  {quest.helpers}/{quest.handsTarget}
                  <span aria-hidden="true"> 🙋</span>
                  <span className="sr-only"> caretakers</span>
                </>
              )}
            </>
          )}
        </span>
        <button
          type="button"
          onClick={() => void share()}
          aria-label="Share today's goal"
          title="Share today's goal"
          className="press -mr-2 shrink-0 rounded-full px-2 text-base leading-none text-muted hover:text-foreground"
        >
          <span aria-hidden="true">↗</span>
        </button>
      </p>
      <span aria-hidden="true" className="absolute inset-x-0 bottom-0 h-[3px] bg-white/5">
        <span
          className={`block h-full rounded-r-full transition-[width] duration-500 ease-out ${quest.settled ? "bg-gold" : "bg-accent"}`}
          style={{ width: `${(quest.settled ? 1 : fraction) * 100}%` }}
        />
      </span>
    </section>
  );
}
