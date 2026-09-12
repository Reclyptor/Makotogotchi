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
import type { FarewellView } from "@/server/farewells";
import type { Purse } from "@/server/purse";
import type {
  CareMessage,
  MilestoneMessage,
  MinigameMessage,
  PresenceMessage,
  PresenceView,
  PurseMessage,
  ReactMessage,
  RoomMessage,
  FundedMessage,
  RecordMessage,
  SecretMessage,
  SnapshotMessage,
  TitleMessage,
  WantMessage, FarewellMessage, } from "@/server/engine/messages";

type Authoritative = {
  state: PetState;
  schedule: PhaseSchedule;
  genesisEpochMs: number;
  tickMs: number;
  /** localNowMs − serverNowMs, measured on every snapshot. */
  clockOffsetMs: number;
};

export type CareNotice = {
  seq: number;
  action: CareAction;
  caretakerId: string;
  caretakerName?: string;
  /** The item applied with the action, when there was one (SPEC §21.4). */
  itemId?: string;
  applied: number;
};
export type MilestoneNotice = { seq: number; kind: string; detail?: string };
export type WantNotice = {
  seq: number;
  edge: "opened" | "expired";
  windowIndex: number;
  /** Present on "opened"; on "expired" it is the lapsed want, recovered from
   *  the state held just before the message applied (the event itself does
   *  not carry it). */
  want?: { kind: string; itemId?: string };
};
export type MinigameNotice = Omit<MinigameMessage, "type">;
export type TitleNotice = Omit<TitleMessage, "type">;
export type PresenceCaretaker = { id: string; name: string; titles: string[] };
export type RecordNotice = Omit<RecordMessage, "type">;
export type FundedNotice = Omit<FundedMessage, "type">;
export type ReactNotice = Omit<ReactMessage, "type">;
export type SecretNotice = Omit<SecretMessage, "type">;
export type CaretakerProfile = { nickname: string | null; streakDays: number; generationsSurvived: number };

/**
 * Where the pet's clock stands right now, tick and fraction, on the server's
 * timeline rather than the browser's (SPEC §4.5). Everything time-driven in
 * the UI reads from here: the projection floors it, cooldown bars use it
 * whole. Sharing one clock is what keeps a bar from emptying while the button
 * it belongs to is still refusing the click.
 */
const exactTick = (auth: Authoritative): number =>
  Math.max(auth.state.tick, (Date.now() - auth.clockOffsetMs - auth.genesisEpochMs) / auth.tickMs);

export type PetStream = {
  connected: boolean;
  caretakerId: string | null;
  /** From hello — the caller's own social profile. */
  profile: CaretakerProfile | null;
  presenceCount: number;
  /** Who is watching, with their title chips (SPEC §24.4). */
  presenceCaretakers: PresenceCaretaker[];
  /** The generation leader's id — wears the §2.11 crown. */
  crownedId: string | null;
  /** Communal room decoration (SPEC §13.2), from the latest snapshot. */
  room: RoomView | null;
  /** The farewells left for the generation in mourning (SPEC §2.10), whole, as they land. */
  farewells: FarewellView[];
  /**
   * This caretaker's own coins and pack (SPEC §13.1) — the one part of the
   * stream that is theirs alone. Opens with `hello` and is replaced whenever
   * anything moves it, so nothing needs to poll for a balance.
   */
  purse: Purse | null;
  /** The pet's IANA zone, from the latest snapshot — its calendar, not ours. */
  timeZone: string | null;
  /** Authoritative state projected to the corrected current tick. */
  projectNow: () => PetState | null;
  /** The corrected clock in fractional ticks — see exactTick. */
  nowTickExact: () => number | null;
  /** The projection context (phase schedule) for validate/derive callers. */
  context: () => ProjectionContext | null;
  onCare: (listener: (notice: CareNotice) => void) => () => void;
  onMilestone: (listener: (notice: MilestoneNotice) => void) => () => void;
  onWant: (listener: (notice: WantNotice) => void) => () => void;
  onTitle: (listener: (notice: TitleNotice) => void) => () => void;
  onMinigame: (listener: (notice: MinigameNotice) => void) => () => void;
  onRecord: (listener: (notice: RecordNotice) => void) => () => void;
  onFunded: (listener: (notice: FundedNotice) => void) => () => void;
  onReact: (listener: (notice: ReactNotice) => void) => () => void;
  /** Someone entered the ancient code (SPEC §26.2). */
  onSecret: (listener: (notice: SecretNotice) => void) => () => void;
};

