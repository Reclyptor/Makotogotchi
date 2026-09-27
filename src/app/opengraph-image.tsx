// The link card (SPEC §21.7): what a chat embed shows beside the URL. Drawn
// live from the same view as the page description, so it carries the meters
// and today's goal rather than a still of a chinchilla. Request-time by
// design — a card that was true at build time is a card that lies.
//
// No emoji and no sprite: satori fetches emoji glyphs over the network at
// render time, which a pod should not depend on, and a 16px sprite scaled
// to a card is a blur. Type and bars in the app's own palette say enough.

import { ImageResponse } from "next/og";
import { NEED_KEYS, type NeedKey } from "@/sim/tuning";
import { shareView, type ShareView } from "@/server/share";
import { SITE_NAME, SLOGAN } from "@/app/site";

export const dynamic = "force-dynamic";
export const alt = `${SITE_NAME} — how the pet is doing right now`;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// The palette from globals.css, spelled out because the card is not a page.
const COLORS = {
  background: "#0a0918",
  card: "#171126",
  track: "#251c3a",
  foreground: "#f4f0fb",
  muted: "#ab9fc5",
  accent: "#a78bfa",
  gold: "#fbbf24",
  rose: "#fb7185",
} as const;

const METER_LABELS: Record<NeedKey | "health", string> = {
  hunger: "Hunger",
  energy: "Energy",
  hygiene: "Hygiene",
  joy: "Joy",
  health: "Health",
};

const METER_HUES: Record<NeedKey | "health", string> = {
  hunger: "#fb923c",
  energy: "#facc15",
  hygiene: "#38bdf8",
  joy: "#a78bfa",
  health: "#fb7185",
};

// A store that cannot be reached still gets a card — the name and the
// slogan — rather than a broken image beside the link.
const FALLBACK: ShareView = { name: "Makoto", status: SLOGAN, goal: null, meters: null, line: SLOGAN };

export default async function Image() {
  const view = await shareView().catch(() => FALLBACK);
  const meters = view.meters;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          background: COLORS.background,
          color: COLORS.foreground,
          padding: 56,
          fontFamily: "sans-serif",
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            flex: 1,
            background: COLORS.card,
            borderRadius: 32,
            padding: "34px 48px",
            border: `2px solid ${COLORS.track}`,
          }}
        >
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 22 }}>
              <span style={{ fontSize: 76, fontWeight: 700, letterSpacing: -2 }}>{view.name}</span>
              <span style={{ fontSize: 30, color: COLORS.muted }}>{view.status}</span>
            </div>
            <span style={{ fontSize: 26, color: COLORS.muted }}>{SITE_NAME}</span>
          </div>

          {meters ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 22 }}>
              {[...NEED_KEYS, "health" as const].map((need) => (
                <div key={need} style={{ display: "flex", alignItems: "center", gap: 20, fontSize: 26 }}>
                  <span style={{ width: 150, color: COLORS.muted }}>{METER_LABELS[need]}</span>
                  <div style={{ display: "flex", flex: 1, height: 18, background: COLORS.track, borderRadius: 9 }}>
                    <div style={{ width: `${meters[need]}%`, height: "100%", background: METER_HUES[need], borderRadius: 9 }} />
                  </div>
                  <span style={{ width: 90, textAlign: "right", color: meters[need] < 20 ? COLORS.rose : COLORS.foreground }}>
                    {meters[need]}%
                  </span>
                </div>
              ))}
            </div>
          ) : (
            // An egg or a memorial has no meters; its status is the whole story.
            <div style={{ display: "flex", flex: 1, alignItems: "center", fontSize: 40, color: COLORS.muted }}>{view.status}</div>
          )}

          {view.goal && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 18,
                marginTop: "auto",
                paddingTop: 18,
                borderTop: `2px solid ${COLORS.track}`,
                fontSize: 26,
              }}
            >
              <span style={{ color: COLORS.gold, fontWeight: 700, whiteSpace: "nowrap", flexShrink: 0 }}>Today&apos;s goal</span>
              <span style={{ display: "flex", flex: 1, color: COLORS.foreground }}>{view.goal}</span>
            </div>
          )}
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 22, fontSize: 24, color: COLORS.muted }}>
          <span>{SLOGAN}</span>
          <span style={{ color: COLORS.accent }}>makotogotchi.com</span>
        </div>
      </div>
    ),
    {
      ...size,
      // A chat unfurls each distinct URL once; a minute keeps a shared
      // link's card fresh without redrawing it for every unfurl in a burst.
      headers: { "Cache-Control": "public, max-age=60" },
    },
  );
}
