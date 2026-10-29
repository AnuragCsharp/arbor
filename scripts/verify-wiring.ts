/**
 * G6 — the UI is actually wired to real behaviour, not stubs. Confirms the
 * required handlers/symbols are present across the source and that no
 * placeholder/stub markers survived into shipping code.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const src = resolve(here, '../src');
const read = (f: string) => readFileSync(resolve(src, f), 'utf8');

const main = read('main.ts');
const ar = read('ar.ts');
const ios = read('ios.ts');
const arena = read('arena3d.ts');
const game = read('game.ts');
const sfx = read('sfx.ts');
const problems: string[] = [];

// each control must be looked up AND bound to a handler
const required: [string, string, RegExp][] = [
  ['main.ts', 'startBtn click', /startBtn\.addEventListener\('click'/],
  ['main.ts', 'exitBtn → ar.end', /exitBtn'\)\.addEventListener\('click'.*ar\?\.end/s],
  ['main.ts', 'undoBtn → ar.undo', /undoBtn'\)\.addEventListener\('click'.*ar\?\.undo/s],
  ['main.ts', 'clearBtn → ar.clear', /clearBtn'\)\.addEventListener\('click'.*ar\?\.clear/s],
  ['main.ts', 'scaleSlider input → rescaleLast', /scaleSlider\.addEventListener\('input'.*rescaleLast/s],
  ['ar.ts', 'select → onSelect', /addEventListener\('select', this\.onSelect\)/],
  ['ar.ts', 'hit-test required', /requiredFeatures:\s*\['hit-test'\]/],
  ['ar.ts', 'growth animation', /growthScale\(/],
  ['ar.ts', 'reticle gating on placement', /if \(!this\.reticle\.visible/],
  ['ar.ts', 'pinch-resize → rescaleLast', /onTouchMove[\s\S]*rescaleLast\(target\)/],
  ['ios.ts', 'usdz handed to Quick Look', /ios-src.*\.usdz/s],
  // arena game — entry + build controls + play loop
  ['main.ts', 'arenaBtn → startArena', /arenaBtn\.addEventListener\('click'.*startArena/s],
  ['main.ts', 'arenaLock → lockArena', /arenaLock'\)\.addEventListener\('click'.*lockArena/s],
  ['main.ts', 'arenaExit → quitArena', /arenaExit'\)\.addEventListener\('click'.*quitArena/s],
  ['main.ts', 'arenaReplay → restart', /arenaReplay'\)\.addEventListener\('click'.*restart/s],
  ['arena3d.ts', 'pointer input bound', /addEventListener\('pointerdown', this\.onPointerDown\)/],
  ['arena3d.ts', 'tap in play → shoot', /this\.phase === 'play'[\s\S]*this\.shoot\(\)/],
  ['arena3d.ts', 'play loop drives game.update', /this\.phase === 'play'\) this\.game\.update\(dt\)/],
  ['arena3d.ts', 'pinch resizes last tree', /applyPinch\(\)[\s\S]*pinchBase \* ratio/],
  ['arena3d.ts', 'laser fired on shoot', /shoot\(\)[\s\S]*sfx\.laser\(\)/],
  // real-world camera passthrough + gyro look
  ['arena3d.ts', 'rear-camera passthrough via getUserMedia', /getUserMedia\(\{[\s\S]*facingMode/],
  ['arena3d.ts', 'camera feed inserted behind canvas', /insertBefore\(video, this\.mount\.firstChild\)/],
  ['arena3d.ts', 'camera reveals real world (drop floor + fog)', /this\.groundDisc\.visible = false[\s\S]*this\.scene\.fog = null/],
  ['arena3d.ts', 'gyro orientation permission requested', /DOE\.requestPermission === 'function'[\s\S]*DOE\.requestPermission\(\)/],
  ['arena3d.ts', 'gyro drives the camera view', /this\.orientLive[\s\S]*this\.camera\.quaternion\.copy\(this\.deviceQuat\)/],
  ['main.ts', 'arena enables real-world sensors in gesture', /arena\.enableSensors\(\)/],
  // input + build UX fixes
  ['arena3d.ts', 'tap plants at the tapped point, not screen centre', /groundPointFromNdc\(ndc\.x, ndc\.y\)/],
  ['arena3d.ts', 'gyro reading is low-pass smoothed', /this\.deviceQuat\.slerp\(this\.deviceQuatTarget/],
  ['main.ts', 'in-arena tree picker built + wired to selectTree', /buildArenaPicker[\s\S]*addEventListener\('click', \(\) => selectTree\(type\)\)/],
  ['main.ts', 'tree picker stays in sync with selection', /arenaTreePick\.querySelectorAll[\s\S]*aria-pressed/],
  ['game.ts', 'per-species hit points', /TREE_HP[\s\S]*pine:\s*3[\s\S]*oak:\s*5/],
  ['game.ts', 'enemies get distinct colours from a palette', /ENEMY_COLORS[\s\S]*spawnIndex % ENEMY_COLORS\.length/],
  ['game.ts', 'per-enemy body material is cloned + tinted', /createEnemy\(bodyColor[\s\S]*bodyMat = r\.bodyMat\.clone\(\)[\s\S]*bodyMat\.color\.setHex/],
  ['game.ts', 'enemy chop decrements hp', /strike\(tree[\s\S]*tree\.hp -= 1[\s\S]*sfx\.chop\(\)/],
  ['game.ts', 'ray kills + scores', /shootRay\([\s\S]*this\.kill\(best\)/],
  ['game.ts', 'spawn from random direction', /spawn\(\)[\s\S]*this\.rng\(\) \* Math\.PI \* 2/],
  ['sfx.ts', 'audio unlocked on gesture', /export function unlockAudio/],
  ['sfx.ts', 'laser sound defined', /export function sfxLaser/],
];

const files: Record<string, string> = {
  'main.ts': main,
  'ar.ts': ar,
  'ios.ts': ios,
  'arena3d.ts': arena,
  'game.ts': game,
  'sfx.ts': sfx,
};
for (const [file, label, re] of required) {
  if (!re.test(files[file])) problems.push(`${file}: "${label}" not wired`);
}

// no stub markers in shipping source
const banned = /\b(TODO|FIXME|XXX)\b|not implemented|placeholder\b|coming soon/i;
for (const [file, body] of Object.entries(files)) {
  const line = body.split('\n').findIndex((l) => banned.test(l));
  if (line >= 0) problems.push(`${file}:${line + 1} contains a stub marker: ${body.split('\n')[line].trim()}`);
}

if (problems.length) {
  console.error('WIRING_FAIL');
  for (const p of problems) console.error('  ✗', p);
  process.exit(1);
}
console.log(`  checked ${required.length} wirings across ${Object.keys(files).length} files`);
console.log('WIRING_OK');
