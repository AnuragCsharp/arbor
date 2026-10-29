import * as THREE from 'three';
import { type TreeType } from './trees';

/**
 * ARBOR Arena — a small tower-defense game layer that runs on top of any
 * THREE.Scene (the non-AR 3D driver and, where available, the WebXR session).
 *
 * The engine is deliberately framework-agnostic and side-effect-light: all
 * sound and HUD updates arrive through callbacks, so it can be simulated
 * headlessly in tests with a deterministic RNG and injected clock.
 */

/** Hit points per tree species — sturdier trees take more hits to fell. */
export const TREE_HP: Record<TreeType, number> = { pine: 3, palm: 4, oak: 5 };

export interface GameSfx {
  chop(): void;
  explosion(): void;
  treeDown(): void;
  gameOver(): void;
}

export interface GameCallbacks {
  onScore(score: number): void;
  onTreesRemaining(remaining: number, total: number): void;
  onWave(wave: number): void;
  onGameOver(score: number): void;
  sfx: GameSfx;
}

export interface GameOptions {
  /** metres/second an enemy advances toward a tree */
  enemySpeed?: number;
  /** how close (m) an enemy must be to start chopping */
  attackRange?: number;
  /** seconds between an enemy's chops */
  attackInterval?: number;
  /** seconds between spawns at the start (shrinks each wave) */
  spawnInterval?: number;
  /** max simultaneous living enemies */
  maxEnemies?: number;
  /** distance (m) beyond the arena edge where enemies appear */
  spawnMargin?: number;
  /** points awarded per enemy killed */
  pointsPerKill?: number;
  /** injectable RNG for deterministic tests (defaults to Math.random) */
  rng?: () => number;
}

interface GameTree {
  group: THREE.Object3D;
  type: TreeType;
  hp: number;
  maxHp: number;
  pos: THREE.Vector3;
  alive: boolean;
}

interface Enemy {
  mesh: THREE.Group;
  pos: THREE.Vector3;
  target: GameTree | null;
  alive: boolean;
  attackCd: number;
  hitRadius: number;
  speed: number;
  bobPhase: number;
}

const DEFAULTS: Required<Omit<GameOptions, 'rng'>> = {
  enemySpeed: 0.55,
  attackRange: 0.75,
  attackInterval: 1.1,
  spawnInterval: 3.2,
  maxEnemies: 6,
  spawnMargin: 2.2,
  pointsPerKill: 10,
};

export class ArenaGame {
  private scene: THREE.Scene;
  private cb: GameCallbacks;
  private opt: Required<Omit<GameOptions, 'rng'>>;
  private rng: () => number;

  private trees: GameTree[] = [];
  private enemies: Enemy[] = [];
  private center = new THREE.Vector3();
  private spawnRadius = 3;

  private _playing = false;
  private _over = false;
  private _score = 0;
  private _wave = 0;
  private spawnTimer = 0;
  private spawnedThisWave = 0;
  private waveSize = 3;

  constructor(scene: THREE.Scene, cb: GameCallbacks, options: GameOptions = {}) {
    this.scene = scene;
    this.cb = cb;
    this.opt = { ...DEFAULTS, ...options };
    this.rng = options.rng ?? Math.random;
  }

  get isPlaying(): boolean {
    return this._playing;
  }
  get isOver(): boolean {
    return this._over;
  }
  get score(): number {
    return this._score;
  }
  get wave(): number {
    return this._wave;
  }

  /** Register a planted tree (during the build phase). */
  registerTree(group: THREE.Object3D, type: TreeType, pos: THREE.Vector3): void {
    const maxHp = TREE_HP[type];
    this.trees.push({ group, type, hp: maxHp, maxHp, pos: pos.clone(), alive: true });
  }

  treeCount(): number {
    return this.trees.length;
  }

  aliveTreeCount(): number {
    return this.trees.filter((t) => t.alive).length;
  }

  enemyCount(): number {
    return this.enemies.filter((e) => e.alive).length;
  }

  /** test/debug read-out of living enemies */
  debugEnemies(): { x: number; y: number; z: number; hitRadius: number }[] {
    return this.enemies
      .filter((e) => e.alive)
      .map((e) => ({ x: e.pos.x, y: e.pos.y, z: e.pos.z, hitRadius: e.hitRadius }));
  }

