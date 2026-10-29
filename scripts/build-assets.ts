/**
 * Build prebuilt AR assets from the SAME procedural trees the app uses:
 *   public/models/<type>.glb   → <model-viewer> src / Android Scene Viewer
 *   public/models/<type>.usdz  → Apple AR Quick Look
 *
 * Flat normals are baked into each exported mesh so the faceted low-poly look
 * survives in glTF/USDZ (which otherwise interpolate normals smoothly).
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { USDZExporter } from 'three/examples/jsm/exporters/USDZExporter.js';
import { createTree, TREE_TYPES, type TreeType } from '../src/trees.ts';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(here, '../public/models');
mkdirSync(outDir, { recursive: true });

/**
 * three's GLTFExporter reads Blobs through the DOM FileReader API, which Node
 * doesn't provide. Back a minimal one with Node's global Blob so the exporter
 * runs headless. (We export no textures, so only ArrayBuffer/DataURL paths run.)
 */
if (typeof (globalThis as { FileReader?: unknown }).FileReader === 'undefined') {
  class NodeFileReader {
    result: ArrayBuffer | string | null = null;
    onload: ((ev: { target: NodeFileReader }) => void) | null = null;
    onloadend: ((ev: { target: NodeFileReader }) => void) | null = null;
    onerror: ((err: unknown) => void) | null = null;
    private fire(): void {
      this.onload?.({ target: this });
      this.onloadend?.({ target: this });
    }
    readAsArrayBuffer(blob: Blob): void {
      blob.arrayBuffer().then(
        (ab) => {
          this.result = ab;
          this.fire();
        },
        (e) => this.onerror?.(e)
      );
    }
    readAsDataURL(blob: Blob): void {
      blob.arrayBuffer().then(
        (ab) => {
          const b64 = Buffer.from(ab).toString('base64');
          this.result = `data:${blob.type || 'application/octet-stream'};base64,${b64}`;
          this.fire();
        },
        (e) => this.onerror?.(e)
      );
    }
  }
  (globalThis as { FileReader?: unknown }).FileReader = NodeFileReader;
}

function bakeFlat(group: THREE.Group): void {
  group.updateMatrixWorld(true);
  group.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (mesh.isMesh && mesh.geometry) {
      const flat = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
      flat.computeVertexNormals();
      mesh.geometry = flat;
    }
  });
}

function exportGLB(group: THREE.Object3D): Promise<ArrayBuffer> {
  const exporter = new GLTFExporter();
  return new Promise((res, rej) => {
    exporter.parse(
      group,
      (result) => res(result as ArrayBuffer),
      (err) => rej(err),
      { binary: true, onlyVisible: true }
    );
  });
}

async function buildOne(type: TreeType): Promise<void> {
  const group = createTree(type);
  bakeFlat(group);

  const glb = await exportGLB(group);
  writeFileSync(resolve(outDir, `${type}.glb`), Buffer.from(glb));

  const usdz = await new USDZExporter().parse(group);
  writeFileSync(resolve(outDir, `${type}.usdz`), Buffer.from(usdz.buffer, usdz.byteOffset, usdz.byteLength));

  console.log(`  ✓ ${type}: ${(glb.byteLength / 1024).toFixed(1)}KB glb, ${(usdz.byteLength / 1024).toFixed(1)}KB usdz`);
}

async function main(): Promise<void> {
  console.log('building AR assets →', outDir);
  for (const t of TREE_TYPES) {
    await buildOne(t);
  }
  console.log('ASSETS_BUILT');
}

main().catch((err) => {
  console.error('asset build failed:', err);
  process.exit(1);
});
