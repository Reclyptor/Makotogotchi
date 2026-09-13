// Claim a device link code (SPEC §8.1): this device becomes the caretaker
// the code was minted for. The response carries the linked cookie; the old
// one is simply overwritten and abandoned.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { claimLinkCode, LINK_CODE_LENGTH } from "@/server/link";
import { cookieFor } from "@/server/identity";
import { caretakerCookieHeader, rateLimit, resolveCaretaker } from "@/server/http";

export const dynamic = "force-dynamic";

const bodySchema = z.object({ code: z.string().min(1).max(LINK_CODE_LENGTH * 3) });

export async function POST(request: NextRequest): Promise<NextResponse> {
  const identity = resolveCaretaker(request);
  // Metered on the caller's current identity — a fresh device is a fresh
  // bucket, but the per-address bucket still bounds a guessing run.
  const limited = await rateLimit(request, { kind: "write", caretakerId: identity.caretakerId });
  if (limited) {
    if (identity.setCookie) limited.headers.set("Set-Cookie", caretakerCookieHeader(identity.setCookie));
    return limited;
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_body" }, { status: 400 });

  const linked = await claimLinkCode(parsed.data.code);
  if (linked === null) {
    const response = NextResponse.json({ error: "invalid_code" }, { status: 404 });
    if (identity.setCookie) response.headers.set("Set-Cookie", caretakerCookieHeader(identity.setCookie));
    return response;
  }
  const response = NextResponse.json({ linked: true });
  response.headers.set("Set-Cookie", caretakerCookieHeader(cookieFor(linked)));
  return response;
}
