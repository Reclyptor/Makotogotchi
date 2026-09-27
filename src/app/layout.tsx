import type { Metadata, Viewport } from "next";
import { Atkinson_Hyperlegible, Press_Start_2P } from "next/font/google";
import RetroOverlay from "@/app/components/RetroOverlay";
import { SLOGAN, SITE_NAME, SITE_URL } from "@/app/site";
import "./globals.css";

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

export const viewport: Viewport = {
  themeColor: "#131017",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${pressStart.variable} ${atkinson.variable}`}>
      <body className={`${atkinson.className} min-h-dvh antialiased`}>
        {children}
        <RetroOverlay />
      </body>
    </html>
  );
}
