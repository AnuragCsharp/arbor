import * as THREE from 'three';
import { createTree, growthScale, GROWTH_DURATION, type TreeType } from './trees';

export interface ARCallbacks {
  onStatus: (msg: string, kind?: 'info' | 'error') => void;
  onReticle: (visible: boolean) => void;
  onPlacedCountChange: (n: number) => void;
  onFirstPlacement: () => void;
  onSessionEnd: () => void;
  getCurrentTree: () => TreeType;
  getScale: () => number;
}

interface Placed {
  group: THREE.Group;
  baseScale: number;
  growthStart: number; // performance.now() ms
  anchor?: XRAnchor;
}

/**
 * Immersive WebXR AR experience: scan → reticle on real surfaces → tap to plant
 * a procedural tree that grows in place. Uses the XR animation loop, a
 * viewer-space hit-test source, local-floor when available, and optional anchors.
 */
export class ARExperience {
  private cb: ARCallbacks;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera();
  private reticle: THREE.Mesh;
  private reticleMat: THREE.MeshBasicMaterial;

  private session: XRSession | null = null;
  private refSpace: XRReferenceSpace | null = null;
  private hitTestSource: XRHitTestSource | null = null;
  private lastHit: XRHitTestResult | null = null;
  private anchorsEnabled = false;
  /** true only when the UA actually granted the dom-overlay feature */
  domOverlayActive = false;

  private placed: Placed[] = [];

