// GET /api/stream — the realtime channel (SPEC §7). One EventSource per
// client; one Redis subscription per pod (the hub); heartbeats keep
// intermediaries from reaping idle streams; a 30s snapshot cadence
// reconciles client prediction drift.

import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { runtime } from "@/server/runtime";
import { db } from "@/server/db/client";
import { key, redis } from "@/server/redis/client";
import { subscribeToEvents } from "@/server/stream/hub";
import { dropPresence, listPresence, PresenceBroadcaster, shouldBroadcastPresence, touchPresence } from "@/server/presence";
import { anonymousName, caretakerProfile, nicknameMap } from "@/server/social";
import { snapshotPayload } from "@/server/snapshot";
import { caretakerCookieHeader, clientIp, resolveCaretaker } from "@/server/http";
import type { EngineMessage, PresenceView } from "@/server/engine/messages";

export const dynamic = "force-dynamic";

const PING_INTERVAL_MS = 15_000;
const SNAPSHOT_INTERVAL_MS = 30_000;
const MAX_STREAMS_PER_IP = 5;

// Per-process connection accounting (SPEC §8.3). One replica in production
// makes this globally correct; more replicas would only loosen the cap.
const GLOBAL_KEY = Symbol.for("makotogotchi.streamcounts");
type GlobalWithCounts = typeof globalThis & { [GLOBAL_KEY]?: Map<string, number> };
const streamCounts = (): Map<string, number> => {
  const holder = globalThis as GlobalWithCounts;
  holder[GLOBAL_KEY] ??= new Map();
  return holder[GLOBAL_KEY];
};

const presenceView = async (): Promise<PresenceView> => {
  const ids = await listPresence(redis(), key("presence"));
  const names = await nicknameMap(await db(), ids);
  return { count: ids.length, caretakers: ids.map((id) => ({ id, name: names.get(id) ?? anonymousName(id) })) };
};

const publishPresence = async (): Promise<void> => {
  const message: EngineMessage = { type: "presence", ...(await presenceView()) };
  await redis().publish(key("events"), JSON.stringify(message));
};

// One throttle per pod, shared by every stream it serves: the payload is read
// fresh at publish time, so coalescing a join wave into one message loses
// nothing (SPEC §7.4).
let broadcaster: PresenceBroadcaster | null = null;
const broadcastPresence = async (): Promise<void> => {
  broadcaster ??= new PresenceBroadcaster(
    () => shouldBroadcastPresence(redis(), key("presence-guard")),
    publishPresence,
  );
  await broadcaster.request();
};

export async function GET(request: NextRequest): Promise<Response> {
  const identity = resolveCaretaker(request);
  const ip = clientIp(request);
  const counts = streamCounts();

  if ((counts.get(ip) ?? 0) >= MAX_STREAMS_PER_IP) {
    return new Response("too many streams", { status: 429 });
  }
  counts.set(ip, (counts.get(ip) ?? 0) + 1);

  // This stream's own identity in the presence set — a caretaker can hold
  // several at once, and each must come and go on its own.
  const connectionId = randomUUID();

  const { engine, generation } = await runtime();
  const current = await generation();
  const profile = await caretakerProfile(await db(), identity.caretakerId);
  const encoder = new TextEncoder();
  let closed = false;
  let unsubscribe: (() => void) | null = null;
  let pingTimer: ReturnType<typeof setInterval> | null = null;
  let snapshotTimer: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown): void => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          closed = true;
        }
      };
      const comment = (text: string): void => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`: ${text}\n\n`));
        } catch {
          closed = true;
        }
      };

      // Register this stream before the hello that reports on it, so the
      // client's opening count includes itself and never depends on winning
      // the broadcast throttle (SPEC §7.4).
      await touchPresence(redis(), key("presence"), identity.caretakerId, connectionId);

      const state = await engine.view(current);
      const payload = await snapshotPayload(state, current);
      send("hello", {
        caretakerId: identity.caretakerId,
        nickname: profile?.nickname ?? null,
        streakDays: profile?.streakDays ?? 0,
        generationsSurvived: profile?.generationsSurvived ?? 0,
        presence: await presenceView(),
        ...payload,
      });
      send("snapshot", payload);

      unsubscribe = await subscribeToEvents((raw) => {
        const message = JSON.parse(raw) as EngineMessage;
        send(message.type, message);
      });

      await broadcastPresence();

      pingTimer = setInterval(() => {
        comment("ping");
        // Touch, then re-attempt a broadcast: a join or leave whose
        // broadcast lost the 2s guard race would otherwise never be
        // reflected anywhere. This bounds presence staleness at one ping.
        void touchPresence(redis(), key("presence"), identity.caretakerId, connectionId).then(() => broadcastPresence());
      }, PING_INTERVAL_MS);

      snapshotTimer = setInterval(() => {
        void (async () => {
          // Re-resolve the generation each cycle: after a death-and-rebirth
          // the same stream starts carrying the successor egg.
          const liveGeneration = await generation();
          const liveState = await engine.view(liveGeneration);
          send("snapshot", await snapshotPayload(liveState, liveGeneration));
        })().catch(() => {
          // A transient store error skips one reconciliation cycle; the
          // next cycle or the live event flow catches the client up.
        });
      }, SNAPSHOT_INTERVAL_MS);
    },
    cancel() {
      closed = true;
      unsubscribe?.();
      if (pingTimer) clearInterval(pingTimer);
      if (snapshotTimer) clearInterval(snapshotTimer);
      const remaining = (streamCounts().get(ip) ?? 1) - 1;
      if (remaining <= 0) streamCounts().delete(ip);
      else streamCounts().set(ip, remaining);
      void dropPresence(redis(), key("presence"), identity.caretakerId, connectionId).then(() => broadcastPresence());
    },
  });

  const headers = new Headers({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  if (identity.setCookie) headers.set("Set-Cookie", caretakerCookieHeader(identity.setCookie));
  return new Response(stream, { headers });
}
