// The delivery boundary (SPEC §7.2). The events channel is one broadcast to
// every connected client, so `deliverableTo` is the only thing standing
// between a caretaker's balance and everybody else's socket. That makes it
// worth a test of its own, separate from anything that needs a server.

import { describe, expect, it } from "vitest";
import { deliverableTo, type EngineMessage } from "./messages";

const purse = (caretakerId: string): EngineMessage => ({
  type: "purse",
  caretakerId,
  coins: 420,
  inventory: { pepper_treat: 2 },
});

describe("deliverableTo", () => {
  it("hands a purse to its owner and to nobody else", () => {
    expect(deliverableTo(purse("ct-a"), "ct-a")).toBe(true);
    expect(deliverableTo(purse("ct-a"), "ct-b")).toBe(false);
    expect(deliverableTo(purse("ct-a"), "")).toBe(false);
  });

  it("hands every other message to everyone — the room is public", () => {
    const room: EngineMessage[] = [
      { type: "react", emoji: "🎉", caretakerId: "ct-a", caretakerName: "A" },
      { type: "presence", count: 2, caretakers: [] },
      { type: "funded", itemId: "window_seat", label: "Window Seat", contributors: [] },
      {
        type: "room",
        room: { decor: [], activeCosmetic: null, cosmetics: [], activeTheme: "cozy", themes: ["cozy"] },
      },
    ];
    for (const message of room) {
      expect(deliverableTo(message, "ct-a")).toBe(true);
      expect(deliverableTo(message, "ct-b")).toBe(true);
    }
  });
});
