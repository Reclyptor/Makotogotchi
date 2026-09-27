import type { Metadata } from "next";
import GameView from "@/app/components/GameView";
import { shareView } from "@/server/share";
import { SLOGAN, SITE_NAME, SITE_URL } from "@/app/site";

// The description under a shared link says how the pet is doing right now
// (SPEC §21.7), so the page is rendered per request. A store that cannot be
// reached falls back to the slogan: the page is a client stream and
// must not 500 over a sentence.
export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const { line } = await shareView().catch(() => ({ line: SLOGAN }));
  return {
    description: line,
    openGraph: { title: SITE_NAME, description: line, url: SITE_URL, siteName: SITE_NAME, type: "website" },
    twitter: { card: "summary_large_image", title: SITE_NAME, description: line },
  };
}

export default function Home() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-xl flex-col items-center justify-start px-3 py-4 sm:justify-center">
      <GameView />
    </main>
  );
}
