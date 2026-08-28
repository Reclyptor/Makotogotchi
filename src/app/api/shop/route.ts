// The shop (SPEC §13.2). GET: catalog, balance, inventory, room. POST: buy
// an item ({ buy }), switch the worn cosmetic among owned ones ({ wear }), or
// change the room's style among the ones it owns ({ theme }, SPEC §22.5).

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/server/db/client";
import { runtime } from "@/server/runtime";
import { caretakerProfile } from "@/server/social";
import { catalog, fundingState, purchase, roomState, setActiveTheme, wearCosmetic } from "@/server/shop";
import { caretakerCookieHeader, resolveCaretaker } from "@/server/http";

export const dynamic = "force-dynamic";

const bodySchema = z.union([
  z.object({ buy: z.string().min(1).max(64) }),
  z.object({ wear: z.string().min(1).max(64).nullable() }),
  z.object({ theme: z.string().min(1).max(64) }),
]);

const STATUS: Record<string, number> = { UNKNOWN_ITEM: 400, INSUFFICIENT_COINS: 402, ALREADY_OWNED: 409 };

export async function GET(request: NextRequest): Promise<NextResponse> {
  const identity = resolveCaretaker(request);
  const database = await db();
  const { engine, generation } = await runtime();
  const current = await generation();
  const [profile, room, state, funding] = await Promise.all([
    caretakerProfile(database, identity.caretakerId),
    roomState(database),
    engine.view(current),
    fundingState(database),
  ]);
  const response = NextResponse.json({
    catalog: catalog(),
    coins: profile?.coins ?? 0,
    inventory: profile?.inventory ?? {},
    room,
    toys: state.toys,
    funding,
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

  if ("theme" in parsed.data) {
    // The room is shared, so the redecoration is too: everyone's walls change
    // at the same moment rather than on their next reload. setActiveTheme
    // announces it, as every room mutation does (SPEC §7.2) — the route does
    // not have to remember to.
    const ok = await setActiveTheme(database, parsed.data.theme);
    return withCookie(ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "NOT_OWNED" }, { status: 404 }));
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
