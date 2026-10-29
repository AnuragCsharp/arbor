# 🌳 ARBOR — plant trees in your room, right from the web

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](./LICENSE)
[![Live demo](https://img.shields.io/badge/demo-live-brightgreen.svg)](https://anuragcsharp.github.io/arbor/)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-blueviolet.svg)](./CONTRIBUTING.md)

ARBOR is an **install-free, mobile-first web AR playground**. Open one HTTPS URL
on your phone and place procedural low-poly trees — oak, pine, palm — on your
real floor. No app store, no login, no backend, no database.

It picks the best AR pathway your device actually supports and **never claims a
capability the browser can't back**:

| Device / browser                   | Pathway                                   | What you get                                  |
| ----------------------------------- | ----------------------------------------- | --------------------------------------------- |
| Android + Chrome (e.g. Galaxy S24)  | **WebXR** `immersive-ar` + hit-test       | In-page AR: scan floor, tap to plant, trees grow, resize/undo/clear |
| Android + Chrome (no WebXR)         | **Scene Viewer** via `<model-viewer>`     | Native Android AR placement from a `.glb`     |
| iPhone / iPad + Safari (iPhone 16 Pro) | **AR Quick Look** via USDZ             | Native ARKit placement, resize & move from a `.usdz` |
| Anything else (secure context)      | **3D preview**                            | Orbit the model; an honest "AR not supported here" |
| Non-HTTPS                           | Blocked with guidance                     | AR requires a secure context                  |

## Architecture

```
index.html ─ premium dark glass UI (intro, capability badges, tree selector, XR overlay)
└─ src/
   ├─ main.ts        orchestrator: detect → pick pathway → wire controls
   ├─ capability.ts  honest capability detection (secure ctx, WebXR, Quick Look, Scene Viewer)
   ├─ trees.ts       procedural oak/pine/palm (shared cached geo+materials) + growth easing
   ├─ ar.ts          WebXR session: viewer-space hit-test, local-floor, optional anchors, DOM overlay
   ├─ ios.ts         <model-viewer> pathway → Quick Look (iOS) / Scene Viewer (Android)
   ├─ thumbnails.ts  inline SVG tree thumbnails
   └─ styles.css     dark translucent mobile UI, safe-area aware, 52px touch targets
scripts/
   ├─ build-assets.ts  exports public/models/{oak,pine,palm}.{glb,usdz} from the SAME trees.ts
   └─ verify-*.ts      acceptance gates (see Testing)
```

The in-page WebXR renderer (Three.js) and the exported GLB/USDZ are generated
from **one** procedural source (`trees.ts`), so every pathway shows the same
tree at the same real-world metric height (oak 1.5 m, pine 1.8 m, palm 2.0 m).

### Why prebuilt USDZ

Quick Look is strict: a USDZ must be an **uncompressed (stored) zip whose first
entry is a USD file**. Rather than converting at runtime, ARBOR exports tested
`.usdz` and `.glb` files at build time with Three.js `USDZExporter` /
`GLTFExporter`, and a gate (`verify-assets`) validates the zip/glB structure
before anything ships.

## 🎮 Arena Mode

Tap **🎮 Arena Mode** on the intro for the tower-defence layer. It's a
**universal non-AR 3D mode** (plain Three.js) on purpose — iPhone Safari has no
WebXR, so the game runs on *every* phone, with WebXR staying the bonus AR path.

1. Plant trees one by one; pinch to resize the last one; switch species from the
   in-arena picker.
2. Hit **Lock Arena** — enemies start spawning from every direction and chop the
   nearest tree (per-species HP: pine 3 / palm 4 / oak 5).
3. The centre crosshair fires a laser on tap; score rises, waves escalate, and
   felling your last tree ends the run. Replay rebuilds it.

On phones that grant it, Arena uses **camera passthrough** (live rear camera
behind a transparent canvas) with **gyro** look, so enemies come at you from
around your real room. That tracking is **rotational only** — walking around
physically will cause parallax drift, because iOS Safari has no positional/SLAM
tracking without WebXR. ARBOR says so rather than pretending otherwise.

## Run locally

```bash
npm install
npm run build:assets   # generate public/models/*.glb + *.usdz
npm run dev            # vite dev server (use --host to reach it from your phone)
```

WebXR and Quick Look need **HTTPS** (or `localhost`). To test on a real phone
against the dev server, use a tunnel (e.g. `cloudflared tunnel --url http://localhost:5173`)
or just use the deployed GitHub Pages URL.

## Deploy (GitHub Pages)

`.github/workflows/deploy.yml` builds and publishes on every push to `main`.
Vite is configured with a **relative base** (`base: './'`) so it works from a
project subpath like `https://<user>.github.io/arbor/`.

## Testing

Gates live in `GATES.md` and run via plain scripts — no device farm required for
the automated set:

```bash
npm run typecheck                 # G1: tsc --noEmit, strict
npm run build                     # G2: assets + production bundle → dist/
npx tsx scripts/verify-trees.ts   # G3: tree geometry + metric height sanity
npx tsx scripts/verify-assets.ts  # G4: GLB magic + USDZ zip/stored/USD-entry
npx tsx scripts/verify-capability.ts # G5: detection is crash-free & honest in Node
npx tsx scripts/verify-wiring.ts  # G6: controls wired to real handlers, no stubs
ARBOR_URL=<live-url> node scripts/verify-live.mjs # G8: deployed site + assets reachable
```

### Mobile QA checklist (must be done on real hardware)

Automated gates can't press "Start AR" on a phone. Before calling a device
supported, do this QA pass on the actual device:

**Android (Galaxy S24, Chrome):**
1. Open the HTTPS URL. Badge row shows WebXR ✓ / Immersive AR ✓.
2. Tap **Start AR**, grant camera. Move the phone — the reticle turns green on the floor.
3. Tap to plant; the tree grows from a sprout over ~1.8 s with a slight overshoot.
4. Size slider rescales the last tree; **Undo** removes it; **Clear** empties the scene.
5. **Exit** returns to the intro.

**iPhone (iPhone 16 Pro, Safari):**
1. Open the URL. Badge row shows Quick Look ✓.
2. Tap **Launch AR** → the AR button appears; tap it → Quick Look opens.
3. Place the tree on the floor; pinch to resize, drag to move (native ARKit).
4. Close Quick Look → back to ARBOR.

## Troubleshoot

| Symptom                                  | Cause / fix                                                             |
| ---------------------------------------- | ----------------------------------------------------------------------- |
| "Open this page over HTTPS"              | Not a secure context. Use the Pages URL or `localhost`/a tunnel.        |
| Android: no **Start AR**, only "Launch AR" | WebXR `immersive-ar` unsupported → it falls back to Scene Viewer. Update Chrome / install Google Play Services for AR. |
| Reticle never turns green                | Hit-test needs texture on the floor and good light; sweep the phone slowly. |
| iOS: AR button missing                   | Quick Look needs Safari on an ARKit device; in-app browsers may block it. |
| On-screen size slider absent in AR       | The device didn't grant WebXR **DOM overlay**; ARBOR hides the controls it can't show and you place by tapping (honest fallback). |
| Model won't load                         | `npm run build:assets` not run, or `public/models/*` not deployed.      |

## Limitations (honest)

- WebXR immersive-ar is Android-Chrome-class only; iOS Safari has no WebXR AR, hence the Quick Look path.
- The on-screen HUD during WebXR depends on the DOM-overlay feature; where it's absent, controls are hidden rather than faked.
- Growth/size apply to the in-page WebXR trees; inside native Quick Look / Scene Viewer, iOS/Android own placement and scaling.
- Physical-device results are only claimed after a real device QA pass (above).

## Contributing

ARBOR is open — **fork it, remix it, make it yours.** Plant new trees, add
seasons, rework the game, redesign everything. See
[`CONTRIBUTING.md`](./CONTRIBUTING.md) for how to run it, the gate checklist, and
the PR flow.

Built with an AI agent and set up to keep being extended that way:

- [`CLAUDE.md`](./CLAUDE.md) — drop-in context for an AI agent (house rules +
  file map). Claude Code reads it automatically; paste it into any other tool.
- [`PROMPT.md`](./PROMPT.md) — the original prompt that created ARBOR plus
  copy-paste prompts for common extensions, so you can point an AI at the repo
  and go.

You don't need AI to contribute — it's plain TypeScript — but those files are the
fast path if you want it.

## License

[MIT](./LICENSE) — do whatever you like with it, no warranty. By contributing you
agree your contribution is MIT-licensed too.
