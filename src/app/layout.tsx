import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Makotogotchi",
  description: "One chinchilla, on the internet, that everybody shares. Keep Makoto alive.",
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
