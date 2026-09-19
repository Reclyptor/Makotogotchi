// POST /api/care — perform a care action (SPEC §9). Nothing from the client
// is trusted beyond the action name; magnitudes and resulting state are
// computed by src/sim on the server (SPEC §8.4).
//
// 429 means "you are moving too fast" (rate limit, Retry-After header).
// 409 means "the pet can't accept that right now" (game rules) — a different
// thing, and the UI says so differently.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { CARE_ACTIONS } from "@/sim/tuning";
import { runtime } from "@/server/runtime";
import { db } from "@/server/db/client";
import { key, redis } from "@/server/redis/client";
import { recordContribution } from "@/server/social";
import { settleWantFulfillment } from "@/server/wants";
import { rollTitles } from "@/server/titles";
import { consumeItem, refundItem } from "@/server/shop";
import { env } from "@/server/env";
import { caretakerCookieHeader, rateLimit, resolveCaretaker } from "@/server/http";

const bodySchema = z.object({
  action: z.enum(CARE_ACTIONS),
  itemId: z.string().min(1).max(64).optional(),
});

export async function POST(request: NextRequest): Promise<NextResponse> {
  const identity = resolveCaretaker(request);
  const withCookie = (response: NextResponse): NextResponse => {
    if (identity.setCookie) response.headers.set("Set-Cookie", caretakerCookieHeader(identity.setCookie));
    return response;
  };

  const limited = await rateLimit(request, { kind: "write", caretakerId: identity.caretakerId });
  if (limited) return withCookie(limited);

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return withCookie(NextResponse.json({ error: "invalid_body" }, { status: 400 }));
  }

  const { engine, generation } = await runtime();
  const current = await generation();

  // A consumable must be owned and is consumed up front — the reservation is
  // what stops two requests spending the same last one — and it is handed
  // back if the action does not happen or does nothing (SPEC §13.2).
  const { itemId } = parsed.data;
  if (itemId !== undefined && !(await consumeItem(await db(), identity.caretakerId, itemId))) {
    return withCookie(NextResponse.json({ error: "not_now", reason: "NO_ITEM" }, { status: 409 }));
  }

  const outcome = await engine.care(current, parsed.data.action, identity.caretakerId, {
    ...(itemId !== undefined ? { itemId } : {}),
  });

  if (!outcome.ok) {
    if (itemId !== undefined) await refundItem(await db(), identity.caretakerId, itemId);
    return withCookie(
      NextResponse.json(
        {
          error: "not_now",
          reason: outcome.rejection.reason,
          ...(outcome.rejection.retryAtTick !== undefined ? { retryAtTick: outcome.rejection.retryAtTick } : {}),
        },
        { status: 409 },
      ),
    );
  }

  // An accepted action that moved nothing did not use the item up. A pet with
  // a full belly still takes the joy off a Fish Feast, so this is not
  // "applied === 0" — it is the sim reporting that nothing about the pet
  // changed, in which case the caretaker keeps what they paid for.
  const wasted = itemId !== undefined && !outcome.changed;
  if (wasted) await refundItem(await db(), identity.caretakerId, itemId);

  // Roll the accepted action into the social ledgers (SPEC §2.11, §13.1).
  const ledger = await recordContribution(await db(), {
    caretakerId: identity.caretakerId,
    generationId: current.id,
    action: parsed.data.action,
    applied: outcome.applied,
    tick: outcome.state.tick,
    changed: outcome.changed,
  });
  // Granting a wish pays extra (SPEC §25.4).
  const wantCoins = await settleWantFulfillment(await db(), identity.caretakerId, outcome.milestones);
  // And the title race advances (SPEC §24.3).
  await rollTitles(
    await db(),
    async (message) => {
      await redis().publish(key("events"), JSON.stringify(message));
    },
    {
      generation: current,
      caretakerId: identity.caretakerId,
      action: parsed.data.action,
      ...(itemId !== undefined ? { itemId } : {}),
      tick: outcome.state.tick,
      timeZone: env().PET_TIMEZONE,
      milestones: outcome.milestones,
    },
  );

  return withCookie(
    NextResponse.json({
      applied: outcome.applied,
      tick: outcome.state.tick,
      score: ledger.score,
      coins: ledger.coins + wantCoins,
      streakDays: ledger.streakDays,
      // So the shop can say the item is still in the pack rather than
      // claiming it was used (SPEC §13.2).
      ...(wasted ? { itemKept: true } : {}),
    }),
  );
}
