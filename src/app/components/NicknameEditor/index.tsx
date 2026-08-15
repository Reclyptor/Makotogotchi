"use client";

// Optional display name (SPEC §8.5): the single strongest engagement hook —
// attribution — behind one tiny form.

import { useState } from "react";

export type NicknameEditorProps = {
  /** Remount with a `key` when this changes — state initializes from it. */
  current: string | null;
};

export default function NicknameEditor({ current }: NicknameEditorProps) {
  const [value, setValue] = useState(current ?? "");
  const [saved, setSaved] = useState<string | null>(current);
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);

  const submit = async (): Promise<void> => {
    setNotice(null);
    const response = await fetch("/api/nickname", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nickname: value }),
    }).catch(() => null);
    if (!response) return;
    if (response.ok) {
      const body = (await response.json()) as { nickname: string };
      setSaved(body.nickname);
      setEditing(false);
    } else {
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      setNotice(
        body?.error === "TAKEN"
          ? "That name is taken."
          : body?.error === "TOO_SOON"
            ? "You can change your name once a day."
            : "2–16 letters, numbers, spaces, - or _.",
      );
    }
  };

  if (!editing) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted">
        {saved ? (
          <>
            Caring as <span className="font-semibold text-foreground">{saved}</span>
          </>
        ) : (
          "Caring anonymously"
        )}
        <button type="button" onClick={() => setEditing(true)} className="underline underline-offset-2 hover:text-foreground">
          {saved ? "change name" : "pick a name"}
        </button>
      </p>
    );
  }

  return (
    <form
      className="flex flex-wrap items-center gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <input
        value={value}
        onChange={(event) => setValue(event.target.value)}
        maxLength={16}
        autoFocus
        aria-label="Your display name"
        className="rounded-md bg-black/30 px-2 py-1 text-sm outline-offset-2"
      />
      <button type="submit" className="rounded-md bg-accent/30 px-3 py-1 text-sm hover:bg-accent/40">
        Save
      </button>
      <button type="button" onClick={() => setEditing(false)} className="text-sm text-muted underline underline-offset-2">
        cancel
      </button>
      {notice && (
        <span aria-live="polite" className="text-xs text-rose-300">
          {notice}
        </span>
      )}
    </form>
  );
}
