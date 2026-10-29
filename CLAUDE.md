# CLAUDE.md — AI agent guide for ARBOR

This file is context for an AI coding agent working on ARBOR. Claude Code reads
it automatically; for any other agent, paste it in before you start. It is not
user documentation — that's [`README.md`](./README.md). For reusable task
prompts, see [`PROMPT.md`](./PROMPT.md).

## What ARBOR is

An **install-free, mobile-first web AR playground**. Open one HTTPS URL on a
phone and place procedural low-poly trees (oak/pine/palm) on the real floor. No
backend, no login, no database, no paid APIs. Plus an **Arena Mode** — a
tower-defence game that runs on every phone (because iPhone Safari has no
WebXR), where you plant trees, lock the scene, and defend them from enemies.

Stack: **TypeScript + Vite + Three.js + WebXR + `@google/model-viewer`**.
Deployed to **GitHub Pages** from `main` via `.github/workflows/deploy.yml`.

## Non-negotiable house rules

1. **Never claim a capability the browser can't back.** This is the soul of the
   project. iPhone Safari has **no WebXR immersive-ar** → it uses AR Quick Look
   (prebuilt USDZ). Android Chrome has WebXR. Camera passthrough gives
   **rotational (gyro) tracking only, never positional/SLAM** without WebXR — so
   trees cannot truly world-lock against the user physically walking; say so.
   Capability detection lives in `src/capability.ts` and must stay crash-free in
   a non-XR/Node environment. When a feature can't be supported, **degrade
   gracefully and honestly** — hide the control, don't fake it.

2. **One procedural source of truth for the trees.** `src/trees.ts` generates
   both the in-page Three.js meshes and the exported GLB/USDZ
   (`scripts/build-assets.ts`), so every pathway shows the same tree at the same
   real-world metric height (oak 1.5 m, pine 1.8 m, palm 2.0 m). Don't fork the
   geometry per pathway.

3. **Prebuilt, validated AR assets.** USDZ must be an *uncompressed (stored) zip
   whose first entry is a `.usd`*. We export at build time and `verify-assets`
   validates the structure — never convert at runtime. USDZ output is
   byte-nondeterministic run-to-run (embeds per-run uuids); that churn is
   harmless — `git checkout -- public/models/*.usdz` before committing unless the
   geometry actually changed, and let CI regenerate.

4. **Relative Vite base.** `vite.config.ts` sets `base: './'` so the app works
   from the `/arbor/` Pages subpath. Don't hardcode absolute asset paths.

5. **Strict TypeScript, no dead code.** `tsconfig` runs `noUnusedLocals`. A field
   written but never read is a build error — give it a real read rather than
   deleting honest state, or remove it.

## Completion discipline — gates before "done"

ARBOR uses the **unlazy** method: every outcome has a gate in `GATES.md` that is
a runnable script proving it (`CHECK:` + `EXPECT:` token). A change is done only
when its gate is green.

- `GATES.md` is **gitignored** (local verification ledger, not shipped). Read it
  to see what's proven and how.
- When you add a feature, **add or extend a gate**: a new control → a line in
  `scripts/verify-wiring.ts`; new device behaviour → a headless CDP proof
  (`scripts/verify-*.mjs`) or an honest manual (`M*`) gate.
- Current gates: G1 tsc · G2 build · G3 trees · G4 assets · G5 capability ·
  G6 wiring · G7 README · G8 live · G9 game sim · G10 camera passthrough ·
  G11 arena input. Manual: M1 Android Chrome, M2 iPhone Safari (real hardware).

Run them (see also `CONTRIBUTING.md`):

```bash
npm run typecheck && npm run build
npx tsx scripts/verify-trees.ts
npx tsx scripts/verify-assets.ts
npx tsx scripts/verify-capability.ts
npx tsx scripts/verify-wiring.ts
npx tsx scripts/verify-game.ts
node scripts/verify-camera.mjs     # needs Google Chrome
node scripts/verify-arena.mjs      # needs Google Chrome
```

## File map

```
index.html            dark glass UI: intro, capability badges, tree selector, XR overlay, Arena DOM
src/
  main.ts             orchestrator: detect → pick pathway → wire controls; Arena entry + sensors
  capability.ts       honest capability detection (secure ctx, WebXR, Quick Look, Scene Viewer)
  trees.ts            procedural oak/pine/palm (shared cached geo+materials) + growth easing
  ar.ts               WebXR session: viewer-space hit-test, local-floor, anchors, DOM overlay, pinch
  ios.ts              <model-viewer> → Quick Look (iOS) / Scene Viewer (Android)
  thumbnails.ts       inline SVG tree thumbnails
  styles.css          dark translucent mobile UI, safe-area aware, 52px touch targets
  arena3d.ts          Arena renderer/camera/input: camera passthrough, gyro look, tap-to-plant, pinch, shoot
  game.ts             framework-agnostic ArenaGame engine (injectable RNG, HUD/SFX callbacks)
  sfx.ts              procedural WebAudio (no files; unlock on gesture)
scripts/
  build-assets.ts     exports public/models/{oak,pine,palm}.{glb,usdz} from trees.ts
  verify-*.{ts,mjs}   the acceptance gates above
```

## Headless-test gotchas (learned the hard way)

- Drive the arena/camera gates with Chrome flags
  `--headless=new --enable-unsafe-swiftshader --use-angle=swiftshader
  --use-fake-device-for-media-stream --use-fake-ui-for-media-stream`, serve
  `dist/` via `python3 -m http.server` with a `dist`→`arbor` symlink for correct
  MIME (`vite preview` serves base-path CSS as `text/html` and the browser
  silently drops the stylesheet).
- `elementFromPoint` ignores `pointer-events:none` elements — a tappable control
  inside a pass-through overlay needs an explicit `pointer-events:auto`.
- A `position:absolute; z-index:auto` wrapper does **not** make a stacking
  context, so a child's `z-index` leaks up and can paint over sibling HUD. Give
  HUD overlays an explicit `z-index` above the scene canvas.
- iOS requires camera + `DeviceOrientation` `requestPermission()` to fire
  **synchronously inside the user gesture**.
- model-viewer 3.5 peers `three@~0.163` — keep `three`/`@types/three` pinned
  to `~0.163.0` or `npm install` ERESOLVEs.

## Deploy

Push to `main` → GitHub Actions builds (`npm run build`) and publishes `dist/` to
Pages. After deploy, confirm the live bundle actually carries your change
(`scripts/verify-live.mjs`, or grep the built JS) — a green CI run alone doesn't
prove the live URL propagated.
