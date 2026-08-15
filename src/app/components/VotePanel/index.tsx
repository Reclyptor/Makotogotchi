"use client";

// The naming vote during incubation (SPEC §2.10): propose a name or move
// your one vote. The winner hatches with the egg.

import { useEffect, useState } from "react";

type TallyRow = { name: string; votes: number; mine: boolean };

const fetchTally = async (): Promise<TallyRow[] | null> => {
  const response = await fetch("/api/name-vote").catch(() => null);
  if (!response?.ok) return null;
  const body = (await response.json()) as { tally: TallyRow[] };
  return body.tally;
};

export default function VotePanel() {
  const [tally, setTally] = useState<TallyRow[]>([]);
  const [proposal, setProposal] = useState("");
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async (): Promise<void> => {
      const rows = await fetchTally();
      if (!cancelled && rows) setTally(rows);
    };
    void load();
    const timer = setInterval(() => void load(), 10_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  const post = async (body: object): Promise<void> => {
    setNotice(null);
    const response = await fetch("/api/name-vote", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).catch(() => null);
    if (!response) return;
    if (response.ok) {
      const data = (await response.json()) as { tally: TallyRow[] };
      setTally(data.tally);
      setProposal("");
    } else {
      const data = (await response.json().catch(() => null)) as { error?: string } | null;
      setNotice(
        data?.error === "EXISTS"
          ? "That name is already proposed — vote for it!"
          : data?.error === "INVALID"
            ? "2–16 letters, numbers, spaces, - or _."
            : "Couldn't do that right now.",
      );
    }
  };

  return (
    <section aria-label="Name the egg" className="flex w-full flex-col gap-2 rounded-lg bg-surface p-3">
      <h2 className="text-sm font-semibold">🥚 A new egg is incubating — name it!</h2>
      <p className="text-xs text-muted">The name with the most votes hatches with the egg. One vote each.</p>
      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (proposal.trim()) void post({ propose: proposal });
        }}
      >
        <input
          value={proposal}
          onChange={(event) => setProposal(event.target.value)}
          placeholder="Propose a name…"
          maxLength={16}
          aria-label="Propose a name"
          className="min-w-0 flex-1 rounded-md bg-black/30 px-2 py-1 text-sm outline-offset-2"
        />
        <button type="submit" className="rounded-md bg-accent/30 px-3 py-1 text-sm hover:bg-accent/40">
          Propose
        </button>
      </form>
      {notice && (
        <p aria-live="polite" className="text-xs text-rose-300">
          {notice}
        </p>
      )}
      <ul className="flex flex-col gap-1">
        {tally.map((row) => (
          <li key={row.name} className="flex items-center justify-between gap-2 text-sm">
            <span>
              {row.name} {row.mine && <span aria-label="your vote">✔</span>}
            </span>
            <span className="flex items-center gap-2">
              <span className="tabular-nums text-muted">{row.votes}</span>
              {!row.mine && (
                <button
                  type="button"
                  onClick={() => void post({ voteFor: row.name })}
                  className="rounded-md bg-black/30 px-2 py-0.5 text-xs hover:bg-accent/30"
                >
                  Vote
                </button>
              )}
            </span>
          </li>
        ))}
        {tally.length === 0 && <li className="text-xs text-muted">No proposals yet — the egg waits for a name.</li>}
      </ul>
    </section>
  );
}
