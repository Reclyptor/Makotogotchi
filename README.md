# Makotogotchi

One chinchilla, on the internet, that everybody shares.

There is exactly one pet. It is always alive and always simulating, whether or
not anyone is watching. Anyone who opens the page becomes a caretaker — no
account, no login. Feed it, clean it, play with it, treat it when it's sick,
and watch everyone else do the same in real time. If the community stops
caring for it, it dies — permanently — and joins the memorial wall while a new
egg hatches.

**[SPEC.md](./SPEC.md) is the source of truth** for the game design, the
architecture, and every rule of the simulation. Read it first.

## Stack

Next.js (App Router) · React · TypeScript strict · Tailwind CSS ·
MongoDB (durable truth) · Redis (realtime) · Server-sent events ·
a hand-rolled Canvas2D engine · Vitest · Playwright

## Development

```sh
npm install
npm run dev        # dev server on :3000
npm run verify     # typecheck + lint + tests — the bar for every commit
```

## Deployment

Built into a standalone Docker image by GitHub Actions
(`ghcr.io/reclyptor/makotogotchi`), deployed to a k3s cluster via Flux, and
served through a Cloudflare tunnel at makotogotchi.com and
makotogotchi.reclyptor.com. See SPEC.md §17–§19.
