/**
 * G4 — the prebuilt AR assets exist and are real: each GLB carries the glTF
 * binary magic, and each USDZ is an uncompressed zip that actually contains a
 * USD entry (Quick Look rejects anything else). No runtime conversion involved.
 */
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { TREE_TYPES } from '../src/trees.ts';

const here = dirname(fileURLToPath(import.meta.url));
const dir = resolve(here, '../public/models');
const problems: string[] = [];

function checkGlb(path: string): void {
  if (!existsSync(path)) return void problems.push(`missing ${path}`);
  const buf = readFileSync(path);
  if (buf.length < 500) problems.push(`${path}: ${buf.length}B — implausibly small`);
  // glTF binary header: magic 0x46546C67 ("glTF"), version 2
  if (buf.readUInt32LE(0) !== 0x46546c67) problems.push(`${path}: bad glB magic`);
  if (buf.readUInt32LE(4) !== 2) problems.push(`${path}: glB version != 2`);
  const declared = buf.readUInt32LE(8);
  if (declared !== buf.length) problems.push(`${path}: length field ${declared} != file ${buf.length}`);
}

function checkUsdz(path: string): void {
  if (!existsSync(path)) return void problems.push(`missing ${path}`);
  const buf = readFileSync(path);
  if (buf.length < 500) problems.push(`${path}: ${buf.length}B — implausibly small`);
  // zip local-file-header signature "PK\x03\x04"
  if (!(buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04)) {
    problems.push(`${path}: not a zip (USDZ must be an uncompressed zip)`);
  }
  // Quick Look requires STORED (method 0), not DEFLATE — method is 2 bytes @ offset 8
  const method = buf.readUInt16LE(8);
  if (method !== 0) problems.push(`${path}: zip compression method ${method} — USDZ must be stored (0)`);
  // first entry must be a USD file
  const nameLen = buf.readUInt16LE(26);
  const name = buf.subarray(30, 30 + nameLen).toString('latin1');
  if (!/\.usd[ac]?$/i.test(name)) problems.push(`${path}: first entry "${name}" is not a .usd/.usda/.usdc`);
  console.log(`  ${path.split('/').pop()}: ${(buf.length / 1024).toFixed(1)}KB, entry "${name}"`);
}

for (const type of TREE_TYPES) {
  checkGlb(resolve(dir, `${type}.glb`));
  checkUsdz(resolve(dir, `${type}.usdz`));
}

if (problems.length) {
  console.error('ASSETS_FAIL');
  for (const p of problems) console.error('  ✗', p);
  process.exit(1);
}
console.log('ASSETS_OK');
