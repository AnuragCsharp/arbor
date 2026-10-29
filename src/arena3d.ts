import * as THREE from 'three';
import { createTree, growthScale, GROWTH_DURATION, type TreeType } from './trees';
import { ArenaGame } from './game';
import { sfx, unlockAudio } from './sfx';

/**
 * Non-AR "Arena" driver — a first-person turret view that runs on ANY device
 * (including iOS Safari, which has no WebXR). You stand in the centre of a
 * grove: drag to look, tap the ground to plant trees, pinch to resize the last
 * one, then lock the arena. Enemies rush in from random directions to chop your
 * trees; a centre crosshair fires a laser on tap.
 */

export type ArenaPhase = 'build' | 'play' | 'over';

export interface ArenaCallbacks {
  getCurrentTree: () => TreeType;
  onPhase: (p: ArenaPhase) => void;
  onPlacedCount: (n: number) => void;
  onScore: (s: number) => void;
  onTreesRemaining: (alive: number, total: number) => void;
  onWave: (w: number) => void;
  onGameOver: (score: number) => void;
  onHint: (msg: string) => void;
}

interface Planted {
  group: THREE.Group;
  type: TreeType;
  baseScale: number;
  growthStart: number;
  pos: THREE.Vector3;
}

const LOOK_SENS = 0.0042;
const TAP_MOVE_PX = 9;
const TAP_MS = 350;
const GROUND_Y = 0;
const MAX_PLACE_R = 12;
const MIN_PLACE_R = 1.1;

export class ArenaExperience {
  private cb: ArenaCallbacks;
  private mount: HTMLElement;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private clock = new THREE.Clock();
  private raycaster = new THREE.Raycaster();
  private groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

  private game: ArenaGame;
  private phase: ArenaPhase = 'build';
  private placed: Planted[] = [];

  private yaw = 0;
  private pitch = -0.1;
  private pointers = new Map<number, { x: number; y: number }>();
  private down: { x: number; y: number; t: number; moved: boolean } | null = null;
  private pinchStart = 0;
  private pinchBase = 1;

  private reticle: THREE.Mesh;
  private arenaRing: THREE.Mesh | null = null;
  private beams: { mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial; life: number }[] = [];
  private running = false;
  private raf = 0;

