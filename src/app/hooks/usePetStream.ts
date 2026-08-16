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
import type { PetState, PhaseSchedule, ProjectionContext } from "@/sim/model";
import type { CareAction } from "@/sim/tuning";
import type { SnapshotPayload } from "@/server/snapshot";
import type { RoomView } from "@/server/shop";
import type {
  CareMessage,
  MilestoneMessage,
  MinigameMessage,
  PresenceMessage,
  ReactMessage,
  SnapshotMessage,
} from "@/server/engine/messages";

type Authoritative = {
  state: PetState;
  schedule: PhaseSchedule;
  genesisEpochMs: number;
  tickMs: number;
  /** localNowMs − serverNowMs, estimated from snapshots. */
  clockOffsetMs: number;
};

export type CareNotice = { action: CareAction; caretakerId: string; caretakerName?: string; applied: number };
export type MilestoneNotice = { kind: string; detail?: string };
export type MinigameNotice = Omit<MinigameMessage, "type">;
export type ReactNotice = Omit<ReactMessage, "type">;
export type CaretakerProfile = { nickname: string | null; streakDays: number; generationsSurvived: number };

export type PetStream = {
  connected: boolean;
  caretakerId: string | null;
  /** From hello — the caller's own social profile. */
  profile: CaretakerProfile | null;
  presenceCount: number;
  presenceNames: string[];
  /** Communal room decoration (SPEC §13.2), from the latest snapshot. */
  room: RoomView | null;
  /** Authoritative state projected to the corrected current tick. */
  projectNow: () => PetState | null;
  /** The projection context (phase schedule) for validate/derive callers. */
  context: () => ProjectionContext | null;
  onCare: (listener: (notice: CareNotice) => void) => () => void;
  onMilestone: (listener: (notice: MilestoneNotice) => void) => () => void;
  onMinigame: (listener: (notice: MinigameNotice) => void) => () => void;
  onReact: (listener: (notice: ReactNotice) => void) => () => void;
};

export const usePetStream = (): PetStream => {
  const authRef = useRef<Authoritative | null>(null);
  const careListeners = useRef(new Set<(notice: CareNotice) => void>());
  const milestoneListeners = useRef(new Set<(notice: MilestoneNotice) => void>());
  const minigameListeners = useRef(new Set<(notice: MinigameNotice) => void>());
  const reactListeners = useRef(new Set<(notice: ReactNotice) => void>());
  const [room, setRoom] = useState<RoomView | null>(null);
  const [connected, setConnected] = useState(false);
  const [caretakerId, setCaretakerId] = useState<string | null>(null);
  const [profile, setProfile] = useState<CaretakerProfile | null>(null);
  const [presenceCount, setPresenceCount] = useState(0);
  const [presenceNames, setPresenceNames] = useState<string[]>([]);

  useEffect(() => {
    const source = new EventSource("/api/stream");

    const acceptSnapshot = (payload: SnapshotPayload): void => {
      const current = authRef.current;
      const sameGeneration = current?.state.generation.id === payload.state.generation.id;
      // Stale deliveries are discarded (SPEC §7.4) — but a different
      // generation is a new life, not an out-of-order message: its ticks
      // restart from zero and must always be accepted.
      if (current && sameGeneration && payload.state.tick < current.state.tick) return;
      authRef.current = {
        state: payload.state,
        schedule: payload.phaseSchedule,
        genesisEpochMs: payload.genesisEpochMs,
        tickMs: payload.tickSeconds * 1000,
        clockOffsetMs: Date.now() - (payload.genesisEpochMs + payload.serverTick * payload.tickSeconds * 1000),
      };
      setRoom(payload.room);
    };

    const acceptState = (state: PetState): void => {
      const current = authRef.current;
      if (!current) return;
      // A state from a different generation needs its genesis and schedule
      // too — only a snapshot carries those, so skip and let the next
      // snapshot perform the changeover.
      if (current.state.generation.id !== state.generation.id) return;
      if (state.tick < current.state.tick) return;
      authRef.current = { ...current, state };
    };

    source.addEventListener("open", () => setConnected(true));
    source.addEventListener("error", () => setConnected(false));

    source.addEventListener("hello", (event) => {
      const payload = JSON.parse((event as MessageEvent<string>).data) as SnapshotPayload & {
        caretakerId: string;
        nickname: string | null;
        streakDays: number;
        generationsSurvived: number;
      };
      setCaretakerId(payload.caretakerId);
      setProfile({
        nickname: payload.nickname,
        streakDays: payload.streakDays,
        generationsSurvived: payload.generationsSurvived,
      });
      acceptSnapshot(payload);
    });
    source.addEventListener("snapshot", (event) => {
      acceptSnapshot(JSON.parse((event as MessageEvent<string>).data) as SnapshotMessage & SnapshotPayload);
    });
    source.addEventListener("care", (event) => {
      const message = JSON.parse((event as MessageEvent<string>).data) as CareMessage;
      acceptState(message.state);
      for (const listener of careListeners.current) {
        listener({
          action: message.action,
          caretakerId: message.caretakerId,
          ...(message.caretakerName !== undefined ? { caretakerName: message.caretakerName } : {}),
          applied: message.applied,
        });
      }
    });
    source.addEventListener("milestone", (event) => {
      const message = JSON.parse((event as MessageEvent<string>).data) as MilestoneMessage;
      acceptState(message.state);
      for (const listener of milestoneListeners.current) {
        listener({ kind: message.kind, ...(message.detail !== undefined ? { detail: message.detail } : {}) });
      }
    });
    source.addEventListener("minigame", (event) => {
      const message = JSON.parse((event as MessageEvent<string>).data) as MinigameMessage;
      const { type: _type, ...notice } = message;
      for (const listener of minigameListeners.current) listener(notice);
    });
    source.addEventListener("react", (event) => {
      const message = JSON.parse((event as MessageEvent<string>).data) as ReactMessage;
      const { type: _type, ...notice } = message;
      for (const listener of reactListeners.current) listener(notice);
    });
    source.addEventListener("presence", (event) => {
      const message = JSON.parse((event as MessageEvent<string>).data) as PresenceMessage;
      setPresenceCount(message.count);
      setPresenceNames(message.caretakers.map((caretaker) => caretaker.name));
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

  const context = useCallback((): ProjectionContext | null => {
    const auth = authRef.current;
    return auth ? { schedule: auth.schedule } : null;
  }, []);

  const onCare = useCallback((listener: (notice: CareNotice) => void) => {
    careListeners.current.add(listener);
    return () => careListeners.current.delete(listener);
  }, []);

  const onMilestone = useCallback((listener: (notice: MilestoneNotice) => void) => {
    milestoneListeners.current.add(listener);
    return () => milestoneListeners.current.delete(listener);
  }, []);

  const onMinigame = useCallback((listener: (notice: MinigameNotice) => void) => {
    minigameListeners.current.add(listener);
    return () => minigameListeners.current.delete(listener);
  }, []);

  const onReact = useCallback((listener: (notice: ReactNotice) => void) => {
    reactListeners.current.add(listener);
    return () => reactListeners.current.delete(listener);
  }, []);

  return {
    connected,
    caretakerId,
    profile,
    presenceCount,
    presenceNames,
    room,
    projectNow,
    context,
    onCare,
    onMilestone,
    onMinigame,
    onReact,
  };
};
