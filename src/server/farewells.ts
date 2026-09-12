// Farewells (SPEC §2.10): during mourning, any caretaker may leave one line
// for the generation that has just died. It lives on the sealed memorial
// record, so the memorial page carries it for good, and the whole list is
// announced on the bus whenever one lands so every open screen shows it.
//
// This is the one place free text crosses the wire, and it is treated as
// hostile. The text is normalised and then matched against an ALLOWLIST of
// characters — letters and digits of any script, spaces, and plain
// punctuation. Nothing is stripped or escaped into shape: a line with markup,
// a control or format character (zero-width joiners, bidi overrides), or an
// emoji in it is refused whole. What is stored is exactly what passed, and
// every reader renders it as a text node or canvas text, never as markup.

import type { Db } from "mongodb";
import { generations, type FarewellDoc } from "./db/collections";
import type { EngineMessage } from "./engine/messages";
import { key, redis } from "./redis/client";
import { anonymousName, NICKNAME_BLOCKLIST, nicknameMap } from "./social";

export const FAREWELL_MIN = 2;
export const FAREWELL_MAX = 80;
/** The farewell alphabet. `u` so \p{L} and \p{N} cover every script, not just ASCII. */
export const FAREWELL_PATTERN = /^[\p{L}\p{N} .,!?'’()-]{2,80}$/u;
/** The nickname screen minus the pet's own name — a goodbye is allowed to say it. */
const SCREENED_WORDS = NICKNAME_BLOCKLIST.filter((word) => word !== "makoto");

/** A farewell as the wire and the page carry it. */
export type FarewellView = { caretakerId: string; name: string; text: string; at: number };

export type FarewellRejection = "INVALID" | "BLOCKED" | "NOT_MOURNING";
export type CleanResult = { ok: true; text: string } | { ok: false; reason: "INVALID" | "BLOCKED" };
export type FarewellResult = { ok: true; farewells: FarewellView[] } | { ok: false; reason: FarewellRejection };

/**
 * The text as it will be stored, or why it will not be. Ordinary whitespace
 * — tabs, line breaks, and every space separator including the no-break
 * space — collapses to one space first, so none of it can pose as "not a
 * character". Nothing else is folded: a control or format character (a
 * zero-width joiner, a bidi override, a byte-order mark, which JavaScript's
 * `\s` would quietly swallow) fails the line outright.
 */
export const cleanFarewell = (raw: string): CleanResult => {
  const collapsed = raw.normalize("NFKC").replace(/[\t\n\r\p{Zs}]+/gu, " ");
  // Checked before trim(), which would quietly drop a leading or trailing
  // byte-order mark along with the spaces.
  if (/\p{C}/u.test(collapsed)) return { ok: false, reason: "INVALID" };
  const text = collapsed.trim();
  if (!FAREWELL_PATTERN.test(text)) return { ok: false, reason: "INVALID" };
  const words = text.toLowerCase().split(/[^\p{L}\p{N}]+/u);
  if (words.some((word) => SCREENED_WORDS.includes(word))) return { ok: false, reason: "BLOCKED" };
  return { ok: true, text };
};

const view = (docs: readonly FarewellDoc[] | undefined): FarewellView[] =>
  [...(docs ?? [])]
    .sort((a, b) => a.at.getTime() - b.at.getTime())
    .map((doc) => ({ caretakerId: doc.caretakerId, name: doc.name, text: doc.text, at: doc.at.getTime() }));

export const listFarewells = async (db: Db, generationId: string): Promise<FarewellView[]> => {
  const doc = await generations(db).findOne({ _id: generationId }, { projection: { "memorial.farewells": 1 } });
  return view(doc?.memorial?.farewells);
};

/**
 * Leave, or replace, the caller's farewell for a sealed generation. One per
 * caretaker: the earlier line is pulled before the new one is pushed, and
 * the caretaker's name is frozen in with it the way the ranking's is.
 */
export const leaveFarewell = async (db: Db, generationId: string, caretakerId: string, raw: string): Promise<FarewellResult> => {
  const cleaned = cleanFarewell(raw);
  if (!cleaned.ok) return cleaned;
  const doc = await generations(db).findOne({ _id: generationId }, { projection: { died: 1, memorial: 1 } });
  if (!doc || doc.died === null || doc.memorial === null) return { ok: false, reason: "NOT_MOURNING" };
  const names = await nicknameMap(db, [caretakerId]);
  const entry: FarewellDoc = { caretakerId, name: names.get(caretakerId) ?? anonymousName(caretakerId), text: cleaned.text, at: new Date() };
  await generations(db).updateOne({ _id: generationId }, { $pull: { "memorial.farewells": { caretakerId } } });
  await generations(db).updateOne({ _id: generationId }, { $push: { "memorial.farewells": entry } });
  const farewells = await listFarewells(db, generationId);
  const message: EngineMessage = { type: "farewell", generationId, farewells };
  try {
    await redis().publish(key("events"), JSON.stringify(message));
  } catch {
    // The farewell is on the record; only its echo was lost, and the next
    // reader fetches the list anyway.
  }
  return { ok: true, farewells };
};
