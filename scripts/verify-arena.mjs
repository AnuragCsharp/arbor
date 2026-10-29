/**
 * G11 — Arena build controls sit ABOVE the scene canvas and the input model is
 * correct. Drives headless Chrome (swiftshader WebGL), enters Arena Mode, then
 * proves the real-device bug fixes end-to-end via CDP:
 *
 *   • the Lock button is the TOP element at its own screen point (not the
 *     canvas) — i.e. taps reach the controls instead of falling through and
 *     planting a tree (the z-index regression);
 *   • tapping two different ground points plants TWO trees at DISTINCT world
 *     positions (no more stacking at screen-centre);
 *   • the in-arena tree picker offers ≥2 trees and switching changes the
 *     active selection;
 *   • clicking Lock transitions to the play phase (body.arena-play).
 *
 * Prints ARENA_OK on success. No real device required.
 */
import { spawn } from 'node:child_process';
import { mkdirSync, rmSync, symlinkSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const dist = resolve(here, '../dist');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const HTTP_PORT = 4321;
const CDP_PORT = 9226;
const serveDir = '/tmp/arbor_arena_serve';
const profile = '/tmp/arbor_arena_profile';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let chrome, http;
function cleanup() {
  try { chrome?.kill(); } catch {}
  try { http?.kill(); } catch {}
  try { rmSync(serveDir, { recursive: true, force: true }); } catch {}
  try { rmSync(profile, { recursive: true, force: true }); } catch {}
}
function fail(msg) {
  console.error('ARENA_FAIL:', msg);
  cleanup();
  process.exit(1);
}

// static server with correct MIME at the /arbor/ base
rmSync(serveDir, { recursive: true, force: true });
mkdirSync(serveDir, { recursive: true });
symlinkSync(dist, resolve(serveDir, 'arbor'));
http = spawn('python3', ['-m', 'http.server', String(HTTP_PORT)], { cwd: serveDir, stdio: 'ignore' });
await sleep(1200);

chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${CDP_PORT}`,
  '--enable-unsafe-swiftshader', '--use-angle=swiftshader',
  '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream',
  '--window-size=430,900', `--user-data-dir=${profile}`,
  `http://localhost:${HTTP_PORT}/arbor/`,
], { stdio: 'ignore' });

async function getPageWs() {
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${CDP_PORT}/json`);
      const page = (await r.json()).find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (page) return page.webSocketDebuggerUrl;
    } catch {}
    await sleep(250);
  }
  throw new Error('no page target');
}

let wsUrl;
try { wsUrl = await getPageWs(); } catch (e) { fail(String(e)); }
const ws = new WebSocket(wsUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

let id = 0;
function cmd(method, params = {}) {
  return new Promise((resolve) => {
    const myId = ++id;
    const h = (ev) => { const m = JSON.parse(ev.data); if (m.id === myId) { ws.removeEventListener('message', h); resolve(m.result); } };
    ws.addEventListener('message', h);
    ws.send(JSON.stringify({ id: myId, method, params }));
  });
}
const evalExpr = async (expr) => {
  const r = await cmd('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r?.exceptionDetails) throw new Error('page eval threw: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
  return r.result?.value;
};

await cmd('Runtime.enable');
await cmd('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await cmd('Emulation.setUserAgentOverride', { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' });
await sleep(3000); // boot + capability detect

// enter arena
await evalExpr(`document.getElementById('arenaBtn').click()`);

// wait for the live arena instance + build phase
let ready = false;
for (let i = 0; i < 20; i++) {
  await sleep(300);
  ready = await evalExpr(`!!(window.__arena && window.__arena.debugPhase && window.__arena.debugPhase() === 'build')`);
  if (ready) break;
}
if (!ready) fail('arena did not reach build phase (window.__arena missing)');

// 1) the Lock button must be the TOP element at its own centre (not the canvas)
const hit = await evalExpr(`(() => {
  const b = document.getElementById('arenaLock');
  const r = b.getBoundingClientRect();
  if (r.width <= 0 || r.height <= 0) return { ok:false, why:'lock button has no box' };
  const el = document.elementFromPoint(r.left + r.width/2, r.top + r.height/2);
  const isLock = el === b || (el && b.contains(el));
  const pick = document.querySelector('#arenaTreePick button');
  let pickOk = false;
  if (pick) {
    const pr = pick.getBoundingClientRect();
    const pe = document.elementFromPoint(pr.left + pr.width/2, pr.top + pr.height/2);
    pickOk = pe === pick || (pe && pick.contains(pe));
  }
  return { ok:true, isLock, topTag: el && el.tagName, topId: el && el.id, pickOk };
})()`);
if (!hit.ok) fail(hit.why);
if (!hit.isLock) fail(`Lock button is not hit-testable — top element is <${hit.topTag} id="${hit.topId}"> (canvas covering controls?)`);
if (!hit.pickOk) fail('tree picker button is not hit-testable (covered by canvas)');

// 2) two taps at different points plant two DISTINCT trees (no stacking)
const place = await evalExpr(`(() => {
  const a = window.__arena.debugPlaceAtNdc(-0.3, -0.45);
  const b = window.__arena.debugPlaceAtNdc(0.3, -0.45);
  return { a, b, count: window.__arena.debugPlacedCount() };
})()`);
if (!place.a || !place.b) fail('tap-to-plant returned null for a valid ground point: ' + JSON.stringify(place));
if (place.count !== 2) fail(`expected 2 planted trees, got ${place.count}`);
const sep = Math.hypot(place.a.x - place.b.x, place.a.z - place.b.z);
if (sep < 0.5) fail(`two taps stacked at ~the same spot (separation ${sep.toFixed(2)}m)`);

// 3) tree picker: ≥2 options and switching changes the active selection
const pick = await evalExpr(`(() => {
  const btns = [...document.querySelectorAll('#arenaTreePick button')];
  if (btns.length < 2) return { ok:false, n: btns.length };
  const before = btns.find(b => b.getAttribute('aria-pressed') === 'true');
  const other = btns.find(b => b !== before);
  other.click();
  const nowPressed = other.getAttribute('aria-pressed') === 'true';
  const beforeReleased = !before || before.getAttribute('aria-pressed') === 'false';
  return { ok:true, n: btns.length, switched: nowPressed && beforeReleased, type: other.dataset.type };
})()`);
if (!pick.ok) fail(`tree picker needs ≥2 options, found ${pick.n}`);
if (!pick.switched) fail('switching the tree picker did not update the active selection');

// 4) Lock transitions to play
await evalExpr(`document.getElementById('arenaLock').click()`);
await sleep(300);
const locked = await evalExpr(`(() => ({
  play: document.body.classList.contains('arena-play'),
  phase: window.__arena.debugPhase(),
}))()`);
if (!(locked.play && locked.phase === 'play')) fail('Lock Arena did not start the play phase: ' + JSON.stringify(locked));

console.log('HIT:', JSON.stringify(hit), '| PLACE sep=' + sep.toFixed(2) + 'm count=' + place.count, '| PICK:', JSON.stringify(pick), '| LOCK:', JSON.stringify(locked));
ws.close();
console.log('ARENA_OK');
cleanup();
await sleep(200);
process.exit(0);
