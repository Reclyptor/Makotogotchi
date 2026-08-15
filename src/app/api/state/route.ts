// GET /api/state — one-shot current state for first paint and for clients
// without EventSource (SPEC §9).

import { NextResponse, type NextRequest } from "next/server";
import { runtime } from "@/server/runtime";
import { snapshotPayload } from "@/server/snapshot";
import { caretakerCookieHeader, resolveCaretaker } from "@/server/http";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const identity = resolveCaretaker(request);
  const { engine, generation } = await runtime();
  const state = await engine.view(generation);
  const response = NextResponse.json({ caretakerId: identity.caretakerId, ...snapshotPayload(state, generation) });
  if (identity.setCookie) response.headers.set("Set-Cookie", caretakerCookieHeader(identity.setCookie));
  response.headers.set("Cache-Control", "no-store");
  return response;
}
