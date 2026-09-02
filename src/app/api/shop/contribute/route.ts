// POST /api/shop/contribute — put coins into a grand item's pool (SPEC §21.8).
// Contributions are non-refundable by design; the only money that ever comes
// back is an overshoot past the price, which the pool refuses to keep.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/server/db/client";
import { key, redis } from "@/server/redis/client";
import { runtime } from "@/server/runtime";
import { contribute } from "@/server/shop";
import { anonymousName, nicknameMap } from "@/server/social";
import { caretakerCookieHeader, rateLimit, resolveCaretaker } from "@/server/http";
import type { EngineMessage } from "@/server/engine/messages";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  itemId: z.string().min(1).max(64),
  amount: z.union([z.literal(10), z.literal(50), z.literal("all")]),
});

const STATUS: Record<string, number> = { UNKNOWN_ITEM: 400, INSUFFICIENT_COINS: 402, ALREADY_FUNDED: 409 };

export async function POST(request: NextRequest): Promise<NextResponse> {
  const identity = resolveCaretaker(request);
  const withCookie = (response: NextResponse): NextResponse => {
    if (identity.setCookie) response.headers.set("Set-Cookie", caretakerCookieHeader(identity.setCookie));
    return response;
  };

  // Spends coins, like its sibling vote route — both buckets.
  const limited = await rateLimit(request, { kind: "write", caretakerId: identity.caretakerId });
  if (limited) return withCookie(limited);

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return withCookie(NextResponse.json({ error: "invalid_body" }, { status: 400 }));

  const database = await db();
  const result = await contribute(database, identity.caretakerId, parsed.data.itemId, parsed.data.amount);
  if (!result.ok) {
    return withCookie(NextResponse.json({ error: result.reason }, { status: STATUS[result.reason] ?? 400 }));
  }

  if (result.funded) {
    // The durable fact goes in the log so it replays and every room
    // celebrates; the names ride a broadcast, the way records do.
    const { engine, generation } = await runtime();
    const current = await generation();
    await engine.milestone(current, "FUNDED", result.itemId);

    const names = await nicknameMap(database, result.top.map((entry) => entry.caretakerId));
    const message: EngineMessage = {
      type: "funded",
      itemId: result.itemId,
      label: result.label,
      contributors: result.top.map((entry) => ({
        name: names.get(entry.caretakerId) ?? anonymousName(entry.caretakerId),
        amount: entry.amount,
      })),
    };
    await redis().publish(key("events"), JSON.stringify(message));
  }

  return withCookie(
    NextResponse.json({ ok: true, spent: result.spent, pooled: result.pooled, price: result.price, funded: result.funded }),
  );
}
