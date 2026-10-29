import './styles.css';
import { detect, type CapabilityReport } from './capability';
import { ARExperience } from './ar';
import { ArenaExperience, type ArenaPhase } from './arena3d';
import { unlockAudio } from './sfx';
import { launchModelViewerAR } from './ios';
import { thumbSvg } from './thumbnails';
import { TREE_SPECS, TREE_TYPES, type TreeType } from './trees';

/* ---------- element lookup ---------- */
const $ = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el as T;
};

const intro = $('intro');
const overlay = $('overlay');
const statusEl = $('status');
const capsEl = $('caps');
const selectorEl = $('selector');
const startBtn = $<HTMLButtonElement>('startBtn');
const startHint = $('startHint');
const iosStage = $('iosStage');
const scan = $('scan');
const hudTree = $('hudTree');
const placedCount = $('placedCount');
const scaleSlider = $<HTMLInputElement>('scaleSlider');
const scaleVal = $('scaleVal');

// arena elements
const arenaSection = $('arena');
const arenaMount = $('arenaMount');
const arenaBtn = $<HTMLButtonElement>('arenaBtn');
const crosshair = $('crosshair');
const arenaHud = $('arenaHud');
const arenaScore = $('arenaScore');
const arenaTrees = $('arenaTrees');
const arenaWave = $('arenaWave');
const arenaHint = $('arenaHint');
const arenaBuild = $('arenaBuild');
const arenaCount = $('arenaCount');
const arenaOver = $('arenaOver');
const arenaFinal = $('arenaFinal');

/* ---------- state ---------- */
let currentTree: TreeType = 'oak';
let scaleMultiplier = 1;
let report: CapabilityReport;
let ar: ARExperience | null = null;
let arena: ArenaExperience | null = null;
let statusTimer: number | undefined;

/* ---------- ui helpers ---------- */
function status(msg: string, kind: 'info' | 'error' = 'info'): void {
  statusEl.textContent = msg;
  statusEl.dataset.kind = kind;
  statusEl.hidden = false;
  window.clearTimeout(statusTimer);
  if (kind === 'info') {
    statusTimer = window.setTimeout(() => {
      statusEl.hidden = true;
    }, 4200);
  }
}

function buildSelector(): void {
  selectorEl.innerHTML = '';
  for (const type of TREE_TYPES) {
    const spec = TREE_SPECS[type];
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'thumb';
    btn.dataset.type = type;
    btn.setAttribute('aria-pressed', String(type === currentTree));
    btn.innerHTML = `<span class="thumb__art">${thumbSvg(type)}</span>
      <span class="thumb__label">${spec.label}</span>
      <span class="thumb__meta">${spec.height.toFixed(1)} m</span>`;
    btn.addEventListener('click', () => selectTree(type));
    selectorEl.appendChild(btn);
  }
}

function selectTree(type: TreeType): void {
  currentTree = type;
  hudTree.textContent = TREE_SPECS[type].label;
  for (const el of selectorEl.querySelectorAll<HTMLElement>('.thumb')) {
    el.setAttribute('aria-pressed', String(el.dataset.type === type));
  }
}

function buildCaps(r: CapabilityReport): void {
  const items: [string, boolean][] = [
    ['Secure (HTTPS)', r.secureContext],
    ['Camera API', r.cameraApi],
    ['WebXR', r.webxr],
    ['Immersive AR', r.immersiveAR],
    ['Quick Look', r.quickLook],
    ['Scene Viewer', r.sceneViewer],
  ];
  capsEl.innerHTML = items
    .map(
      ([label, ok]) =>
        `<span class="cap ${ok ? 'cap--ok' : 'cap--no'}">${ok ? '✓' : '·'} ${label}</span>`
    )
    .join('');
}

/* ---------- pathways ---------- */
async function startWebXR(): Promise<void> {
  ar = new ARExperience({
    onStatus: status,
    onReticle: (visible) => {
      scan.classList.toggle('scan--hit', visible);
    },
    onPlacedCountChange: (n) => {
      placedCount.textContent = `${n} planted`;
    },
    onFirstPlacement: () => {
      scan.hidden = true;
    },
    onSessionEnd: () => {
      overlay.hidden = true;
      intro.hidden = false;
      scan.hidden = false;
      scan.classList.remove('scan--hit');
      placedCount.textContent = '0 planted';
      ar = null;
    },
    getCurrentTree: () => currentTree,
    getScale: () => scaleMultiplier,
  });

  intro.hidden = true;
  overlay.hidden = false;
  scan.hidden = false;

  const ok = await ar.start(overlay);
  if (!ok) {
    overlay.hidden = true;
    intro.hidden = false;
    ar = null;
    return;
  }
  // honestly reflect whether the on-screen controls will actually be visible
  if (!ar.domOverlayActive) {
    overlay.classList.add('overlay--no-dom');
    status('On-screen controls need DOM overlay (unavailable). Tap the floor to plant trees.', 'info');
  } else {
    overlay.classList.remove('overlay--no-dom');
  }
}

