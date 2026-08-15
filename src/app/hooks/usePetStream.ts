"use client";

// The client's connection to the pet (SPEC §7.4): one EventSource, an
// authoritative state that only ever moves forward in ticks (stale
// deliveries are discarded), and local projection between server messages so
// meters and the scene move at frame rate while the server speaks rarely.
//
// Clock skew: the client never trusts its own wall clock absolutely — it
// tracks the offset between local time and the server's tick on every
// snapshot and projects with the corrected clock.

import { useCallback, useEffect, useRef, useState } from "react";
import { project } from "@/sim/project";
import type { PetState, PhaseSchedule } from "@/sim/model";
import type { CareAction } from "@/sim/tuning";
import type { SnapshotPayload } from "@/server/snapshot";
import type { CareMessage, MilestoneMessage, PresenceMessage, SnapshotMessage } from "@/server/engine/messages";

type Authoritative = {
  state: PetState;
  schedule: PhaseSchedule;
  genesisEpochMs: number;
  tickMs: number;
  /** localNowMs − serverNowMs, estimated from snapshots. */
  clockOffsetMs: number;
};

export type CareNotice = { action: CareAction; caretakerId: string; applied: number };
export type MilestoneNotice = { kind: string; detail?: string };

export type PetStream = {
  connected: boolean;
  caretakerId: string | null;
  presenceCount: number;
  /** Authoritative state projected to the corrected current tick. */
  projectNow: () => PetState | null;
  onCare: (listener: (notice: CareNotice) => void) => () => void;
  onMilestone: (listener: (notice: MilestoneNotice) => void) => () => void;
};

export const usePetStream = (): PetStream => {
  const authRef = useRef<Authoritative | null>(null);
  const careListeners = useRef(new Set<(notice: CareNotice) => void>());
  const milestoneListeners = useRef(new Set<(notice: MilestoneNotice) => void>());
  const [connected, setConnected] = useState(false);
  const [caretakerId, setCaretakerId] = useState<string | null>(null);
  const [presenceCount, setPresenceCount] = useState(0);

  useEffect(() => {
    const source = new EventSource("/api/stream");

    const acceptSnapshot = (payload: SnapshotPayload): void => {
      const current = authRef.current;
      if (current && payload.state.tick < current.state.tick) return; // stale (SPEC §7.4)
      authRef.current = {
        state: payload.state,
        schedule: payload.phaseSchedule,
        genesisEpochMs: payload.genesisEpochMs,
        tickMs: payload.tickSeconds * 1000,
        clockOffsetMs: Date.now() - (payload.genesisEpochMs + payload.serverTick * payload.tickSeconds * 1000),
      };
    };

    const acceptState = (state: PetState): void => {
      const current = authRef.current;
      if (!current || state.tick < current.state.tick) return;
      authRef.current = { ...current, state };
    };

    source.addEventListener("open", () => setConnected(true));
    source.addEventListener("error", () => setConnected(false));

    source.addEventListener("hello", (event) => {
      const payload = JSON.parse((event as MessageEvent<string>).data) as SnapshotPayload & { caretakerId: string };
      setCaretakerId(payload.caretakerId);
      acceptSnapshot(payload);
    });
    source.addEventListener("snapshot", (event) => {
      acceptSnapshot(JSON.parse((event as MessageEvent<string>).data) as SnapshotMessage & SnapshotPayload);
    });
    source.addEventListener("care", (event) => {
      const message = JSON.parse((event as MessageEvent<string>).data) as CareMessage;
      acceptState(message.state);
      for (const listener of careListeners.current) {
        listener({ action: message.action, caretakerId: message.caretakerId, applied: message.applied });
      }
    });
    source.addEventListener("milestone", (event) => {
      const message = JSON.parse((event as MessageEvent<string>).data) as MilestoneMessage;
      acceptState(message.state);
      for (const listener of milestoneListeners.current) {
        listener({ kind: message.kind, ...(message.detail !== undefined ? { detail: message.detail } : {}) });
      }
    });
    source.addEventListener("presence", (event) => {
      const message = JSON.parse((event as MessageEvent<string>).data) as PresenceMessage;
      setPresenceCount(message.count);
    });

    return () => source.close();
  }, []);

  const projectNow = useCallback((): PetState | null => {
    const auth = authRef.current;
    if (!auth) return null;
    const correctedNow = Date.now() - auth.clockOffsetMs;
    const tickNow = Math.max(auth.state.tick, Math.floor((correctedNow - auth.genesisEpochMs) / auth.tickMs));
    return project(auth.state, tickNow, { schedule: auth.schedule }).state;
  }, []);

  const onCare = useCallback((listener: (notice: CareNotice) => void) => {
    careListeners.current.add(listener);
    return () => careListeners.current.delete(listener);
  }, []);

  const onMilestone = useCallback((listener: (notice: MilestoneNotice) => void) => {
    milestoneListeners.current.add(listener);
    return () => milestoneListeners.current.delete(listener);
  }, []);

  return { connected, caretakerId, presenceCount, projectNow, onCare, onMilestone };
};
