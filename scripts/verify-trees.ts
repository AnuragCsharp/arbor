/**
 * G3 — procedural trees are structurally sane: each builds, has real geometry,
 * sits on the ground (base at y≈0), and matches its declared metric height.
 */
import * as THREE from 'three';
import { createTree, measuredHeight, TREE_SPECS, TREE_TYPES } from '../src/trees.ts';

const problems: string[] = [];

for (const type of TREE_TYPES) {
  const spec = TREE_SPECS[type];
  const group = createTree(type);
  group.updateMatrixWorld(true);

  let meshes = 0;
  let triangles = 0;
  group.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh && m.geometry) {
      meshes++;
      const g = m.geometry;
      const count = g.index ? g.index.count : g.getAttribute('position').count;
      triangles += count / 3;
    }
  });

  if (meshes < 2) problems.push(`${type}: only ${meshes} mesh(es) — expected a multi-part tree`);
  if (triangles < 20) problems.push(`${type}: ${triangles} triangles — too few to be a real model`);
  if (triangles > 5000) problems.push(`${type}: ${triangles} triangles — not low-poly`);

  const box = new THREE.Box3().setFromObject(group);
  if (box.min.y < -0.05) problems.push(`${type}: base sits below ground (minY=${box.min.y.toFixed(3)})`);

  const h = measuredHeight(type);
  const tol = spec.height * 0.3;
  if (Math.abs(h - spec.height) > tol) {
    problems.push(`${type}: measured ${h.toFixed(2)}m vs declared ${spec.height}m (tol ±${tol.toFixed(2)})`);
  }

  console.log(
    `  ${type}: ${meshes} meshes, ${triangles} tris, height ${h.toFixed(2)}m (declared ${spec.height}m)`
  );
}

if (problems.length) {
  console.error('TREES_FAIL');
  for (const p of problems) console.error('  ✗', p);
  process.exit(1);
}
console.log('TREES_OK');