async function startModelViewer(mode: 'quicklook' | 'sceneviewer' | 'preview'): Promise<void> {
  const label =
    mode === 'quicklook'
      ? 'Opening AR Quick Look'
      : mode === 'sceneviewer'
        ? 'Opening Scene Viewer'
        : 'AR not supported — showing a 3D preview';
  status(label, mode === 'preview' ? 'error' : 'info');
  try {
    const msg = await launchModelViewerAR(currentTree, iosStage);
    status(msg, 'info');
    iosStage.scrollIntoView({ behavior: 'smooth', block: 'center' });
  } catch (err) {
    status(`Could not load the model: ${(err as Error).message}`, 'error');
  }
}

async function onStart(): Promise<void> {
  switch (report.recommended) {
    case 'webxr':
      await startWebXR();
      break;
    case 'quicklook':
      await startModelViewer('quicklook');
      break;
    case 'sceneviewer':
      await startModelViewer('sceneviewer');
      break;
    default:
      await startModelViewer('preview');
  }
}

/* ---------- arena game (universal 3D, every device) ---------- */
function setArenaPhase(phase: ArenaPhase): void {
  document.body.classList.toggle('arena-play', phase === 'play');
  crosshair.hidden = phase !== 'play';
  arenaHud.hidden = phase !== 'play';
  arenaBuild.hidden = phase !== 'build';
  arenaOver.hidden = phase !== 'over';
}

function startArena(): void {
  // prime audio inside this user gesture so the first laser/chop is audible
  unlockAudio();
  intro.hidden = true;
  overlay.hidden = true;
  arenaSection.hidden = false;
  arenaScore.textContent = '0';
  arenaWave.textContent = '1';

  arena = new ArenaExperience(arenaMount, {
    getCurrentTree: () => currentTree,
    onPhase: setArenaPhase,
    onPlacedCount: (n) => {
      arenaCount.textContent = `${n} planted`;
    },
    onScore: (s) => {
      arenaScore.textContent = String(s);
    },
    onTreesRemaining: (alive, total) => {
      arenaTrees.textContent = `${alive}/${total}`;
    },
    onWave: (w) => {
      arenaWave.textContent = String(w);
    },
    onGameOver: (s) => {
      arenaFinal.textContent = String(s);
    },
    onHint: (msg) => {
      arenaHint.textContent = msg;
    },
  });

  setArenaPhase('build');
  arena.start();
  // turn on the real-world camera + gyro from inside this user gesture
  // (iOS requires the gesture for both permission prompts); degrades gracefully
  void arena.enableSensors();
}

function quitArena(): void {
  arena?.dispose();
  arena = null;
  arenaSection.hidden = true;
  document.body.classList.remove('arena-play');
  intro.hidden = false;
}

/* ---------- wiring ---------- */
function wireControls(): void {
  startBtn.addEventListener('click', () => void onStart());

  $('exitBtn').addEventListener('click', () => void ar?.end());
  $('undoBtn').addEventListener('click', () => ar?.undo());
  $('clearBtn').addEventListener('click', () => ar?.clear());

  scaleSlider.addEventListener('input', () => {
    scaleMultiplier = parseFloat(scaleSlider.value);
    scaleVal.textContent = `${Math.round(scaleMultiplier * 100)}%`;
    ar?.rescaleLast(scaleMultiplier);
  });

  // arena controls
  arenaBtn.addEventListener('click', () => startArena());
  $('arenaUndo').addEventListener('click', () => arena?.undo());
  $('arenaClear').addEventListener('click', () => arena?.clear());
  $('arenaLock').addEventListener('click', () => arena?.lockArena());
  $('arenaExit').addEventListener('click', () => quitArena());
  $('arenaReplay').addEventListener('click', () => arena?.restart());
  $('arenaQuit').addEventListener('click', () => quitArena());
}

function hintForReport(r: CapabilityReport): string {
  switch (r.recommended) {
    case 'webxr':
      return 'Immersive AR ready — plant trees on your real floor.';
    case 'quicklook':
      return 'Opens Apple AR Quick Look. Pick a tree, then place & resize it natively.';
    case 'sceneviewer':
      return 'Opens Android Scene Viewer to place a tree in your room.';
    default:
      return r.secureContext
        ? 'AR is not supported here — you can still preview the trees in 3D.'
        : 'Open this page over HTTPS to enable AR.';
  }
}

/* ---------- boot ---------- */
async function boot(): Promise<void> {
  buildSelector();
  selectTree(currentTree);
  wireControls();

  status('Checking your device…');
  report = await detect();
  buildCaps(report);
  startHint.textContent = hintForReport(report);
  startBtn.textContent =
    report.recommended === 'webxr'
      ? 'Start AR'
      : report.recommended === 'none'
        ? 'Preview in 3D'
        : 'Launch AR';
  statusEl.hidden = true;
}

void boot();
