# PROMPT.md — build & extend ARBOR with an AI agent

ARBOR was built by an AI coding agent from a plain-English brief, and it's meant
to keep growing that way. This file gives you the prompts to do that yourself —
with Claude, or any capable coding agent.

**How to use:** point your agent at a clone of the repo, have it read
[`CLAUDE.md`](./CLAUDE.md) first (that's the house rules + file map), then paste
one of the prompts below. These are written so you can copy, tweak the specifics,
and run. They're representative of how ARBOR was actually built — the exact
wording varied, but the spec and the discipline are real.

---

## 0. Orientation prompt (always run first)

```
Read CLAUDE.md, README.md, and GATES.md in this repo. Summarise, in your own
words: what ARBOR is, the non-negotiable rules (especially "never claim a
capability the browser can't back"), the single-source-of-truth for the trees,
and how the gates in GATES.md prove a change is done. Then wait for my task.
```

---

## 1. The original creation prompt (how ARBOR was born)

This is the brief ARBOR was built from. Use it to understand the intent, or to
regenerate a similar project from scratch.

```
Build a free, install-free, mobile-first web AR playground called ARBOR.

Goal: open ONE https URL on a phone and plant procedural low-poly trees
(oak, pine, palm) on the real floor. No app store, no login, no backend, no
database, no paid APIs.

Hard rule: never claim a capability the browser can't actually back. Detect what
the device supports and pick the best pathway honestly:
  - Android Chrome: WebXR immersive-ar with hit-test — scan the floor, tap to
    plant, trees grow in, resize/undo/clear.
  - iPhone/iPad Safari: AR Quick Look via a prebuilt USDZ (iOS has no WebXR).
  - Android without WebXR: Scene Viewer via <model-viewer> from a .glb.
  - Anything else on a secure context: a 3D preview that orbits, with an honest
    "AR isn't supported here" message.
  - Non-HTTPS: blocked with guidance.

Generate the three trees procedurally from ONE source so the in-page Three.js
mesh and the exported GLB/USDZ are the same tree at the same real-world metric
height (oak 1.5m, pine 1.8m, palm 2.0m). Export tested .glb and .usdz at build
time (USDZ must be an uncompressed/stored zip whose first entry is a .usd).

Stack: TypeScript + Vite (relative base so it works at /arbor/) + Three.js +
@google/model-viewer. Premium dark glass mobile UI, safe-area aware, large touch
targets, capability badges.

Prove it with acceptance gates (unlazy method): a runnable script per outcome —
tsc, build, tree geometry/metric height, GLB+USDZ structure, crash-free honest
capability detection in Node, UI wiring (no stubs), a README, and a live-URL
check. Treat on-device AR as a manual gate you can only claim after a real phone
QA pass. Deploy to GitHub Pages from main.
```

---

## 2. Extension prompts (copy, edit, run)

Every extension prompt ends the same way on purpose: **add a gate and keep them
all green.** That's what keeps ARBOR honest.

### Add a new tree species

```
Add a <species> tree to ARBOR. Build its geometry procedurally in src/trees.ts
from the existing shared builder (keep the root pivot at y=0 and a real metric
height of <N>m). Make sure it flows through EVERY pathway: the in-page WebXR
mesh, the exported GLB and USDZ (scripts/build-assets.ts), the tree selector and
the Arena picker, and an inline SVG thumbnail. Then extend verify-trees.ts and
verify-assets.ts to cover it, run all gates, and keep them green. Don't convert
assets at runtime; export and validate at build time.
```

### Add a new Arena feature (e.g. power-ups, new enemy type)

```
In Arena Mode, add <feature>. The game engine is src/game.ts (framework-agnostic,
injectable RNG, HUD/SFX via callbacks) and the renderer/input driver is
src/arena3d.ts. Keep the engine deterministic under a seeded RNG so the headless
sim still works. Add coverage to scripts/verify-game.ts (deterministic sim) and,
if it adds a control or on-screen behaviour, to verify-wiring.ts /
verify-arena.mjs. Run all gates and keep them green.
```

### Improve device behaviour (camera / gyro / AR)

```
Improve <behaviour> on <device/browser>. First tell me exactly what that device
can and cannot do (e.g. iOS Safari = rotational gyro only, no positional/SLAM;
no WebXR). Implement it so it degrades gracefully where unsupported — hide the
control, never fake it. Fire any iOS permission prompt synchronously inside the
user gesture. Add a headless proof (a verify-*.mjs that drives Chrome) where
possible, or an honest manual gate if it truly needs real hardware. Run all
gates; report honestly what you could and couldn't verify off-device.
```

### Redesign the UI

```
Restyle ARBOR's UI to <direction> while keeping it mobile-first, safe-area aware,
with ≥52px touch targets, and keeping every control wired (verify-wiring.ts must
stay green). Don't change behaviour or the capability honesty — only the look.
Rebuild and eyeball the dist with a headless screenshot before you call it done.
```

---

## 3. The working agreement (what "done" means here)

Whatever the task, a change to ARBOR is done only when:

1. It never claims a capability the browser can't back, and degrades honestly.
2. The trees still come from the one procedural source.
3. Every relevant gate in `GATES.md` is green, and any new outcome has its own
   gate.
4. On-device behaviour is only *claimed* after a real-device pass — otherwise
   it's reported as unverified, honestly.

See [`CONTRIBUTING.md`](./CONTRIBUTING.md) for the PR flow and the full gate list.
Happy planting. 🌳
