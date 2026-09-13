// Mint a device link code for the caller (SPEC §8.1). Named caretakers only.

import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/server/db/client";
import { mintLinkCode } from "@/server/link";
import { caretakerCookieHeader, rateLimit, resolveCaretaker } from "@/server/http";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest): Promise<NextResponse> {
  const identity = resolveCaretaker(request);
  const withCookie = (response: NextResponse): NextResponse => {
    if (identity.setCookie) response.headers.set("Set-Cookie", caretakerCookieHeader(identity.setCookie));
    return response;
  };
  const limited = await rateLimit(request, { kind: "write", caretakerId: identity.caretakerId });
  if (limited) return withCookie(limited);

  const result = await mintLinkCode(await db(), identity.caretakerId);
  if (!result.ok) return withCookie(NextResponse.json({ error: "unnamed" }, { status: 403 }));
  return withCookie(NextResponse.json({ code: result.code, expiresInSeconds: result.expiresInSeconds }));
}
