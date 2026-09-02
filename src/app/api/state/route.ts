// GET /api/state — one-shot current state for first paint and for clients
// without EventSource (SPEC §9).

import { NextResponse, type NextRequest } from "next/server";
import { runtime } from "@/server/runtime";
import { snapshotPayload } from "@/server/snapshot";
import { caretakerCookieHeader, rateLimit, resolveCaretaker } from "@/server/http";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const identity = resolveCaretaker(request);
  const withCookie = (response: NextResponse): NextResponse => {
    if (identity.setCookie) response.headers.set("Set-Cookie", caretakerCookieHeader(identity.setCookie));
    return response;
  };

  const limited = await rateLimit(request, { kind: "read" });
  if (limited) return withCookie(limited);

  const { engine, generation } = await runtime();
  const current = await generation();
  const state = await engine.view(current);
  const response = withCookie(
    NextResponse.json({ caretakerId: identity.caretakerId, ...(await snapshotPayload(state, current)) }),
  );
  response.headers.set("Cache-Control", "no-store");
  return response;
}
