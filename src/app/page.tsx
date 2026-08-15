import GameView from "@/app/components/GameView";

export default function Home() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 p-4">
      <h1 className="text-2xl font-bold tracking-wide">Makotogotchi</h1>
      <GameView />
    </main>
  );
}
