/**
 * G10 — camera-passthrough AR wires a LIVE camera feed behind the game.
 *
 * Serves the built dist over a correct-MIME static server, drives headless
 * Chrome with a FAKE media device (so getUserMedia resolves with real frames),
 * enters Arena Mode, and asserts that #arenaMount contains a <video> that is
 * actually playing (videoWidth>0, not paused, backed by a MediaStream) and sits
 * before the WebGL canvas in the DOM. Prints CAMERA_OK on success.
 *
 * No real device/camera required; the fake device stands in for the rear camera.
 */
import { spawn } from 'node:child_process';
import { mkdirSync, rmSync, symlinkSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const dist = resolve(here, '../dist');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const HTTP_PORT = 4319;
const CDP_PORT = 9224;
const serveDir = '/tmp/arbor_cam_serve';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function fail(msg) {
  console.error('CAMERA_FAIL:', msg);
  cleanup();
  process.exit(1);
}

let chrome, http;
function cleanup() {
  try { chrome?.kill(); } catch {}
  try { http?.kill(); } catch {}
  try { rmSync(serveDir, { recursive: true, force: true }); } catch {}
}

// 1) static server with correct MIME at the /arbor/ base
rmSync(serveDir, { recursive: true, force: true });
mkdirSync(serveDir, { recursive: true });
symlinkSync(dist, resolve(serveDir, 'arbor'));
http = spawn('python3', ['-m', 'http.server', String(HTTP_PORT)], { cwd: serveDir, stdio: 'ignore' });
await sleep(1200);

// 2) headless Chrome with a fake camera
chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${CDP_PORT}`,
  '--enable-unsafe-swiftshader', '--use-angle=swiftshader',
  '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream',
  '--window-size=430,900', '--user-data-dir=/tmp/arbor_cam_profile',
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
const evalExpr = async (expr) => (await cmd('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result?.value;

await cmd('Runtime.enable');
await cmd('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });
await cmd('Emulation.setUserAgentOverride', { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' });
await sleep(3000); // boot + capability detect

await evalExpr(`document.getElementById('arenaBtn').click()`);
// camera getUserMedia + play() resolve a touch later — poll for a live feed
let state = null;
for (let i = 0; i < 20; i++) {
  await sleep(400);
  state = await evalExpr(`(() => {
    const mount = document.getElementById('arenaMount');
    const video = mount.querySelector('video');
    const canvas = mount.querySelector('canvas');
    const kids = [...mount.children].map((c) => c.tagName.toLowerCase());
    return {
      hasVideo: !!video,
      hasStream: !!(video && video.srcObject),
      videoW: video ? video.videoWidth : 0,
      paused: video ? video.paused : true,
      hasCanvas: !!canvas,
      videoBeforeCanvas: kids.indexOf('video') !== -1 && (kids.indexOf('canvas') === -1 || kids.indexOf('video') < kids.indexOf('canvas')),
    };
  })()`);
  if (state && state.hasVideo && state.hasStream && state.videoW > 0 && !state.paused) break;
}

console.log('STATE:', JSON.stringify(state));
ws.close();

if (!state) fail('no state read');
if (!state.hasVideo) fail('no <video> element created in #arenaMount');
if (!state.hasStream) fail('<video> has no MediaStream (getUserMedia did not attach)');
if (!(state.videoW > 0)) fail('<video> is not producing frames (videoWidth=0)');
if (state.paused) fail('<video> is paused (feed not playing)');
if (!state.hasCanvas) fail('no WebGL canvas present');
if (!state.videoBeforeCanvas) fail('camera feed is not behind the canvas');

console.log('CAMERA_OK');
cleanup();
await sleep(200);
process.exit(0);
