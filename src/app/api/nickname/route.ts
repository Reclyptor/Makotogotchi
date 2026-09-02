// POST /api/nickname — set or change the caretaker's display name
// (SPEC §8.5): NFKC-normalized, pattern-validated, case-insensitively
// unique, blocklist-screened, changeable once per 24h.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/server/db/client";
import { setNickname } from "@/server/social";
import { caretakerCookieHeader, rateLimit, resolveCaretaker } from "@/server/http";

const bodySchema = z.object({ nickname: z.string().min(1).max(64) });

const STATUS: Record<string, number> = { INVALID: 400, BLOCKED: 400, TAKEN: 409, TOO_SOON: 429 };

export async function POST(request: NextRequest): Promise<NextResponse> {
  const identity = resolveCaretaker(request);
  const withCookie = (response: NextResponse): NextResponse => {
    if (identity.setCookie) response.headers.set("Set-Cookie", caretakerCookieHeader(identity.setCookie));
    return response;
  };

  // The 24h change interval below is a game rule, not a flood guard: every
  // rejected attempt still costs a read and a uniqueness probe against an
  // indexed collection, and nothing stopped those from arriving as fast as
  // they could be sent.
  const limited = await rateLimit(request, { kind: "write", caretakerId: identity.caretakerId });
  if (limited) return withCookie(limited);

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return withCookie(NextResponse.json({ error: "invalid_body" }, { status: 400 }));

  const result = await setNickname(await db(), identity.caretakerId, parsed.data.nickname);
  return withCookie(
    result.ok
      ? NextResponse.json({ nickname: result.nickname })
      : NextResponse.json({ error: result.reason }, { status: STATUS[result.reason] ?? 400 }),
  );
}
