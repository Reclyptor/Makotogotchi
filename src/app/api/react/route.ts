// POST /api/react — broadcast an emoji reaction (SPEC §2.11, §9). Zero
// moderation surface by construction: the emoji must be one of a fixed set,
// and nothing else in the payload reaches other clients.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/server/db/client";
import { key, redis } from "@/server/redis/client";
import { anonymousName, nicknameMap } from "@/server/social";
import { caretakerCookieHeader, rateLimit, resolveCaretaker } from "@/server/http";
import type { EngineMessage } from "@/server/engine/messages";

export const REACTION_EMOJI = ["❤️", "💛", "😂", "😮", "😢", "🎉"] as const;

const bodySchema = z.object({ emoji: z.enum(REACTION_EMOJI) });

export async function POST(request: NextRequest): Promise<NextResponse> {
  const identity = resolveCaretaker(request);
  const withCookie = (response: NextResponse): NextResponse => {
    if (identity.setCookie) response.headers.set("Set-Cookie", caretakerCookieHeader(identity.setCookie));
    return response;
  };

  // A reaction reaches every open stream in the room, so it is metered per
  // caretaker as well as per address — the address bucket alone left one
  // identity free to paper the room from a handful of them.
  const limited = await rateLimit(request, { kind: "write", caretakerId: identity.caretakerId });
  if (limited) return withCookie(limited);

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
