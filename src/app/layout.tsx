import type { Metadata, Viewport } from "next";
import "./globals.css";

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
    <html lang="en">
      <body className="min-h-dvh antialiased">{children}</body>
    </html>
  );
}
