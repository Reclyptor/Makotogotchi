"use client";

// The action feed as semantic HTML (SPEC §11.3): everything the canvas
// shows as floating toasts also lands here, in an aria-live log screen
// readers and keyboard users get for free.

export type FeedEntry = {
  id: number;
  text: string;
  at: string; // pre-formatted local time
};

export type FeedLogProps = {
  entries: readonly FeedEntry[];
};

export default function FeedLog({ entries }: FeedLogProps) {
  return (
    <section aria-label="Care feed" className="w-full">
      <ol aria-live="polite" aria-relevant="additions" className="flex max-h-40 flex-col-reverse gap-1 overflow-y-auto text-sm">
        {entries.map((entry) => (
          <li key={entry.id} className="flex gap-2">
            <time className="shrink-0 tabular-nums text-muted">{entry.at}</time>
            <span>{entry.text}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
