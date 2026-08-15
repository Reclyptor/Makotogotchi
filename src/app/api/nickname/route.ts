// POST /api/nickname — set or change the caretaker's display name
// (SPEC §8.5): NFKC-normalized, pattern-validated, case-insensitively
// unique, blocklist-screened, changeable once per 24h.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/server/db/client";
import { setNickname } from "@/server/social";
import { caretakerCookieHeader, resolveCaretaker } from "@/server/http";

const bodySchema = z.object({ nickname: z.string().min(1).max(64) });

const STATUS: Record<string, number> = { INVALID: 400, BLOCKED: 400, TAKEN: 409, TOO_SOON: 429 };

export async function POST(request: NextRequest): Promise<NextResponse> {
  const identity = resolveCaretaker(request);
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_body" }, { status: 400 });

  const result = await setNickname(await db(), identity.caretakerId, parsed.data.nickname);
  const response = result.ok
    ? NextResponse.json({ nickname: result.nickname })
    : NextResponse.json({ error: result.reason }, { status: STATUS[result.reason] ?? 400 });
  if (identity.setCookie) response.headers.set("Set-Cookie", caretakerCookieHeader(identity.setCookie));
  return response;
}
