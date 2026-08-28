"use client";

// The shop's data and everything that spends coins. Kept apart from the panel
// so the panel is only layout, and so the one place that talks to the shop
// routes is the one place that knows what their errors mean.
//
// What it fetches is deliberately narrow, and now as narrow as it goes: the
// room, the installed toys, the balance and the pack are all live on the
// stream (SPEC §7.2) and arrive as props, so the shop holds no copy of
// anything the stream already knows and cannot disagree with the game screen
// behind it. What is left has no live channel — the catalog, which is static
// per deploy, and the co-op pools, whose intermediate totals are only
// announced when one completes — so those are read here and re-read after
// anything that could move them.

import { useCallback, useEffect, useState } from "react";
import { isLockReason, rejectionText } from "../ActionBar/copy";
import type { ShopCatalog } from "./tabs";
import type { FundingView } from "@/server/shop";

/**
 * The parts of GET /api/shop the shop still reads. The response also carries
 * coins, inventory and the room — it is a general endpoint and other callers
 * want them — but the panel takes those from the stream instead.
 */
export type ShopData = {
  catalog: ShopCatalog;
  funding: FundingView[];
};

const post = async (url: string, body: unknown): Promise<{ status: number; body: unknown } | null> => {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).catch(() => null);
  if (!response) return null;
  return { status: response.status, body: await response.json().catch(() => null) };
};

const errorOf = (body: unknown): string | undefined =>
  typeof body === "object" && body !== null && "error" in body && typeof body.error === "string" ? body.error : undefined;

const reasonOf = (body: unknown): string | undefined =>
  typeof body === "object" && body !== null && "reason" in body && typeof body.reason === "string"
    ? body.reason
    : undefined;

/** What a failed spend means, said the way a player would say it. */
const spendNotice = (error: string | undefined, fallback: string): string => {
  if (error === "INSUFFICIENT_COINS") return "Not enough coins — care for Makoto to earn more.";
  if (error === "ALREADY_OWNED") return "Already owned.";
  if (error === "ALREADY_FUNDED") return "Already funded.";
  return fallback;
};

export type Shop = {
  data: ShopData | null;
  notice: string | null;
  buy: (itemId: string, label: string) => Promise<void>;
  use: (itemId: string, care: "FEED" | "MEDICATE") => Promise<void>;
  chipIn: (itemId: string, amount: 10 | 50 | "all") => Promise<void>;
  wear: (itemId: string | null) => Promise<void>;
  switchTheme: (themeId: string) => Promise<void>;
};

export const useShop = (petName: string, onFunded: (listener: () => void) => () => void): Shop => {
  const [data, setData] = useState<ShopData | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    const response = await fetch("/api/shop").catch(() => null);
    if (response?.ok) setData((await response.json()) as ShopData);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const response = await fetch("/api/shop").catch(() => null);
      if (response?.ok && !cancelled) setData((await response.json()) as ShopData);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Someone else clearing a pool changes what this shop should be offering,
  // and that edge is the one thing the stream does tell us about (SPEC §21.8).
  useEffect(() => onFunded(() => void refresh()), [onFunded, refresh]);

  const buy = useCallback(
    async (itemId: string, label: string): Promise<void> => {
      setNotice(null);
      const result = await post("/api/shop", { buy: itemId });
      if (!result) return;
      setNotice(result.status === 200 ? `Bought ${label}!` : spendNotice(errorOf(result.body), "Couldn't buy that."));
      await refresh();
    },
    [refresh],
  );

  // Using something from the pack is a care action like any other, so it comes
  // back with the sim's own reason when the pet cannot take it.
  const use = useCallback(
    async (itemId: string, care: "FEED" | "MEDICATE"): Promise<void> => {
      setNotice(null);
      const result = await post("/api/care", { action: care, itemId });
      if (!result) return;
      if (result.status === 200) {
        setNotice("Used it — look at the room!");
      } else {
        const reason = reasonOf(result.body);
        setNotice(isLockReason(reason) ? `${rejectionText(petName)[reason]}.` : `${petName} can't right now.`);
      }
      await refresh();
    },
    [petName, refresh],
  );

  const chipIn = useCallback(
    async (itemId: string, amount: 10 | 50 | "all"): Promise<void> => {
      setNotice(null);
      const result = await post("/api/shop/contribute", { itemId, amount });
      if (!result) return;
      if (result.status === 200) {
        const body = result.body as { funded: boolean; spent: number };
        setNotice(body.funded ? "Funded! Look at the room." : `Chipped in ${body.spent} 🪙.`);
      } else {
        setNotice(spendNotice(errorOf(result.body), "Couldn't chip in."));
      }
      await refresh();
    },
    [refresh],
  );

  const wear = useCallback(
    async (itemId: string | null): Promise<void> => {
      setNotice(null);
      await post("/api/shop", { wear: itemId });
      await refresh();
    },
    [refresh],
  );

  const switchTheme = useCallback(
    async (themeId: string): Promise<void> => {
      setNotice(null);
      const result = await post("/api/shop", { theme: themeId });
      if (result?.status === 200) setNotice("The room changes for everyone.");
      await refresh();
    },
    [refresh],
  );

  return { data, notice, buy, use, chipIn, wear, switchTheme };
};
