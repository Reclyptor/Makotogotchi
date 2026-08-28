// The feed's copy for a funded grand item is a hand-kept copy of the server
// catalog, because importing that catalog into a client component would drag
// mongodb and ioredis into the browser bundle. A copy is only safe with
// something holding it to the original — without this, the table sat at three
// decor items while five more were added, and funding any of them printed a
// raw id into the feed.

import { describe, expect, it } from "vitest";
import { GRAND_COPY, fundedLine } from "./index";
import { GRAND_ITEMS } from "@/server/shop";

describe("funded item copy", () => {
  it("names every grand item the catalog sells, with the catalog's own label", () => {
    for (const [itemId, item] of Object.entries(GRAND_ITEMS)) {
      expect(GRAND_COPY[itemId], `${itemId} has no feed copy`).toBeDefined();
      expect(GRAND_COPY[itemId]?.label).toBe(item.label);
      expect(GRAND_COPY[itemId]?.group).toBe(item.group);
    }
  });

  it("invents nothing the catalog does not sell", () => {
    for (const itemId of Object.keys(GRAND_COPY)) expect(GRAND_ITEMS).toHaveProperty(itemId);
  });

  it("says what funding actually did, which is different for each kind", () => {
    expect(fundedLine("kotatsu")).toBe("The Kotatsu is funded — it's in the room for good!");
    expect(fundedLine("theme_cabin")).toBe("Log Cabin Walls is funded — the room can wear it now!");
    // A venue is permission to vote, not a thing standing in the room.
    expect(fundedLine("mountain")).toBe("Mount Fuji is open — the room can vote to go there!");
  });
});
