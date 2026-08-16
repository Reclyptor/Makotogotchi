"use client";

// The activity timeline: seeded from /api/feed history so a refresh keeps
// the tail, then extended live. Newest entries sit at the bottom; the log
// follows them automatically while the reader is at the bottom, and locks
// in place the moment they scroll up — a "new activity" pill offers the way
// back down. Everything it shows also reaches screen readers via the
// aria-live region (SPEC §11.3).

import { useEffect, useRef, useState } from "react";

export type FeedEntry = {
  id: number | string;
  icon: string;
  text: string;
  at: string; // pre-formatted local time
};

export type FeedLogProps = {
  entries: readonly FeedEntry[];
};

const FOLLOW_THRESHOLD_PX = 32;

export default function FeedLog({ entries }: FeedLogProps) {
  const scrollerRef = useRef<HTMLOListElement | null>(null);
  const followingRef = useRef(true);
  const [following, setFollowing] = useState(true);
  const [unseen, setUnseen] = useState(0);

  // Follow state is derived from where the user actually is: at (or near)
  // the bottom means follow; anywhere else means they are reading history.
  const onScroll = (): void => {
    const el = scrollerRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight <= FOLLOW_THRESHOLD_PX;
    followingRef.current = atBottom;
    setFollowing(atBottom);
    if (atBottom) setUnseen(0);
  };

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    if (followingRef.current) {
      el.scrollTop = el.scrollHeight;
      setUnseen(0);
    } else {
      setUnseen((count) => count + 1);
    }
  }, [entries]);

  const jumpToLatest = (): void => {
    const el = scrollerRef.current;
    if (!el) return;
    followingRef.current = true;
    setFollowing(true);
    setUnseen(0);
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  };

  return (
    <section aria-label="Care feed" className="panel relative w-full overflow-hidden">
      <ol
        ref={scrollerRef}
        onScroll={onScroll}
        aria-live="polite"
        aria-relevant="additions"
        className="flex max-h-52 min-h-24 flex-col gap-0.5 overflow-y-auto px-3 py-2"
      >
        {entries.length === 0 && <li className="py-2 text-center text-sm text-muted">Quiet so far…</li>}
        {entries.map((entry) => (
          <li key={entry.id} className="animate-rise flex items-baseline gap-2 rounded-lg px-1.5 py-1 text-sm hover:bg-white/[0.03]">
            <span aria-hidden="true" className="w-5 shrink-0 text-center">
              {entry.icon}
            </span>
            <span className="min-w-0 flex-1">{entry.text}</span>
            <time className="shrink-0 text-[11px] tabular-nums text-muted">{entry.at}</time>
          </li>
        ))}
      </ol>

      {!following && unseen > 0 && (
        <button
          type="button"
          onClick={jumpToLatest}
          className="press animate-pop absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full bg-accent-strong px-3 py-1 text-xs font-semibold text-white shadow-lg shadow-accent-strong/40"
        >
          ↓ {unseen} new
        </button>
      )}
    </section>
  );
}
