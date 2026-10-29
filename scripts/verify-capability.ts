/**
 * G5 — capability detection is honest and crash-free in a non-browser context
 * (no window/navigator). It must return a fully-populated report and never claim
 * a capability the environment can't back. In bare Node everything is false and
 * the recommendation is "none".
 */
import { detectSync, detect, type CapabilityReport } from '../src/capability.ts';

const problems: string[] = [];
const keys: (keyof CapabilityReport)[] = [
  'secureContext',
  'cameraApi',
  'webxr',
  'immersiveAR',
  'hitTestIntended',
  'domOverlayLikely',
  'quickLook',
  'sceneViewer',
  'platform',
  'recommended',
];

let sync: CapabilityReport;
try {
  sync = detectSync();
} catch (err) {
  console.error('CAP_FAIL: detectSync threw in Node:', (err as Error).message);
  process.exit(1);
}

for (const k of keys) {
  if (!(k in sync)) problems.push(`missing key "${k}"`);
}

// In bare Node there is no secure browser context — nothing should be claimed.
if (sync.secureContext) problems.push('secureContext true in Node (impossible)');
if (sync.webxr) problems.push('webxr true in Node');
if (sync.immersiveAR) problems.push('immersiveAR true in Node');
if (sync.quickLook) problems.push('quickLook true in Node');
if (sync.recommended !== 'none') problems.push(`recommended "${sync.recommended}" in Node — expected "none"`);

// async detect must also not throw and must agree on the no-AR verdict here.
const asyncReport = await detect().catch((err: Error) => {
  problems.push(`detect() threw: ${err.message}`);
  return null;
});
if (asyncReport && asyncReport.immersiveAR) problems.push('async detect claimed immersiveAR in Node');

console.log(`  sync: platform=${sync.platform}, recommended=${sync.recommended}`);

if (problems.length) {
  console.error('CAP_FAIL');
  for (const p of problems) console.error('  ✗', p);
  process.exit(1);
}
console.log('CAP_OK');
