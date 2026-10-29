# Contributing to ARBOR

ARBOR is an open playground. **Fork it, remix it, make it yours** — plant
different trees, add weather, swap the game, redesign the UI, whatever you like.
The MIT license (see [`LICENSE`](./LICENSE)) lets you do all of that freely.

This guide is for people who want their change to land back in this repo. If you
just want your own version, skip straight to *Fork and run*.

## Fork and run

```bash
git clone https://github.com/<you>/arbor.git
cd arbor
npm install
npm run build:assets   # generate public/models/*.glb + *.usdz from src/trees.ts
npm run dev            # vite dev server; add --host to open it on your phone
```

AR needs **HTTPS or `localhost`**. To test on a real phone against the dev
server, tunnel it (`cloudflared tunnel --url http://localhost:5173`) or just push
to your fork and use its GitHub Pages URL.

## Working with an AI agent (Claude or any other)

This project was built with an AI coding agent and is set up to keep being
extended that way:

- **[`CLAUDE.md`](./CLAUDE.md)** — drop-in context for an AI agent: the house
  rules, the file map, and how to add a feature without breaking anything.
  Claude Code reads it automatically; for any other tool, paste it in first.
- **[`PROMPT.md`](./PROMPT.md)** — the original prompt that created ARBOR, plus
  copy-paste prompts for common extensions. Point your AI at the repo, paste the
  relevant prompt, and go.

You don't have to use AI — the code is plain TypeScript and the rules in
`CLAUDE.md` are just good engineering practice. But if you do, those two files
are the fast path.

## The one rule that matters: be honest about the device

ARBOR's whole premise is that it **never claims a capability the browser can't
back**. iPhone Safari has no WebXR; Android Chrome does. Camera passthrough gives
rotational (gyro) tracking only — not positional/SLAM. If your change touches
device behaviour, say exactly what works where, and make the UI degrade
gracefully instead of pretending. A feature that lies about what it does will be
sent back no matter how cool the demo looks.

## Verify before you open a PR

ARBOR ships with acceptance gates in `GATES.md` — each is a script that proves an
outcome, so a change either keeps the gates green or it isn't done. Run them:

```bash
npm run typecheck                      # G1  tsc --noEmit, strict
npm run build                          # G2  assets + production bundle → dist/
npx tsx scripts/verify-trees.ts        # G3  tree geometry + metric height
npx tsx scripts/verify-assets.ts       # G4  GLB magic + USDZ zip/stored/USD-entry
npx tsx scripts/verify-capability.ts   # G5  detection is crash-free & honest
npx tsx scripts/verify-wiring.ts       # G6  controls wired to real handlers, no stubs
npx tsx scripts/verify-game.ts         # G9  Arena game sim (chop counts, scoring)
node  scripts/verify-camera.mjs        # G10 camera passthrough wired behind canvas
node  scripts/verify-arena.mjs         # G11 Arena input: buttons hit-testable, tap-to-plant
```

G10 and G11 need Google Chrome installed (they drive a headless instance). The
on-device gates **M1** (Android Chrome) and **M2** (iPhone Safari) can only be
checked on real hardware — if you can run them, say so in the PR; if you can't,
say that honestly too.

If you add a feature, **add a gate for it.** A new control needs an entry in
`verify-wiring.ts`; new device behaviour needs a headless proof or an honest
manual gate. Don't mark something done that a gate doesn't cover.

## Pull requests

1. Branch off `main` (`git checkout -b feat/my-thing`).
2. Keep the change focused; match the surrounding code style (strict TS, no
   `any`, no dead code — `tsconfig` runs `noUnusedLocals`).
3. Run the gates above; paste the results into the PR description.
4. Describe what works on which device, and what you couldn't test.

`main` auto-deploys to GitHub Pages via `.github/workflows/deploy.yml`, so once a
PR merges it's live.

## Ideas worth stealing

New tree species, seasons/weather, a shareable "grove" permalink, multiplayer,
sound design, a proper WebXR path for Vision Pro, better game waves — all fair
game. Open an issue to float an idea, or just build it in your fork and show us.

By contributing you agree your contribution is licensed under the repo's MIT
license.
