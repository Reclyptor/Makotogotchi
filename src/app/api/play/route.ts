// The spectated minigame (SPEC §13.3). One run at a time — the spectacle is
// the point. The client plays locally and reports; the server validates a
// plausibility envelope rather than simulating the game: real elapsed time,
// a hard score rate, and at least one input per point. The result feeds
// PLAY through the ordinary care path with a performance multiplier.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/server/db/client";
import { key, redis } from "@/server/redis/client";
import { runtime } from "@/server/runtime";
import { canPerform } from "@/sim/validate";
import { PERFORMANCE_MAX, PERFORMANCE_MIN } from "@/sim/economy";
import { anonymousName, creditCoins, nicknameMap, recordContribution } from "@/server/social";
import { caretakerCookieHeader, resolveCaretaker } from "@/server/http";
import type { EngineMessage } from "@/server/engine/messages";

export const dynamic = "force-dynamic";

const SESSION_KEY = "minigame";
const SESSION_TTL_MS = 60_000;
// A collision seconds in is a legitimate (short, low-scoring) run — the
// score-per-second cap is what bounds farming, not a minimum duration.
const MIN_DURATION_MS = 1_000;
const MAX_DURATION_MS = 45_000;
const MAX_SCORE_PER_SECOND = 2;

const bodySchema = z.union([
  z.object({ phase: z.literal("start") }),
  z.object({ phase: z.literal("score"), score: z.number().int().min(0).max(200) }),
  z.object({ phase: z.literal("finish"), score: z.number().int().min(0).max(200), inputs: z.number().int().min(0).max(2000) }),
]);

type Session = { caretakerId: string; startedAtMs: number };

const publish = async (message: EngineMessage): Promise<void> => {
  await redis().publish(key("events"), JSON.stringify(message));
};

export async function POST(request: NextRequest): Promise<NextResponse> {
  const identity = resolveCaretaker(request);
  const withCookie = (response: NextResponse): NextResponse => {
    if (identity.setCookie) response.headers.set("Set-Cookie", caretakerCookieHeader(identity.setCookie));
    return response;
  };
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return withCookie(NextResponse.json({ error: "invalid_body" }, { status: 400 }));

  const { engine, generation } = await runtime();
  const current = await generation();
  const sessionKey = key(SESSION_KEY);
  const caretakerName = async (): Promise<string> => {
    const names = await nicknameMap(await db(), [identity.caretakerId]);
    return names.get(identity.caretakerId) ?? anonymousName(identity.caretakerId);
  };

  if (parsed.data.phase === "start") {
    const state = await engine.view(current);
    const verdict = canPerform(state, "PLAY", identity.caretakerId, { schedule: { initialPhase: "WAKE", boundaries: [] } });
    // The schedule shortcut is safe: PLAY's gates are sleep state and
    // energy, both read from state, not from the context.
    if (!verdict.ok) {
      return withCookie(NextResponse.json({ error: "not_now", reason: verdict.reason }, { status: 409 }));
    }
    const session: Session = { caretakerId: identity.caretakerId, startedAtMs: Date.now() };
    const claimed = await redis().set(sessionKey, JSON.stringify(session), "PX", SESSION_TTL_MS, "NX");
    if (claimed !== "OK") {
      return withCookie(NextResponse.json({ error: "busy", reason: "GAME_IN_PROGRESS" }, { status: 409 }));
    }
    await publish({ type: "minigame", phase: "start", caretakerId: identity.caretakerId, caretakerName: await caretakerName() });
    return withCookie(NextResponse.json({ ok: true }));
  }

  // Ends the spectacle for everyone — sent on EVERY finish path, success or
  // not: a rejected result must still take the "is playing" banner down.
  const endSpectacle = async (score?: number, applied?: number): Promise<void> => {
    await publish({
      type: "minigame",
      phase: "finish",
      caretakerId: identity.caretakerId,
      caretakerName: await caretakerName(),
      ...(score !== undefined ? { score } : {}),
      ...(applied !== undefined ? { applied } : {}),
    });
  };

  const raw = await redis().get(sessionKey);
  const session = raw ? (JSON.parse(raw) as Session) : null;
  if (!session || session.caretakerId !== identity.caretakerId) {
    if (parsed.data.phase === "finish") await endSpectacle();
    return withCookie(NextResponse.json({ error: "no_session" }, { status: 409 }));
  }

  if (parsed.data.phase === "score") {
    // At most one broadcast per 2s, and never a decreasing score.
    const guard = await redis().set(key("minigame-score-guard"), "1", "PX", 2000, "NX");
    if (guard === "OK") {
      await publish({ type: "minigame", phase: "score", caretakerId: identity.caretakerId, score: parsed.data.score });
    }
    return withCookie(NextResponse.json({ ok: true }));
  }

  // finish — validate the envelope, then run PLAY with the earned multiplier.
  await redis().del(sessionKey);
  const elapsedMs = Date.now() - session.startedAtMs;
  const { score, inputs } = parsed.data;
  const plausible =
    elapsedMs >= MIN_DURATION_MS &&
    elapsedMs <= MAX_DURATION_MS &&
    score <= Math.ceil((elapsedMs / 1000) * MAX_SCORE_PER_SECOND) &&
    inputs >= score;
  if (!plausible) {
    await endSpectacle();
    return withCookie(NextResponse.json({ error: "implausible" }, { status: 422 }));
  }

  const performance = Math.max(PERFORMANCE_MIN, Math.min(PERFORMANCE_MAX, 50 + score * 4));
  const outcome = await engine.care(current, "PLAY", identity.caretakerId, { performance });
  if (!outcome.ok) {
    await endSpectacle();
    return withCookie(NextResponse.json({ error: "not_now", reason: outcome.rejection.reason }, { status: 409 }));
  }

  const ledger = await recordContribution(await db(), {
    caretakerId: identity.caretakerId,
    generationId: current.id,
    action: "PLAY",
    applied: outcome.applied,
    tick: outcome.state.tick,
  });
  await creditCoins(await db(), identity.caretakerId, score);
  await endSpectacle(score, outcome.applied);
  return withCookie(NextResponse.json({ applied: outcome.applied, coins: ledger.coins + score, score }));
}