export const usePetStream = (): PetStream => {
  const authRef = useRef<Authoritative | null>(null);
  const careListeners = useRef(new Set<(notice: CareNotice) => void>());
  const milestoneListeners = useRef(new Set<(notice: MilestoneNotice) => void>());
  const wantListeners = useRef(new Set<(notice: WantNotice) => void>());
  const titleListeners = useRef(new Set<(notice: TitleNotice) => void>());
  const minigameListeners = useRef(new Set<(notice: MinigameNotice) => void>());
  const recordListeners = useRef(new Set<(notice: RecordNotice) => void>());
  const fundedListeners = useRef(new Set<(notice: FundedNotice) => void>());
  const reactListeners = useRef(new Set<(notice: ReactNotice) => void>());
  const secretListeners = useRef(new Set<(notice: SecretNotice) => void>());
  const [room, setRoom] = useState<RoomView | null>(null);
  const [farewells, setFarewells] = useState<FarewellView[]>([]);
  const [purse, setPurse] = useState<Purse | null>(null);
  const [timeZone, setTimeZone] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [caretakerId, setCaretakerId] = useState<string | null>(null);
  const [profile, setProfile] = useState<CaretakerProfile | null>(null);
  const [presenceCount, setPresenceCount] = useState(0);
  const [presenceCaretakers, setPresenceCaretakers] = useState<PresenceCaretaker[]>([]);
  const [crownedId, setCrownedId] = useState<string | null>(null);

  useEffect(() => {
    const source = new EventSource("/api/stream");

    const acceptPresence = (view: PresenceView): void => {
      setPresenceCount(view.count);
      // Older servers may not send titles yet — a rolling deploy must not
      // crash the list.
      setPresenceCaretakers(view.caretakers.map((caretaker) => ({ ...caretaker, titles: caretaker.titles ?? [] })));
      setCrownedId(view.crownedId ?? null);
    };

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
        clockOffsetMs: Date.now() - payload.serverNowMs,
      };
      setRoom(payload.room);
      setTimeZone(payload.timeZone);
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
        presence: PresenceView;
        purse: Purse;
      };
      setCaretakerId(payload.caretakerId);
      // The opening count comes with the connect. Waiting for a `presence`
      // broadcast instead leaves the badge reading zero whenever the connect's
      // own broadcast loses the throttle (SPEC §7.4).
      acceptPresence(payload.presence);
      setProfile({
        nickname: payload.nickname,
        streakDays: payload.streakDays,
        generationsSurvived: payload.generationsSurvived,
      });
      // Hello re-fires on every reconnect, which is also what corrects a purse
      // that moved while this client was disconnected.
      setPurse(payload.purse);
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
          seq: message.seq,
          action: message.action,
          caretakerId: message.caretakerId,
          ...(message.caretakerName !== undefined ? { caretakerName: message.caretakerName } : {}),
          ...(message.itemId !== undefined ? { itemId: message.itemId } : {}),
          applied: message.applied,
        });
      }
    });
    source.addEventListener("milestone", (event) => {
      const message = JSON.parse((event as MessageEvent<string>).data) as MilestoneMessage;
      acceptState(message.state);
      for (const listener of milestoneListeners.current) {
        listener({ seq: message.seq, kind: message.kind, ...(message.detail !== undefined ? { detail: message.detail } : {}) });
      }
    });
    source.addEventListener("want", (event) => {
      const message = JSON.parse((event as MessageEvent<string>).data) as WantMessage;
      // The expiry event does not carry what lapsed; the state we held a
      // moment ago does. Read it before the new state replaces it.
      const lapsed =
        message.edge === "expired" && authRef.current?.state.wantOpen?.window === message.windowIndex
          ? authRef.current.state.wantOpen
          : null;
      acceptState(message.state);
      const want =
        message.want ?? (lapsed ? { kind: lapsed.kind, ...(lapsed.itemId !== undefined ? { itemId: lapsed.itemId } : {}) } : undefined);
      for (const listener of wantListeners.current) {
        listener({
          seq: message.seq,
          edge: message.edge,
          windowIndex: message.windowIndex,
          ...(want !== undefined ? { want } : {}),
        });
      }
    });
    source.addEventListener("minigame", (event) => {
      const message = JSON.parse((event as MessageEvent<string>).data) as MinigameMessage;
      const { type: _type, ...notice } = message;
      for (const listener of minigameListeners.current) listener(notice);
    });
    source.addEventListener("title", (event) => {
      const message = JSON.parse((event as MessageEvent<string>).data) as TitleMessage;
      const { type: _type, ...notice } = message;
      for (const listener of titleListeners.current) listener(notice);
    });
    source.addEventListener("record", (event) => {
      const message = JSON.parse((event as MessageEvent<string>).data) as RecordMessage;
      const { type: _type, ...notice } = message;
      for (const listener of recordListeners.current) listener(notice);
    });
    // Any change to the communal room — a style, a worn hat, a new
    // decoration. It replaces the room outright rather than patching a field,
    // so this and the snapshot can never hold different rooms.
    source.addEventListener("room", (event) => {
      const message = JSON.parse((event as MessageEvent<string>).data) as RoomMessage;
      setRoom(message.room);
    });
    // The whole list every time, like the room: this and a fetch can never
    // hold different farewells.
    source.addEventListener("farewell", (event) => {
      const message = JSON.parse((event as MessageEvent<string>).data) as FarewellMessage;
      setFarewells(message.farewells);
    });
    // Only this caretaker's purse ever arrives here — the server drops the
    // rest before they reach the socket (SPEC §7.2).
    source.addEventListener("purse", (event) => {
      const message = JSON.parse((event as MessageEvent<string>).data) as PurseMessage;
      setPurse({ coins: message.coins, inventory: message.inventory });
    });
    source.addEventListener("funded", (event) => {
      const message = JSON.parse((event as MessageEvent<string>).data) as FundedMessage;
      const { type: _type, ...notice } = message;
      for (const listener of fundedListeners.current) listener(notice);
    });
    source.addEventListener("react", (event) => {
      const message = JSON.parse((event as MessageEvent<string>).data) as ReactMessage;
      const { type: _type, ...notice } = message;
      for (const listener of reactListeners.current) listener(notice);
    });
    source.addEventListener("secret", (event) => {
      const message = JSON.parse((event as MessageEvent<string>).data) as SecretMessage;
      const { type: _type, ...notice } = message;
      for (const listener of secretListeners.current) listener(notice);
    });
    source.addEventListener("presence", (event) => {
      acceptPresence(JSON.parse((event as MessageEvent<string>).data) as PresenceMessage);
    });

    return () => source.close();
  }, []);

  const projectNow = useCallback((): PetState | null => {
    const auth = authRef.current;
    if (!auth) return null;
    return project(auth.state, Math.floor(exactTick(auth)), { schedule: auth.schedule }).state;
  }, []);

  const nowTickExact = useCallback((): number | null => {
    const auth = authRef.current;
    return auth ? exactTick(auth) : null;
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

  const onWant = useCallback((listener: (notice: WantNotice) => void) => {
    wantListeners.current.add(listener);
    return () => wantListeners.current.delete(listener);
  }, []);

  const onTitle = useCallback((listener: (notice: TitleNotice) => void) => {
    titleListeners.current.add(listener);
    return () => titleListeners.current.delete(listener);
  }, []);

  const onMinigame = useCallback((listener: (notice: MinigameNotice) => void) => {
    minigameListeners.current.add(listener);
    return () => minigameListeners.current.delete(listener);
  }, []);

  const onRecord = useCallback((listener: (notice: RecordNotice) => void) => {
    recordListeners.current.add(listener);
    return () => recordListeners.current.delete(listener);
  }, []);

  const onFunded = useCallback((listener: (notice: FundedNotice) => void) => {
    fundedListeners.current.add(listener);
    return () => fundedListeners.current.delete(listener);
  }, []);

  const onReact = useCallback((listener: (notice: ReactNotice) => void) => {
    reactListeners.current.add(listener);
    return () => reactListeners.current.delete(listener);
  }, []);

  const onSecret = useCallback((listener: (notice: SecretNotice) => void) => {
    secretListeners.current.add(listener);
    return () => secretListeners.current.delete(listener);
  }, []);

  return {
    connected,
    caretakerId,
    profile,
    presenceCount,
    presenceCaretakers,
    crownedId,
    room,
    farewells,
    purse,
    timeZone,
    projectNow,
    nowTickExact,
    context,
    onCare,
    onMilestone,
    onWant,
    onTitle,
    onMinigame,
    onRecord,
    onFunded,
    onReact,
    onSecret,
  };
};
