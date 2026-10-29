/**
 * Honest capability detection for ARBOR.
 *
 * Every probe is guarded so this module can also run in Node (for tests) and in
 * browsers that lack the relevant API. We never *assert* a capability we cannot
 * observe from a browser API — e.g. we do not treat LiDAR/depth hardware as proof
 * of browser-level depth access, and DOM-overlay / hit-test support are only
 * reported as "intended" until an actual XR session confirms them at runtime.
 */

export type Platform = 'ios' | 'android' | 'other';
export type Pathway = 'webxr' | 'quicklook' | 'sceneviewer' | 'none';

export interface CapabilityReport {
  secureContext: boolean;
  /** camera *API* is present (we do not prompt for permission here) */
  cameraApi: boolean;
  /** navigator.xr object exists */
  webxr: boolean;
  /** immersive-ar reported supported by navigator.xr.isSessionSupported */
  immersiveAR: boolean;
  /** we will *request* hit-test; only confirmable once the session starts */
  hitTestIntended: boolean;
  /** DOM overlay is likely (Android Chrome WebXR); confirmed via session.domOverlayState */
  domOverlayLikely: boolean;
  /** Apple AR Quick Look (<a rel="ar"> + ARKit) */
  quickLook: boolean;
  /** Android Scene Viewer intent fallback */
  sceneViewer: boolean;
  platform: Platform;
  recommended: Pathway;
}

function has(obj: unknown, key: string): boolean {
  return !!obj && typeof (obj as Record<string, unknown>)[key] !== 'undefined';
}

export function detectPlatform(): Platform {
  if (typeof navigator === 'undefined') return 'other';
  const ua = navigator.userAgent || '';
  const isIOS =
    /iPad|iPhone|iPod/.test(ua) ||
    // iPadOS 13+ reports as Mac; disambiguate with touch points
    (/Macintosh/.test(ua) && typeof navigator.maxTouchPoints === 'number' && navigator.maxTouchPoints > 1);
  if (isIOS) return 'ios';
  if (/Android/.test(ua)) return 'android';
  return 'other';
}

function quickLookSupported(): boolean {
  if (typeof document === 'undefined') return false;
  try {
    const a = document.createElement('a');
    return !!(a.relList && typeof a.relList.supports === 'function' && a.relList.supports('ar'));
  } catch {
    return false;
  }
}

/** Synchronous, never-throws snapshot. immersiveAR is filled in by {@link detect}. */
export function detectSync(): CapabilityReport {
  const secureContext = typeof window !== 'undefined' ? window.isSecureContext === true : false;
  const cameraApi =
    typeof navigator !== 'undefined' &&
    has(navigator, 'mediaDevices') &&
    typeof navigator.mediaDevices?.getUserMedia === 'function';
  const webxr = typeof navigator !== 'undefined' && has(navigator, 'xr');
  const platform = detectPlatform();

  return {
    secureContext,
    cameraApi,
    webxr,
    immersiveAR: false,
    hitTestIntended: webxr,
    domOverlayLikely: webxr && platform === 'android',
    quickLook: quickLookSupported(),
    sceneViewer: platform === 'android',
    platform,
    recommended: 'none',
  };
}

/** Async detection that actually queries navigator.xr for immersive-ar support. */
export async function detect(): Promise<CapabilityReport> {
  const report = detectSync();

  if (report.webxr && report.secureContext) {
    try {
      const xr = (navigator as Navigator & { xr?: XRSystem }).xr;
      if (xr && typeof xr.isSessionSupported === 'function') {
        report.immersiveAR = await xr.isSessionSupported('immersive-ar');
      }
    } catch {
      report.immersiveAR = false;
    }
  }

  report.recommended = recommend(report);
  return report;
}

export function recommend(r: CapabilityReport): Pathway {
  if (r.immersiveAR && r.secureContext) return 'webxr';
  if (r.quickLook) return 'quicklook';
  if (r.sceneViewer) return 'sceneviewer';
  return 'none';
}
