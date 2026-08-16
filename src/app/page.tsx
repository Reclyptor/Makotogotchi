import GameView from "@/app/components/GameView";

export default function Home() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-xl flex-col items-center justify-start px-3 py-4 sm:justify-center">
      <GameView />
    </main>
  );
}
