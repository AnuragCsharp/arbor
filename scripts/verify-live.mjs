/**
 * G8 — the deployed site is actually live over HTTPS and serving the app plus
 * its prebuilt AR assets. Reads the URL from $ARBOR_URL or ./.deploy-url.
 *
 *   ARBOR_URL=https://user.github.io/arbor/ node scripts/verify-live.mjs
 */
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const urlFile = resolve(here, '../.deploy-url');
let base = process.env.ARBOR_URL || (existsSync(urlFile) ? readFileSync(urlFile, 'utf8').trim() : '');

if (!base) {
  console.error('LIVE_FAIL: no URL — set ARBOR_URL or write ./.deploy-url');
  process.exit(1);
}
if (!base.startsWith('https://')) {
  console.error(`LIVE_FAIL: ${base} is not HTTPS (WebXR/Quick Look require a secure context)`);
  process.exit(1);
}
if (!base.endsWith('/')) base += '/';

const problems = [];

async function head(path, { binary = false } = {}) {
  const url = base + path;
  const res = await fetch(url).catch((e) => ({ ok: false, status: 0, _err: e.message }));
  if (!res.ok) {
    problems.push(`${url} → ${res.status}${res._err ? ` (${res._err})` : ''}`);
    return null;
  }
  return binary ? Buffer.from(await res.arrayBuffer()) : await res.text();
}

const html = await head('');
if (html && !/ARBOR/i.test(html)) problems.push('index.html served but does not mention ARBOR');
if (html && !/<script[^>]+type="module"/i.test(html)) problems.push('index.html has no module script (build not wired)');

// the three prebuilt models must be reachable with sane content types/magic
for (const type of ['oak', 'pine', 'palm']) {
  const glb = await head(`models/${type}.glb`, { binary: true });
  if (glb && glb.readUInt32LE(0) !== 0x46546c67) problems.push(`${type}.glb served but not valid glB`);
  const usdz = await head(`models/${type}.usdz`, { binary: true });
  if (usdz && !(usdz[0] === 0x50 && usdz[1] === 0x4b)) problems.push(`${type}.usdz served but not a zip`);
}

if (problems.length) {
  console.error('LIVE_FAIL');
  for (const p of problems) console.error('  ✗', p);
  process.exit(1);
}
console.log(`  live: ${base}`);
console.log('LIVE_OK');
