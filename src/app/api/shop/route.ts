// The shop (SPEC §13.2). GET: catalog, balance, inventory, room. POST: buy
// an item ({ buy }) or switch the worn cosmetic among owned ones ({ wear }).

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/server/db/client";
import { runtime } from "@/server/runtime";
import { caretakerProfile } from "@/server/social";
import { catalog, purchase, roomState, wearCosmetic } from "@/server/shop";
import { caretakerCookieHeader, resolveCaretaker } from "@/server/http";

export const dynamic = "force-dynamic";

const bodySchema = z.union([
  z.object({ buy: z.string().min(1).max(64) }),
  z.object({ wear: z.string().min(1).max(64).nullable() }),
]);

const STATUS: Record<string, number> = { UNKNOWN_ITEM: 400, INSUFFICIENT_COINS: 402, ALREADY_OWNED: 409 };

export async function GET(request: NextRequest): Promise<NextResponse> {
  const identity = resolveCaretaker(request);
  const database = await db();
  const { engine, generation } = await runtime();
  const current = await generation();
  const [profile, room, state] = await Promise.all([
    caretakerProfile(database, identity.caretakerId),
    roomState(database),
    engine.view(current),
  ]);
  const response = NextResponse.json({
    catalog: catalog(),
    coins: profile?.coins ?? 0,
    inventory: profile?.inventory ?? {},
    room,
    toys: state.toys,
  });
  if (identity.setCookie) response.headers.set("Set-Cookie", caretakerCookieHeader(identity.setCookie));
  return response;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const identity = resolveCaretaker(request);
  const withCookie = (response: NextResponse): NextResponse => {
    if (identity.setCookie) response.headers.set("Set-Cookie", caretakerCookieHeader(identity.setCookie));
    return response;
  };
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return withCookie(NextResponse.json({ error: "invalid_body" }, { status: 400 }));

  const database = await db();
  const { engine, generation } = await runtime();
  const current = await generation();

  if ("wear" in parsed.data) {
    const ok = await wearCosmetic(database, parsed.data.wear);
    return withCookie(
      ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "NOT_OWNED" }, { status: 404 }),
    );
  }

  const state = await engine.view(current);
  const result = await purchase(database, identity.caretakerId, parsed.data.buy, { installedToys: state.toys });
  if (!result.ok) {
    return withCookie(NextResponse.json({ error: result.reason }, { status: STATUS[result.reason] ?? 400 }));
  }
  if (result.kind === "toy") {
    await engine.addToy(current, parsed.data.buy);
  }
  const profile = await caretakerProfile(database, identity.caretakerId);
  return withCookie(NextResponse.json({ ok: true, coins: profile?.coins ?? 0, inventory: profile?.inventory ?? {} }));
}
