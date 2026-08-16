import type { Metadata, Viewport } from "next";
import { Press_Start_2P } from "next/font/google";
import "./globals.css";

// The wordmark's retro face — used sparingly; body text stays a system
// stack for legibility (SPEC §11.6).
const pressStart = Press_Start_2P({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-press-start",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL("https://makotogotchi.com"),
  title: "Makotogotchi",
  description: "One chinchilla, on the internet, that everybody shares. Keep Makoto alive.",
  openGraph: {
    title: "Makotogotchi",
    description: "One chinchilla, on the internet, that everybody shares. Keep Makoto alive.",
    url: "https://makotogotchi.com",
    siteName: "Makotogotchi",
    images: [{ url: "/og.png", width: 1200, height: 630, alt: "Makoto the chinchilla" }],
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Makotogotchi",
    description: "One chinchilla, on the internet, that everybody shares.",
    images: ["/og.png"],
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
    <html lang="en" className={pressStart.variable}>
      <body className="min-h-dvh antialiased">{children}</body>
    </html>
  );
}