  /** Lock the arena and begin the assault. Needs at least one tree. */
  start(): boolean {
    if (this.trees.length === 0) return false;
    // arena bounds from planted trees
    this.center.set(0, 0, 0);
    for (const t of this.trees) this.center.add(t.pos);
    this.center.multiplyScalar(1 / this.trees.length);
    this.center.y = 0;
    let r = 1;
    for (const t of this.trees) {
      const d = Math.hypot(t.pos.x - this.center.x, t.pos.z - this.center.z);
      if (d > r) r = d;
    }
    this.spawnRadius = r + this.opt.spawnMargin + 2;

    this._playing = true;
    this._over = false;
    this._score = 0;
    this._wave = 1;
    this.waveSize = 3;
    this.spawnedThisWave = 0;
    this.spawnTimer = 0.6; // brief grace before the first enemy
    this.cb.onScore(0);
    this.cb.onWave(1);
    this.cb.onTreesRemaining(this.aliveTreeCount(), this.trees.length);
    return true;
  }

  /** Advance the simulation by `dt` seconds. */
  update(dt: number): void {
    if (!this._playing) return;

    // spawning / wave pacing
    this.spawnTimer -= dt;
    const interval = Math.max(0.9, this.opt.spawnInterval - (this._wave - 1) * 0.35);
    if (this.spawnTimer <= 0 && this.enemyCount() < this.opt.maxEnemies) {
      if (this.spawnedThisWave < this.waveSize) {
        this.spawn();
        this.spawnedThisWave++;
        this.spawnTimer = interval;
      } else if (this.enemyCount() === 0) {
        // wave cleared → next, bigger wave
        this._wave++;
        this.waveSize++;
        this.spawnedThisWave = 0;
        this.spawnTimer = 1.4;
        this.cb.onWave(this._wave);
      }
    }

    // enemy behaviour
    for (const e of this.enemies) {
      if (!e.alive) continue;
      e.bobPhase += dt * 6;
      if (!e.target || !e.target.alive) e.target = this.nearestTree(e.pos);
      const tree = e.target;
      if (!tree) continue;

      const dx = tree.pos.x - e.pos.x;
      const dz = tree.pos.z - e.pos.z;
      const dist = Math.hypot(dx, dz);

      if (dist > this.opt.attackRange) {
        const step = Math.min(e.speed * dt, dist);
        e.pos.x += (dx / dist) * step;
        e.pos.z += (dz / dist) * step;
        e.attackCd = 0; // ready to strike on arrival
        // face the tree
        e.mesh.rotation.y = Math.atan2(dx, dz);
      } else {
        e.attackCd -= dt;
        if (e.attackCd <= 0) {
          this.strike(tree);
          e.attackCd = this.opt.attackInterval;
        }
      }
      e.mesh.position.set(e.pos.x, e.pos.y + Math.abs(Math.sin(e.bobPhase)) * 0.08, e.pos.z);
    }
  }

  private strike(tree: GameTree): void {
    if (!tree.alive) return;
    tree.hp -= 1;
    this.cb.sfx.chop();
    // quick shake so the hit reads visually
    tree.group.rotation.z = (this.rng() - 0.5) * 0.14;
    if (tree.hp <= 0) {
      tree.alive = false;
      tree.group.rotation.z = Math.PI / 2.2; // toppled
      this.cb.sfx.treeDown();
      this.cb.onTreesRemaining(this.aliveTreeCount(), this.trees.length);
      if (this.aliveTreeCount() === 0) this.endGame();
    }
  }

  private endGame(): void {
    this._playing = false;
    this._over = true;
    this.cb.sfx.gameOver();
    this.cb.onGameOver(this._score);
  }

  private nearestTree(from: THREE.Vector3): GameTree | null {
    let best: GameTree | null = null;
    let bestD = Infinity;
    for (const t of this.trees) {
      if (!t.alive) continue;
      const d = Math.hypot(t.pos.x - from.x, t.pos.z - from.z);
      if (d < bestD) {
        bestD = d;
        best = t;
      }
    }
    return best;
  }

  /** Spawn one enemy from a random compass direction, aimed at the nearest tree. */
  spawn(): void {
    const angle = this.rng() * Math.PI * 2;
    const pos = new THREE.Vector3(
      this.center.x + Math.cos(angle) * this.spawnRadius,
      0,
      this.center.z + Math.sin(angle) * this.spawnRadius
    );
    const mesh = createEnemy();
    mesh.position.copy(pos);
    this.scene.add(mesh);
    const enemy: Enemy = {
      mesh,
      pos,
      target: this.nearestTree(pos),
      alive: true,
      attackCd: 0,
      hitRadius: 0.42,
      speed: this.opt.enemySpeed + this.rng() * 0.2,
      bobPhase: this.rng() * Math.PI * 2,
    };
    this.enemies.push(enemy);
  }

