// POST /api/react — broadcast an emoji reaction (SPEC §2.11, §9). Zero
// moderation surface by construction: the emoji must be one of a fixed set,
// and nothing else in the payload reaches other clients.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/server/db/client";
import { key, redis } from "@/server/redis/client";
import { LIMITS, takeToken } from "@/server/ratelimit";
import { anonymousName, nicknameMap } from "@/server/social";
import { caretakerCookieHeader, clientIp, resolveCaretaker } from "@/server/http";
import type { EngineMessage } from "@/server/engine/messages";

export const REACTION_EMOJI = ["❤️", "💛", "😂", "😮", "😢", "🎉"] as const;

const bodySchema = z.object({ emoji: z.enum(REACTION_EMOJI) });

export async function POST(request: NextRequest): Promise<NextResponse> {
  const identity = resolveCaretaker(request);
  const withCookie = (response: NextResponse): NextResponse => {
    if (identity.setCookie) response.headers.set("Set-Cookie", caretakerCookieHeader(identity.setCookie));
    return response;
  };

  const ipBucket = await takeToken(redis(), key(`rl:ip:${clientIp(request)}`), LIMITS.perIp.capacity, LIMITS.perIp.refillPerSecond);
  if (!ipBucket.allowed) {
    return withCookie(
      NextResponse.json({ error: "rate_limited" }, { status: 429, headers: { "Retry-After": String(ipBucket.retryAfterSeconds) } }),
    );
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return withCookie(NextResponse.json({ error: "invalid_body" }, { status: 400 }));

  const names = await nicknameMap(await db(), [identity.caretakerId]);
  const message: EngineMessage = {
    type: "react",
    emoji: parsed.data.emoji,
    caretakerId: identity.caretakerId,
    caretakerName: names.get(identity.caretakerId) ?? anonymousName(identity.caretakerId),
  };
  await redis().publish(key("events"), JSON.stringify(message));
  return withCookie(NextResponse.json({ ok: true }));
}
