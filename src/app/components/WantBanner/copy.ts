// The words for a want, shared by the banner, the feed, and the canvas
// toasts (SPEC §25.7). Kinds arrive as strings off the wire — an unknown one
// (an older build during a rolling deploy) falls to a generic line, never a
// crash, mirroring the reducer's tolerance.

import { foodItem } from "@/sim/economy";
import { isMinigameId, MINIGAMES } from "@/sim/minigames";

const foodLabel = (itemId: string | undefined): string | undefined =>
  itemId !== undefined ? foodItem(itemId)?.label : undefined;

const gameTitle = (itemId: string | undefined): string | undefined =>
  itemId !== undefined && isMinigameId(itemId) ? MINIGAMES[itemId].title : undefined;

/** The banner and feed line for an open want. */
export const wantAsk = (petName: string, kind: string, itemId?: string): string => {
  switch (kind) {
    case "crave-food":
      return `${petName} is craving ${foodLabel(itemId) ?? "a treat"}!`;
    case "play-game":
      return `${petName} wants to play ${gameTitle(itemId) ?? "a game"}!`;
    case "cuddle":
      return `${petName} wants cuddles.`;
    case "dust-bath":
      return `${petName} wants a dust bath.`;
    default:
      return `${petName} wants something.`;
  }
};

/** The short in-room toast when the want opens. */
export const wantToast = (kind: string, itemId?: string): string => {
  switch (kind) {
    case "crave-food":
      return `wants ${foodLabel(itemId) ?? "a treat"}!`;
    case "play-game":
      return `wants to play ${gameTitle(itemId) ?? "a game"}!`;
    case "cuddle":
      return "wants cuddles!";
    case "dust-bath":
      return "wants a dust bath!";
    default:
      return "wants something!";
  }
};

/** The feed line when nobody granted it (SPEC §25.3). */
export const wantLapse = (petName: string, kind?: string, itemId?: string): string => {
  switch (kind) {
    case "crave-food":
      return `${petName} sighs… nobody brought ${foodLabel(itemId) ?? "the treat"}.`;
    case "play-game":
      return `${petName} sighs… nobody played ${gameTitle(itemId) ?? "with it"}.`;
    case "cuddle":
      return `${petName} sighs… nobody came to cuddle.`;
    case "dust-bath":
      return `${petName} sighs… no dust bath today.`;
    default:
      return `${petName} sighs… the wish went ungranted.`;
  }
};

/** The feed line when the wish came true (SPEC §25.3). `detail` is the
 * milestone's `kind` or `kind:itemId` encoding. */
export const wantGranted = (petName: string, detail: string | undefined): string => {
  const [kind, itemId] = (detail ?? "").split(":");
  switch (kind) {
    case "crave-food":
      return `${petName} got the ${foodLabel(itemId) ?? "treat"} it was craving!`;
    case "play-game":
      return `${petName} got to play ${gameTitle(itemId) ?? "its game"}!`;
    case "cuddle":
      return `${petName} got its cuddles!`;
    case "dust-bath":
      return `${petName} got its dust bath!`;
    default:
      return `${petName}'s wish came true!`;
  }
};
