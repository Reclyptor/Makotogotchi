// Web push subscription management (SPEC §12). GET exposes the VAPID public
// key and whether this caretaker is subscribed; POST stores a subscription;
// DELETE removes one.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/server/db/client";
import { env } from "@/server/env";
import { deleteSubscription, hasSubscription, saveSubscription } from "@/server/push/store";
import { caretakerCookieHeader, rateLimit, resolveCaretaker } from "@/server/http";

export const dynamic = "force-dynamic";

const subscriptionSchema = z.object({
  endpoint: z.url(),
  keys: z.object({ p256dh: z.string().min(1), auth: z.string().min(1) }),
});

const withCookieFor = (identity: { setCookie: string | null }) => (response: NextResponse): NextResponse => {
  if (identity.setCookie) response.headers.set("Set-Cookie", caretakerCookieHeader(identity.setCookie));
  return response;
};

export async function GET(request: NextRequest): Promise<NextResponse> {
  const identity = resolveCaretaker(request);
  const withCookie = withCookieFor(identity);

  const limited = await rateLimit(request, { kind: "read" });
  if (limited) return withCookie(limited);

  const publicKey = env().VAPID_PUBLIC_KEY ?? null;
  const subscribed = publicKey ? await hasSubscription(await db(), identity.caretakerId) : false;
  return withCookie(NextResponse.json({ publicKey, subscribed }));
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const identity = resolveCaretaker(request);
  const withCookie = withCookieFor(identity);

  const limited = await rateLimit(request, { kind: "write", caretakerId: identity.caretakerId });
  if (limited) return withCookie(limited);

  if (!env().VAPID_PUBLIC_KEY) return withCookie(NextResponse.json({ error: "push_disabled" }, { status: 503 }));
  const parsed = subscriptionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return withCookie(NextResponse.json({ error: "invalid_body" }, { status: 400 }));
  await saveSubscription(await db(), identity.caretakerId, parsed.data);
  return withCookie(NextResponse.json({ subscribed: true }));
}

export async function DELETE(request: NextRequest): Promise<NextResponse> {
  // Unsubscribing is keyed by the endpoint alone — the browser hands back
  // whatever push service URL it was given, and there is no caretaker to
  // charge — so this one takes the address bucket only.
  const limited = await rateLimit(request, { kind: "read" });
  if (limited) return limited;

  const parsed = z
    .object({ endpoint: z.url() })
    .safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  await deleteSubscription(await db(), parsed.data.endpoint);
  return NextResponse.json({ subscribed: false });
}