  constructor(mount: HTMLElement, cb: ArenaCallbacks) {
    this.mount = mount;
    this.cb = cb;

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearAlpha(0);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.domElement.classList.add('arena-canvas');

    this.camera = new THREE.PerspectiveCamera(70, 1, 0.05, 120);
    this.camera.position.set(0, 1.6, 0);

    this.scene.fog = new THREE.Fog(0x06100c, 9, 46);

    // lighting
    this.scene.add(new THREE.HemisphereLight(0xcfe8ff, 0x1c2a22, 1.0));
    const key = new THREE.DirectionalLight(0xffffff, 1.5);
    key.position.set(6, 12, 4);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    const c = key.shadow.camera as THREE.OrthographicCamera;
    c.left = -18;
    c.right = 18;
    c.top = 18;
    c.bottom = -18;
    c.near = 0.5;
    c.far = 60;
    this.scene.add(key, key.target);

    this.buildGround();

    // ground placement reticle (build phase)
    this.reticle = new THREE.Mesh(
      new THREE.RingGeometry(0.22, 0.3, 28).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0x4ade80, transparent: true, opacity: 0.85 })
    );
    this.reticle.visible = false;
    this.scene.add(this.reticle);

    this.game = new ArenaGame(this.scene, {
      onScore: (s) => this.cb.onScore(s),
      onTreesRemaining: (a, t) => this.cb.onTreesRemaining(a, t),
      onWave: (w) => this.cb.onWave(w),
      onGameOver: (s) => this.endToOver(s),
      sfx: { chop: sfx.chop, explosion: sfx.explosion, treeDown: sfx.treeDown, gameOver: sfx.gameOver },
    });
  }

  private buildGround(): void {
    const disc = new THREE.Mesh(
      new THREE.CircleGeometry(MAX_PLACE_R + 6, 48).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: 0x14241b, roughness: 1 })
    );
    disc.position.y = GROUND_Y;
    disc.receiveShadow = true;
    this.scene.add(disc);

    const grid = new THREE.PolarGridHelper(MAX_PLACE_R + 4, 16, 8, 64, 0x2f6b48, 0x1e3a2b);
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.4;
    grid.position.y = GROUND_Y + 0.01;
    this.scene.add(grid);
  }

  /* ---------- lifecycle ---------- */

  start(): void {
    this.mount.appendChild(this.renderer.domElement);
    this.resize();
    this.attachInput();
    window.addEventListener('resize', this.resize);
    this.running = true;
    this.phase = 'build';
    this.cb.onPhase('build');
    this.cb.onHint('Tap the ground to plant a tree. Pinch to resize. Drag to look around.');
    this.loop();
  }

  dispose(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.detachInput();
    window.removeEventListener('resize', this.resize);
    this.game.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  private resize = (): void => {
    const w = this.mount.clientWidth || window.innerWidth;
    const h = this.mount.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  };

  /* ---------- build phase ---------- */

  private centerScreenGroundPoint(): THREE.Vector3 | null {
    return this.groundPointFromNdc(0, 0);
  }

  private groundPointFromNdc(nx: number, ny: number): THREE.Vector3 | null {
    this.raycaster.setFromCamera(new THREE.Vector2(nx, ny), this.camera);
    const hit = new THREE.Vector3();
    const ok = this.raycaster.ray.intersectPlane(this.groundPlane, hit);
    if (!ok) return null;
    const r = Math.hypot(hit.x, hit.z);
    if (r < MIN_PLACE_R || r > MAX_PLACE_R) return null;
    return hit;
  }

  private placeAt(pos: THREE.Vector3): void {
    unlockAudio();
    const type = this.cb.getCurrentTree();
    const group = createTree(type);
    group.position.copy(pos);
    group.rotation.y = Math.random() * Math.PI * 2;
    group.scale.setScalar(growthScale(0));
    this.scene.add(group);
    this.placed.push({ group, type, baseScale: 1, growthStart: this.clock.elapsedTime, pos: pos.clone() });
    this.game.registerTree(group, type, pos);
    this.cb.onPlacedCount(this.placed.length);
    sfx.plant();
  }

  undo(): void {
    const p = this.placed.pop();
    if (!p) return;
    this.scene.remove(p.group);
    p.group.clear();
    // rebuild the game's tree registry from the survivors
    this.reregisterTrees();
    this.cb.onPlacedCount(this.placed.length);
  }

  clear(): void {
    for (const p of this.placed) {
      this.scene.remove(p.group);
      p.group.clear();
    }
    this.placed = [];
    this.reregisterTrees();
    this.cb.onPlacedCount(0);
  }

  private reregisterTrees(): void {
    this.game.dispose();
    this.game = new ArenaGame(this.scene, {
      onScore: (s) => this.cb.onScore(s),
      onTreesRemaining: (a, t) => this.cb.onTreesRemaining(a, t),
      onWave: (w) => this.cb.onWave(w),
      onGameOver: (s) => this.endToOver(s),
      sfx: { chop: sfx.chop, explosion: sfx.explosion, treeDown: sfx.treeDown, gameOver: sfx.gameOver },
    });
    for (const p of this.placed) {
      // reset any topple from a previous round
      p.group.rotation.z = 0;
      p.group.scale.setScalar(p.baseScale);
      this.game.registerTree(p.group, p.type, p.pos);
    }
  }

  /** Lock the arena and start the assault. Returns false if no trees planted. */
  lockArena(): boolean {
    if (this.placed.length === 0) {
      this.cb.onHint('Plant at least one tree before locking the arena.');
      return false;
    }
    unlockAudio();
    // make sure every tree is at full size and upright
    for (const p of this.placed) {
      p.group.scale.setScalar(p.baseScale);
      p.group.rotation.z = 0;
    }
    if (!this.game.start()) return false;
    this.drawArenaRing();
    this.reticle.visible = false;
    this.phase = 'play';
    this.cb.onPhase('play');
    this.cb.onHint('Aim with the crosshair and tap to fire. Defend your grove!');
    return true;
  }

  private drawArenaRing(): void {
    if (this.arenaRing) this.scene.remove(this.arenaRing);
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(MAX_PLACE_R + 1.9, MAX_PLACE_R + 2.1, 64).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0xffc148, transparent: true, opacity: 0.35 })
    );
    ring.position.y = GROUND_Y + 0.02;
    this.arenaRing = ring;
    this.scene.add(ring);
  }

  restart(): void {
    // keep the planted trees, replay from a fresh build phase
    if (this.arenaRing) {
      this.scene.remove(this.arenaRing);
      this.arenaRing = null;
    }
    this.reregisterTrees();
    this.phase = 'build';
    this.cb.onPhase('build');
    this.cb.onScore(0);
    this.cb.onHint('Adjust your grove, then lock the arena again.');
  }

  private endToOver(score: number): void {
    this.phase = 'over';
    this.cb.onPhase('over');
    this.cb.onGameOver(score);
  }

  /* ---------- shooting ---------- */

  private shoot(): void {
    unlockAudio();
    sfx.laser();
    const origin = this.camera.position.clone();
    const dir = new THREE.Vector3();
    this.camera.getWorldDirection(dir);
    const hit = this.game.shootRay(origin, dir);
    const end = hit ?? origin.clone().addScaledVector(dir, 40);
    this.spawnBeam(origin, end);
  }

  private spawnBeam(from: THREE.Vector3, to: THREE.Vector3): void {
    const muzzle = from.clone().addScaledVector(new THREE.Vector3(0, -0.12, 0), 1);
    const dir = to.clone().sub(muzzle);
    const len = dir.length();
    if (len < 0.01) return;
    const geo = new THREE.CylinderGeometry(0.03, 0.03, len, 6, 1, true);
    geo.translate(0, len / 2, 0);
    geo.rotateX(Math.PI / 2); // align +z
    const mat = new THREE.MeshBasicMaterial({
      color: 0x7dffb0,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const beam = new THREE.Mesh(geo, mat);
    beam.position.copy(muzzle);
    beam.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir.clone().normalize());
    this.scene.add(beam);
    this.beams.push({ mesh: beam, mat, life: 0.12 });
  }

  /* ---------- input ---------- */

  private attachInput(): void {
    const el = this.renderer.domElement;
    el.addEventListener('pointerdown', this.onPointerDown);
    el.addEventListener('pointermove', this.onPointerMove);
    el.addEventListener('pointerup', this.onPointerUp);
    el.addEventListener('pointercancel', this.onPointerUp);
  }
  private detachInput(): void {
    const el = this.renderer.domElement;
    el.removeEventListener('pointerdown', this.onPointerDown);
    el.removeEventListener('pointermove', this.onPointerMove);
    el.removeEventListener('pointerup', this.onPointerUp);
    el.removeEventListener('pointercancel', this.onPointerUp);
  }

  private onPointerDown = (e: PointerEvent): void => {
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.pointers.size === 2) {
      this.pinchStart = this.pointerDistance();
      const last = this.placed[this.placed.length - 1];
      this.pinchBase = last ? last.baseScale : 1;
      this.down = null;
    } else {
      this.down = { x: e.clientX, y: e.clientY, t: this.clock.elapsedTime * 1000, moved: false };
    }
  };

  private onPointerMove = (e: PointerEvent): void => {
    if (!this.pointers.has(e.pointerId)) return;
    const prev = this.pointers.get(e.pointerId)!;
    const dx = e.clientX - prev.x;
    const dy = e.clientY - prev.y;
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (this.pointers.size >= 2) {
      // pinch-to-resize the most recent tree (build phase only)
      if (this.phase === 'build') this.applyPinch();
      return;
    }

    // single pointer → look around
    if (this.down) {
      if (Math.abs(e.clientX - this.down.x) > TAP_MOVE_PX || Math.abs(e.clientY - this.down.y) > TAP_MOVE_PX) {
        this.down.moved = true;
      }
      this.yaw -= dx * LOOK_SENS;
      this.pitch -= dy * LOOK_SENS;
      this.pitch = Math.max(-1.2, Math.min(0.5, this.pitch));
    }
  };

  private onPointerUp = (e: PointerEvent): void => {
    const wasTwo = this.pointers.size >= 2;
    this.pointers.delete(e.pointerId);
    if (wasTwo) return; // finishing a pinch — no tap/shoot

    const d = this.down;
    this.down = null;
    if (!d) return;
    const dt = this.clock.elapsedTime * 1000 - d.t;
    if (d.moved || dt > TAP_MS) return; // it was a drag/hold, not a tap

    if (this.phase === 'play') {
      this.shoot();
    } else if (this.phase === 'build') {
      // plant where the centred preview ring sits (the aim point)
      const pt = this.centerScreenGroundPoint();
      if (pt) this.placeAt(pt);
      else this.cb.onHint('Aim at open ground around you (not too close, not too far) to plant.');
    }
  };

  private pointerDistance(): number {
    const pts = [...this.pointers.values()];
    if (pts.length < 2) return 0;
    return Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
  }

  private applyPinch(): void {
    const last = this.placed[this.placed.length - 1];
    if (!last || this.pinchStart <= 0) return;
    const ratio = this.pointerDistance() / this.pinchStart;
    last.baseScale = Math.max(0.4, Math.min(2.5, this.pinchBase * ratio));
    // apply immediately (growth already finished for an existing tree)
    last.group.scale.setScalar(last.baseScale);
  }

  /* ---------- render loop ---------- */

  private loop = (): void => {
    if (!this.running) return;
    this.raf = requestAnimationFrame(this.loop);
    const dt = Math.min(this.clock.getDelta(), 0.05);

    // camera orientation from yaw/pitch
    this.camera.quaternion.setFromEuler(new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ'));

    // build-phase placement reticle follows the screen centre
    if (this.phase === 'build') {
      const pt = this.centerScreenGroundPoint();
      if (pt) {
        this.reticle.visible = true;
        this.reticle.position.copy(pt);
      } else {
        this.reticle.visible = false;
      }
    }

    // grow freshly planted trees
    for (const p of this.placed) {
      const elapsed = this.clock.elapsedTime - p.growthStart;
      if (elapsed <= GROWTH_DURATION + 0.1) {
        p.group.scale.setScalar(growthScale(elapsed) * p.baseScale);
      }
    }

    if (this.phase === 'play') this.game.update(dt);

    // fade laser beams
    for (let i = this.beams.length - 1; i >= 0; i--) {
      const b = this.beams[i];
      b.life -= dt;
      b.mat.opacity = Math.max(0, b.life / 0.12) * 0.9;
      if (b.life <= 0) {
        this.scene.remove(b.mesh);
        b.mesh.geometry.dispose();
        b.mat.dispose();
        this.beams.splice(i, 1);
      }
    }

    this.renderer.render(this.scene, this.camera);
  };
}
