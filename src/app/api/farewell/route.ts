// Farewells for the generation in mourning (SPEC §2.10). GET returns the
// lines left so far; POST leaves or replaces the caller's own. Outside
// mourning there is nothing to say goodbye to, and the route says so.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/server/db/client";
import { runtime } from "@/server/runtime";
import { FAREWELL_MAX, leaveFarewell, listFarewells } from "@/server/farewells";
import { caretakerCookieHeader, rateLimit, resolveCaretaker } from "@/server/http";

export const dynamic = "force-dynamic";

// Bounded before validation so an oversized body is refused cheaply; the
// real alphabet check is cleanFarewell's.
const bodySchema = z.object({ text: z.string().min(1).max(FAREWELL_MAX * 4) });

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
  if (state.diedAtTick === null) return withCookie(NextResponse.json({ farewells: [] }));
  return withCookie(NextResponse.json({ farewells: await listFarewells(await db(), current.id) }));
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const identity = resolveCaretaker(request);
  const withCookie = (response: NextResponse): NextResponse => {
    if (identity.setCookie) response.headers.set("Set-Cookie", caretakerCookieHeader(identity.setCookie));
    return response;
  };
  const limited = await rateLimit(request, { kind: "write", caretakerId: identity.caretakerId });
  if (limited) return withCookie(limited);

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return withCookie(NextResponse.json({ error: "invalid_body" }, { status: 400 }));

  const { engine, generation } = await runtime();
  const current = await generation();
  const state = await engine.view(current);
  if (state.diedAtTick === null) return withCookie(NextResponse.json({ error: "not_mourning" }, { status: 409 }));

  const result = await leaveFarewell(await db(), current.id, identity.caretakerId, parsed.data.text);
  if (!result.ok) {
    return withCookie(NextResponse.json({ error: result.reason }, { status: result.reason === "NOT_MOURNING" ? 409 : 400 }));
  }
  return withCookie(NextResponse.json({ farewells: result.farewells }));
}
