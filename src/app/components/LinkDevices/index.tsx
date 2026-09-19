"use client";

// Linking devices (SPEC §8.1). A named caretaker can show a code; any device
// can enter one and become that caretaker. Claiming reloads the page: the
// cookie changed, and everything — the stream, the purse, the name — has to
// come back as the linked person.
//
// The entry point says what linking is *for*, because "use this name on
// another device" read as a convenience nobody needed and the feature went
// unused. A caretaker is a cookie, and a score, a purse, a pack and a streak
// all hang off it — so a second device does not extend you, it halves you:
// two part-scores, two part-streaks, and a name each, since nicknames are
// unique. That is the reason to link, and it is a reason about the player
// rather than about the population count (§23.1), which is merely what the
// room gets out of it.

import { useState } from "react";

type Props = { named: boolean };

export default function LinkDevices({ named }: Props) {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState<string | null>(null);
  const [entered, setEntered] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const mint = async (): Promise<void> => {
    setNotice(null);
    setBusy(true);
    const response = await fetch("/api/link", { method: "POST" }).catch(() => null);
    setBusy(false);
    if (!response?.ok) {
      setNotice(response?.status === 403 ? "Pick a name first — a code carries your name across." : "Couldn't make a code just now.");
      return;
    }
    const body = (await response.json()) as { code: string };
    setCode(body.code);
  };

  const claim = async (): Promise<void> => {
    setNotice(null);
    setBusy(true);
    const response = await fetch("/api/link/claim", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: entered }),
    }).catch(() => null);
    setBusy(false);
    if (!response) return;
    if (response.ok) {
      window.location.reload();
      return;
    }
    setNotice(response.status === 404 ? "That code isn't live. Codes last ten minutes and work once." : "That didn't go through.");
  };

  if (!open) {
    return (
      <p className="text-xs text-muted">
        <span aria-hidden="true">📱 </span>
        {named ? "Caring on a phone as well as a laptop? " : "Already have a name on another device? "}
        <button type="button" onClick={() => setOpen(true)} className="font-semibold text-foreground underline underline-offset-2 hover:text-accent">
          {named ? "Link them" : "Link this device"}
        </button>
        {named ? " — one name, one score, one streak." : " — bring your score and your pack across."}
      </p>
    );
  }

  return (
    <section aria-label="Link devices" className="flex w-full flex-col gap-2 rounded-lg border border-white/10 p-3 text-sm">
      {named && (
        <div className="flex flex-col gap-1">
          <p className="text-xs text-muted">
            Show a code here, enter it on the other device. It lasts ten minutes and works once. Unlinked, each device is a
            separate caretaker with its own score, coins and streak — linking makes them one.
          </p>
          {code ? (
            <p aria-live="polite" className="font-pixel text-center text-lg tracking-[0.3em]">
              {code}
            </p>
          ) : (
            <button
              type="button"
              disabled={busy}
              onClick={() => void mint()}
              className="press self-start rounded-lg bg-accent-strong px-3.5 py-1.5 text-sm font-semibold text-white hover:brightness-110"
            >
              Show a code
            </button>
          )}
        </div>
      )}
      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (entered.trim() && !busy) void claim();
        }}
      >
        <input
          value={entered}
          onChange={(event) => setEntered(event.target.value)}
          placeholder="Code from your other device"
          maxLength={8}
          autoCapitalize="characters"
          autoComplete="off"
          aria-label="Code from your other device"
          className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/30 px-2.5 py-1.5 text-sm uppercase tracking-widest outline-offset-2 focus:border-accent/50"
        />
        <button type="submit" disabled={busy} className="press rounded-lg bg-white/10 px-3.5 py-1.5 text-sm font-semibold hover:bg-accent/30">
          Link
        </button>
      </form>
      {named && <p className="text-xs text-muted">Linking here makes this device someone else — the name above goes with it.</p>}
      {notice && (
        <p aria-live="polite" className="text-xs text-rose-300">
          {notice}
        </p>
      )}
      <button type="button" onClick={() => setOpen(false)} className="self-start text-xs text-muted underline underline-offset-2 hover:text-foreground">
        close
      </button>
    </section>
  );
}