  constructor(cb: ARCallbacks) {
    this.cb = cb;

    const canvas = document.createElement('canvas');
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.xr.enabled = true;

    // lighting — soft ambient + a shadow-casting key light
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x334433, 1.1));
    const key = new THREE.DirectionalLight(0xffffff, 1.4);
    key.position.set(2, 5, 2);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    const c = key.shadow.camera as THREE.OrthographicCamera;
    c.left = -5;
    c.right = 5;
    c.top = 5;
    c.bottom = -5;
    c.near = 0.1;
    c.far = 20;
    this.scene.add(key);
    this.scene.add(key.target);

    // reticle — a flat ring laid on the detected surface
    this.reticleMat = new THREE.MeshBasicMaterial({ color: 0xffc148, transparent: true, opacity: 0.9 });
    this.reticle = new THREE.Mesh(
      new THREE.RingGeometry(0.08, 0.1, 32).rotateX(-Math.PI / 2),
      this.reticleMat
    );
    this.reticle.matrixAutoUpdate = false;
    this.reticle.visible = false;
    this.scene.add(this.reticle);
  }

  /** returns true when an immersive-ar session actually started. */
  async start(overlayRoot: HTMLElement | null): Promise<boolean> {
    const xr = (navigator as Navigator & { xr?: XRSystem }).xr;
    if (!xr) {
      this.cb.onStatus('WebXR is not available in this browser.', 'error');
      return false;
    }
    const supported = await xr.isSessionSupported('immersive-ar').catch(() => false);
    if (!supported) {
      this.cb.onStatus('Immersive AR is not supported on this device/browser.', 'error');
      return false;
    }

    const optionalFeatures: string[] = ['local-floor', 'anchors', 'bounded-floor'];
    if (overlayRoot) optionalFeatures.push('dom-overlay');

    const init: XRSessionInit = {
      requiredFeatures: ['hit-test'],
      optionalFeatures,
    };
    if (overlayRoot) {
      (init as XRSessionInit & { domOverlay?: { root: HTMLElement } }).domOverlay = { root: overlayRoot };
    }

    let session: XRSession;
    try {
      session = await xr.requestSession('immersive-ar', init);
    } catch (err) {
      this.cb.onStatus(`Could not start AR: ${(err as Error).message}`, 'error');
      return false;
    }
    this.session = session;
    this.anchorsEnabled = !!session.enabledFeatures?.includes('anchors');
    this.domOverlayActive = !!session.enabledFeatures?.includes('dom-overlay');

    await this.renderer.xr.setSession(session);

    // reference space: prefer local-floor so y=0 is the ground
    this.refSpace =
      (await this.renderer.xr.getReferenceSpace()) ??
      (await session.requestReferenceSpace('local-floor').catch(() => null)) ??
      (await session.requestReferenceSpace('local'));

    // viewer-space hit-test source (ray out from the device)
    try {
      const viewerSpace = await session.requestReferenceSpace('viewer');
      const src = await session.requestHitTestSource?.({ space: viewerSpace });
      this.hitTestSource = src ?? null;
    } catch {
      this.hitTestSource = null;
    }

    if (!this.hitTestSource) {
      this.cb.onStatus(
        'Surface detection (hit-test) is unavailable, so placement is disabled on this device.',
        'error'
      );
    } else {
      this.cb.onStatus('Move your phone to scan the floor, then tap to plant.', 'info');
    }

    session.addEventListener('select', this.onSelect);
    session.addEventListener('end', this.onEnd);

    this.renderer.setAnimationLoop(this.onFrame);
    return true;
  }

  private onSelect = (): void => {
    if (!this.reticle.visible || !this.lastHit || !this.refSpace) return;

    const pos = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    const scl = new THREE.Vector3();
    this.reticle.matrix.decompose(pos, quat, scl);

    const base = this.cb.getScale();
    const group = createTree(this.cb.getCurrentTree());
    group.position.copy(pos);
    group.quaternion.copy(quat);
    group.scale.setScalar(growthScale(0) * base);
    this.scene.add(group);

    const entry: Placed = { group, baseScale: base, growthStart: performance.now() };
    this.placed.push(entry);

    // optional anchor for stability where supported
    if (this.anchorsEnabled && typeof this.lastHit.createAnchor === 'function') {
      this.lastHit.createAnchor().then(
        (anchor) => {
          entry.anchor = anchor;
        },
        () => {
          /* anchor failed — tree stays statically placed, still fine */
        }
      );
    }

    if (this.placed.length === 1) this.cb.onFirstPlacement();
    this.cb.onPlacedCountChange(this.placed.length);
  };

  private onFrame = (_t: number, frame?: XRFrame): void => {
    if (frame && this.hitTestSource && this.refSpace) {
      const results = frame.getHitTestResults(this.hitTestSource);
      if (results.length > 0) {
        const pose = results[0].getPose(this.refSpace);
        if (pose) {
          this.lastHit = results[0];
          this.reticle.visible = true;
          this.reticle.matrix.fromArray(pose.transform.matrix);
          this.reticleMat.color.setHex(0x4ade80); // valid → green
          this.cb.onReticle(true);
        }
      } else {
        this.reticle.visible = false;
        this.lastHit = null;
        this.cb.onReticle(false);
      }
    }

    // keep anchored trees locked to their real-world anchor
    if (frame && this.refSpace) {
      for (const p of this.placed) {
        if (p.anchor) {
          const pose = frame.getPose(p.anchor.anchorSpace, this.refSpace);
          if (pose) {
            p.group.position.set(
              pose.transform.position.x,
              pose.transform.position.y,
              pose.transform.position.z
            );
            p.group.quaternion.set(
              pose.transform.orientation.x,
              pose.transform.orientation.y,
              pose.transform.orientation.z,
              pose.transform.orientation.w
            );
          }
        }
      }
    }

    // growth animation
    const now = performance.now();
    for (const p of this.placed) {
      const elapsed = (now - p.growthStart) / 1000;
      if (elapsed <= GROWTH_DURATION + 0.1) {
        p.group.scale.setScalar(growthScale(elapsed) * p.baseScale);
      }
    }

    this.renderer.render(this.scene, this.camera);
  };

  /** live-update the size multiplier applied to the most recent tree. */
  rescaleLast(multiplier: number): void {
    const p = this.placed[this.placed.length - 1];
    if (!p) return;
    p.baseScale = multiplier;
    // if growth is done, apply immediately
    const elapsed = (performance.now() - p.growthStart) / 1000;
    p.group.scale.setScalar(growthScale(elapsed) * multiplier);
  }

  undo(): void {
    const p = this.placed.pop();
    if (p) {
      this.scene.remove(p.group);
      this.disposeGroup(p.group);
      this.cb.onPlacedCountChange(this.placed.length);
    }
  }

  clear(): void {
    for (const p of this.placed) {
      this.scene.remove(p.group);
      this.disposeGroup(p.group);
    }
    this.placed = [];
    this.cb.onPlacedCountChange(0);
  }

  private disposeGroup(group: THREE.Group): void {
    // geometry/materials are shared & cached in trees.ts, so we only drop refs.
    group.clear();
  }

  async end(): Promise<void> {
    try {
      await this.session?.end();
    } catch {
      /* already ended */
    }
  }

  private onEnd = (): void => {
    this.renderer.setAnimationLoop(null);
    this.hitTestSource?.cancel?.();
    this.hitTestSource = null;
    this.session = null;
    this.clear();
    this.cb.onSessionEnd();
  };
}
