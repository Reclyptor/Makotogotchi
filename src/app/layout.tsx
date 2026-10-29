import type { Metadata, Viewport } from "next";
import { connection } from "next/server";
import { Atkinson_Hyperlegible, Press_Start_2P } from "next/font/google";
import RetroOverlay from "@/app/components/RetroOverlay";
import { halloweenDisplay } from "@/app/holidays/halloween.font";
import { petClock } from "@/sim/clock";
import { holidayOn, type HolidayId } from "@/sim/holidays";
import { HOLIDAY_COPY } from "@/app/copy/holidays";
import { env } from "@/server/env";
import { SLOGAN, SITE_NAME, SITE_URL } from "@/app/site";
import "./globals.css";
import "@/app/holidays/halloween.css";

// The wordmark's retro face — used sparingly; body text stays a system
// stack for legibility (SPEC §11.6).
const pressStart = Press_Start_2P({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-press-start",
  display: "swap",
});

// Body face: designed by the Braille Institute for maximum legibility —
// distinct glyph shapes that read cleanly at small sizes over glass.
const atkinson = Atkinson_Hyperlegible({
  weight: ["400", "700"],
  subsets: ["latin"],
  variable: "--font-atkinson",
  display: "swap",
});

// The card beside a shared link is drawn live by opengraph-image.tsx (SPEC
// §21.7), which the file convention wires in ahead of anything listed here;
// the home page swaps the description for the pet's state the same way.
export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: SITE_NAME,
  description: SLOGAN,
  openGraph: {
    title: SITE_NAME,
    description: SLOGAN,
    url: SITE_URL,
    siteName: SITE_NAME,
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: SITE_NAME,
    description: SLOGAN,
  },
  icons: {
    icon: "/favicon.ico",
    apple: "/icon-180.png",
  },
};

const ORDINARY_THEME_COLOR = "#131017";

/** The holiday on the pet's calendar right now, if any (SPEC §22.11). */
const holidayNow = (): HolidayId | null => holidayOn(petClock(env().PET_TIMEZONE, Date.now()).dayIndex);

export async function generateViewport(): Promise<Viewport> {
  await connection();
  const holidayId = holidayNow();
  return { themeColor: holidayId ? HOLIDAY_COPY[holidayId].themeColor : ORDINARY_THEME_COLOR };
}

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // The holiday is the pet's calendar day (SPEC §22.11), so the page is
  // dressed per request: a layout that read the clock while prerendering
  // would bake the build's day into every static page. The client keeps the
  // attribute in step after that (GameView), across midnight.
  await connection();
  const holidayId = holidayNow();
  return (
    <html
      lang="en"
      className={`${pressStart.variable} ${atkinson.variable} ${halloweenDisplay.variable}`}
      data-holiday={holidayId ?? undefined}
    >
      <body className={`${atkinson.className} min-h-dvh antialiased`}>
        {children}
        <RetroOverlay />
      </body>
    </html>
  );
}