  /**
   * Fire a ray (crosshair line of sight). Kills the nearest enemy whose body is
   * within its hit radius of the ray and in front of the origin. Returns the
   * world point that was hit (enemy position) or null on a miss.
   */
  shootRay(origin: THREE.Vector3, dir: THREE.Vector3): THREE.Vector3 | null {
    if (!this._playing) return null;
    const d = dir.clone().normalize();
    let best: Enemy | null = null;
    let bestT = Infinity;
    const v = new THREE.Vector3();
    for (const e of this.enemies) {
      if (!e.alive) continue;
      v.copy(e.mesh.position).sub(origin);
      const t = v.dot(d);
      if (t <= 0) continue; // behind the camera
      const perp = v.addScaledVector(d, -t).length(); // distance from ray
      if (perp <= e.hitRadius && t < bestT) {
        bestT = t;
        best = e;
      }
    }
    if (!best) return null;
    const hit = best.mesh.position.clone();
    this.kill(best);
    return hit;
  }

  private kill(e: Enemy): void {
    e.alive = false;
    this.scene.remove(e.mesh);
    disposeObject(e.mesh);
    this._score += this.opt.pointsPerKill;
    this.cb.sfx.explosion();
    this.cb.onScore(this._score);
  }

  /** Remove every enemy and reset to a fresh build phase (keeps nothing). */
  dispose(): void {
    for (const e of this.enemies) {
      this.scene.remove(e.mesh);
      disposeObject(e.mesh);
    }
    this.enemies = [];
    this.trees = [];
    this._playing = false;
    this._over = false;
  }
}

/* ---------- enemy model (shared faceted "sap-beetle") ---------- */

let enemyCache: {
  body: THREE.IcosahedronGeometry;
  spike: THREE.ConeGeometry;
  eye: THREE.SphereGeometry;
  bodyMat: THREE.MeshStandardMaterial;
  spikeMat: THREE.MeshStandardMaterial;
  eyeMat: THREE.MeshStandardMaterial;
} | null = null;

function enemyRes() {
  if (enemyCache) return enemyCache;
  enemyCache = {
    body: new THREE.IcosahedronGeometry(0.3, 0),
    spike: new THREE.ConeGeometry(0.07, 0.22, 4),
    eye: new THREE.SphereGeometry(0.05, 8, 8),
    bodyMat: new THREE.MeshStandardMaterial({ color: 0x3a0d12, flatShading: true, roughness: 0.6 }),
    spikeMat: new THREE.MeshStandardMaterial({ color: 0x1a0507, flatShading: true, roughness: 0.5 }),
    eyeMat: new THREE.MeshStandardMaterial({
      color: 0xff3b30,
      emissive: 0xff2a1f,
      emissiveIntensity: 1.4,
      roughness: 0.3,
    }),
  };
  return enemyCache;
}

/** A small, menacing low-poly creature that crawls toward the trees. */
export function createEnemy(): THREE.Group {
  const r = enemyRes();
  const g = new THREE.Group();

  const body = new THREE.Mesh(r.body, r.bodyMat);
  body.position.y = 0.3;
  body.castShadow = true;
  g.add(body);

  // back spikes
  for (let i = 0; i < 3; i++) {
    const s = new THREE.Mesh(r.spike, r.spikeMat);
    s.position.set(0, 0.42 + i * 0.02, -0.06 - i * 0.08);
    s.rotation.x = -0.5;
    g.add(s);
  }
  // two glowing eyes facing +z (its forward)
  for (const sx of [-0.1, 0.1]) {
    const eye = new THREE.Mesh(r.eye, r.eyeMat);
    eye.position.set(sx, 0.34, 0.24);
    g.add(eye);
  }
  g.name = 'enemy';
  return g;
}

function disposeObject(obj: THREE.Object3D): void {
  obj.traverse((o) => {
    const m = o as THREE.Mesh;
    // geometry & materials are shared/cached; just drop references
    if (m.isMesh) m.clear();
  });
  obj.clear();
}
