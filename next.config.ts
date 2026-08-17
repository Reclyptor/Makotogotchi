import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  async headers() {
    return [
      {
        // The sheet's URL embeds a content hash (SPEC §10.2), so the bytes
        // behind a given URL can never change — cache it forever.
        source: "/:sheet(sprites\\.[0-9a-f]+\\.png)",
        headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
      },
    ];
  },
};

export default nextConfig;
