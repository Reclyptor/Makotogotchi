import Link from "next/link";

export default function AboutPage() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-xl flex-col gap-4 p-4">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-bold">About</h1>
        <Link href="/" className="text-sm text-muted underline underline-offset-2 hover:text-foreground">
          ← back
        </Link>
      </header>

      <div className="flex flex-col gap-3 text-sm leading-relaxed">
        <p>
          <strong>Makotogotchi is one chinchilla, on the internet, that everybody shares.</strong>
        </p>
        <p>
          There is exactly one pet. It is always alive and always simulating, whether or not anyone is watching.
          Everyone who opens this page is a caretaker — no account, no sign-up. Feed it, clean it, play with it,
          treat it when it&apos;s sick, and watch everyone else do the same in real time.
        </p>
        <p>
          If the community stops caring for it, it dies. Permanently. Its grave joins the{" "}
          <Link href="/memorial" className="underline underline-offset-2">
            memorial wall
          </Link>{" "}
          and a new egg appears, waiting for a name.
        </p>
        <h2 className="mt-2 font-semibold">How to keep it alive</h2>
        <ul className="list-inside list-disc space-y-1">
          <li>Hunger drains fastest — a well-fed pet survives about a day untended.</li>
          <li>Health only drops when other needs are critically low, or when it&apos;s sick. At zero, it&apos;s over.</li>
          <li>Each of you can only do so much per week — Makoto genuinely needs more than one caretaker.</li>
          <li>It sleeps at night (US Central time). Let it. It recovers energy that way.</li>
          <li>Sickness untreated is fatal within a day. The medicine button is not decorative.</li>
        </ul>
        <p className="text-muted">
          Pick a display name below the pet so your care is remembered on the{" "}
          <Link href="/leaderboard" className="underline underline-offset-2">
            leaderboard
          </Link>
          .
        </p>

        <h2 id="credits" className="mt-2 scroll-mt-4 font-semibold">
          Credits
        </h2>
        <p>
          The original sprites are the work of <strong>Jingles</strong> — her art is the heart of this project, and
          Makotogotchi wouldn&apos;t exist without her. Thank you, Jingles. 🩷
        </p>
        <p className="text-muted">
          The code is{" "}
          <a
            href="https://github.com/Reclyptor/Makotogotchi/blob/master/LICENSE"
            className="underline underline-offset-2 hover:text-foreground"
          >
            MIT licensed
          </a>
          , and the sprites are{" "}
          <a
            href="https://github.com/Reclyptor/Makotogotchi/blob/master/LICENSE-ART"
            className="underline underline-offset-2 hover:text-foreground"
          >
            CC BY 4.0
          </a>
          . Take either — just credit Jingles for the sprites.
        </p>
      </div>
    </main>
  );
}
