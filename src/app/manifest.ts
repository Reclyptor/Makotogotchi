import type { MetadataRoute } from "next";
import { SLOGAN, SITE_NAME } from "@/app/site";

// PWA manifest: installable on phones, which pairs naturally with the
// emergency push alerts (SPEC §12).

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: SITE_NAME,
    short_name: "Makoto",
    description: SLOGAN,
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
