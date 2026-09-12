"use client";

// Saying goodbye (SPEC §2.10): while the gravestone is up, one line each.
// The list arrives live over the stream and is fetched once on mount for
// anyone who opened the page after the first goodbye landed. Every farewell
// renders as a text node — the server refuses anything but its allowlist,
// and this side never treats a line as markup either.

import { useEffect, useState } from "react";
import type { FarewellView } from "@/server/farewells";

type Props = {
  petName: string;
  caretakerId: string | null;
  farewells: FarewellView[];
};

const NOTICES: Record<string, string> = {
  INVALID: "Letters, numbers and plain punctuation only — 2 to 80 characters.",
  BLOCKED: "That one can't go on the wall.",
  NOT_MOURNING: "The moment has passed.",
  not_mourning: "The moment has passed.",
  invalid_body: "Letters, numbers and plain punctuation only — 2 to 80 characters.",
};

export default function FarewellPanel({ petName, caretakerId, farewells }: Props) {
  // What this page fetched or posted itself. The stream's list wins the
  // moment it arrives — it is the whole list, like the room's — and the
  // fetch only covers a caretaker who opened the page after a goodbye landed.
  const [local, setLocal] = useState<FarewellView[]>([]);
  const [draft, setDraft] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/farewell")
      .then((response) => (response.ok ? (response.json() as Promise<{ farewells: FarewellView[] }>) : null))
      .then((body) => {
        if (body && !cancelled) setLocal(body.farewells);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const lines = farewells.length > 0 ? farewells : local;
  const mine = lines.find((line) => line.caretakerId === caretakerId);

  const send = async (): Promise<void> => {
    setNotice(null);
    setSending(true);
    const response = await fetch("/api/farewell", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: draft }),
    }).catch(() => null);
    setSending(false);
    if (!response) return;
    if (response.ok) {
      const body = (await response.json()) as { farewells: FarewellView[] };
      setLocal(body.farewells);
      setDraft("");
      return;
    }
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    setNotice(NOTICES[body.error ?? ""] ?? "That didn't go through.");
  };

  return (
    <section aria-label={`Farewells for ${petName}`} className="panel animate-pop flex w-full flex-col gap-2 p-4">
      <h2 className="text-sm font-semibold">🕯️ Say goodbye to {petName}</h2>
      <p className="text-xs text-muted">One line each. It stays on the memorial beside the name.</p>
      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (draft.trim() && !sending) void send();
        }}
      >
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={mine ? "Change your farewell…" : "Sleep well…"}
          maxLength={80}
          aria-label="Your farewell"
          className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/30 px-2.5 py-1.5 text-sm outline-offset-2 focus:border-accent/50"
        />
        <button
          type="submit"
          disabled={sending}
          className="press rounded-lg bg-accent-strong px-3.5 py-1.5 text-sm font-semibold text-white hover:brightness-110"
        >
          {mine ? "Update" : "Leave it"}
        </button>
      </form>
      {notice && (
        <p aria-live="polite" className="text-xs text-rose-300">
          {notice}
        </p>
      )}
      <ul aria-live="polite" className="flex flex-col gap-1">
        {lines.map((line) => (
          <li key={line.caretakerId} className="text-sm">
            <span className="text-muted">{line.name}: </span>
            <span className="italic">{line.text}</span>
          </li>
        ))}
        {lines.length === 0 && <li className="text-xs text-muted">No one has said goodbye yet.</li>}
      </ul>
    </section>
  );
}
