import * as THREE from 'three';

/**
 * Procedural low-poly trees for ARBOR.
 *
 * Design rules (shared by the WebXR app and the Node asset exporter):
 *  - Root pivot sits at ground level (y = 0); the tree grows upward.
 *  - Real metric heights (metres) so AR scale feels correct.
 *  - Geometry and materials are built once and reused across every instance.
 *  - Flat shading + low segment counts for a clean faceted look.
 */

export type TreeType = 'oak' | 'pine' | 'palm';

export interface TreeSpec {
  type: TreeType;
  label: string;
  /** approximate full-grown height in metres */
  height: number;
  accent: string;
}

export const TREE_SPECS: Record<TreeType, TreeSpec> = {
  oak: { type: 'oak', label: 'Oak', height: 1.5, accent: '#3fbf6f' },
  pine: { type: 'pine', label: 'Pine', height: 1.8, accent: '#2f9e5b' },
  palm: { type: 'palm', label: 'Palm', height: 2.0, accent: '#59c47a' },
};

export const TREE_TYPES: TreeType[] = ['oak', 'pine', 'palm'];

export const GROWTH_DURATION = 1.8; // seconds, 5% -> 100%
const GROWTH_MIN = 0.05;

/** easeOutBack with a gentle settle so the tree overshoots then bounces home. */
export function growthEase(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
}

/** uniform scale for a given elapsed time; clamps to full size after the animation. */
export function growthScale(elapsed: number): number {
  const p = growthEase(elapsed / GROWTH_DURATION);
  return GROWTH_MIN + (1 - GROWTH_MIN) * p;
}

/* ---------- shared, cached resources ---------- */

let cache: {
  trunk: THREE.MeshStandardMaterial;
  bark: THREE.MeshStandardMaterial;
  leafOak: THREE.MeshStandardMaterial;
  leafPine: THREE.MeshStandardMaterial;
  leafPalm: THREE.MeshStandardMaterial;
  oakCanopy: THREE.IcosahedronGeometry;
  pineTier: THREE.ConeGeometry;
  palmSeg: THREE.CylinderGeometry;
  palmLeaf: THREE.ConeGeometry;
} | null = null;

function resources() {
  if (cache) return cache;
  const mat = (color: number, rough = 0.95) =>
    new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: rough, metalness: 0 });
  cache = {
    trunk: mat(0x6b4423),
    bark: mat(0x7a5230),
    leafOak: mat(0x3fbf6f),
    leafPine: mat(0x2f9e5b),
    leafPalm: mat(0x59c47a),
    oakCanopy: new THREE.IcosahedronGeometry(0.5, 1),
    pineTier: new THREE.ConeGeometry(0.42, 0.62, 7),
    palmSeg: new THREE.CylinderGeometry(0.05, 0.065, 0.34, 6),
    palmLeaf: new THREE.ConeGeometry(0.11, 0.95, 4, 1, true),
  };
  return cache;
}

function mesh(geo: THREE.BufferGeometry, material: THREE.Material): THREE.Mesh {
  const m = new THREE.Mesh(geo, material);
  m.castShadow = true;
  m.receiveShadow = false;
  return m;
}

/* ---------- builders ---------- */

function buildOak(): THREE.Group {
  const r = resources();
  const g = new THREE.Group();
  const trunkH = 0.7;
  const trunk = mesh(new THREE.CylinderGeometry(0.07, 0.1, trunkH, 7), r.trunk);
  trunk.position.y = trunkH / 2;
  g.add(trunk);
  // three overlapping faceted canopy blobs ~ total top near 1.5 m
  const blobs: [number, number, number, number][] = [
    [0, 1.02, 0, 1.0],
    [0.24, 0.9, 0.12, 0.62],
    [-0.2, 0.95, -0.14, 0.58],
  ];
  for (const [x, y, z, s] of blobs) {
    const c = mesh(r.oakCanopy, r.leafOak);
    c.position.set(x, y, z);
    c.scale.setScalar(s);
    c.rotation.set(x, y, z);
    g.add(c);
  }
  return g;
}

function buildPine(): THREE.Group {
  const r = resources();
  const g = new THREE.Group();
  const trunkH = 0.6;
  const trunk = mesh(new THREE.CylinderGeometry(0.05, 0.08, trunkH, 7), r.bark);
  trunk.position.y = trunkH / 2;
  g.add(trunk);
  // three layered cones, widest at bottom, topping out at ~1.8 m
  const tiers: [number, number][] = [
    [0.66, 1.08], // y, scale
    [1.14, 0.82],
    [1.62, 0.58],
  ];
  for (const [y, s] of tiers) {
    const cone = mesh(r.pineTier, r.leafPine);
    cone.position.y = y;
    cone.scale.set(s, s, s);
    g.add(cone);
  }
  return g;
}

function buildPalm(): THREE.Group {
  const r = resources();
  const g = new THREE.Group();
  // segmented, gently curving trunk (~1.5 m of trunk, leaves above -> ~2 m)
  const segs = 6;
  const segH = 0.3;
  let x = 0;
  let y = 0;
  const curve = 0.045;
  for (let i = 0; i < segs; i++) {
    const seg = mesh(r.palmSeg, r.bark);
    const lean = curve * i;
    x += Math.sin(lean) * segH * 0.5;
    seg.position.set(x, y + segH / 2, 0);
    seg.rotation.z = -lean;
    seg.scale.setScalar(1 - i * 0.05);
    g.add(seg);
    x += Math.sin(lean) * segH * 0.5;
    y += segH * Math.cos(lean);
  }
  // radial fronds at the crown
  const crown = new THREE.Group();
  crown.position.set(x, y, 0);
  const fronds = 8;
  for (let i = 0; i < fronds; i++) {
    const leaf = mesh(r.palmLeaf, r.leafPalm);
    const a = (i / fronds) * Math.PI * 2;
    leaf.position.set(Math.cos(a) * 0.08, 0.02, Math.sin(a) * 0.08);
    // lay the cone outward and droop it down
    leaf.rotation.order = 'YXZ';
    leaf.rotation.y = -a;
    leaf.rotation.z = Math.PI / 2;
    leaf.rotation.x = 0.5;
    leaf.scale.set(1, 1 + (i % 2) * 0.15, 1);
    crown.add(leaf);
  }
  g.add(crown);
  return g;
}

/**
 * Build a full-size tree whose base is at the origin. Apply growth by setting
 * `group.scale` via {@link growthScale}. The group carries `userData.treeType`.
 */
export function createTree(type: TreeType): THREE.Group {
  let g: THREE.Group;
  switch (type) {
    case 'oak':
      g = buildOak();
      break;
    case 'pine':
      g = buildPine();
      break;
    case 'palm':
      g = buildPalm();
      break;
  }
  g.name = `tree-${type}`;
  g.userData.treeType = type;
  return g;
}

/** Bounding-box height of a freshly built tree — used by tests and the exporter. */
export function measuredHeight(type: TreeType): number {
  const g = createTree(type);
  const box = new THREE.Box3().setFromObject(g);
  return box.max.y - Math.min(0, box.min.y);
}
