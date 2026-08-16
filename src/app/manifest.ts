import type { MetadataRoute } from "next";

// PWA manifest: installable on phones, which pairs naturally with the
// emergency push alerts (SPEC §12).

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Makotogotchi",
    short_name: "Makoto",
    description: "One chinchilla, on the internet, that everybody shares.",
    start_url: "/",
    display: "standalone",
    background_color: "#131017",
    theme_color: "#131017",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
