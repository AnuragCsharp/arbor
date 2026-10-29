import { TREE_SPECS, type TreeType } from './trees';

/**
 * iOS pathway — Apple AR Quick Look via <model-viewer>.
 *
 * Quick Look is a *native* ARKit experience: it owns floor detection, placement
 * and resizing. We only hand it a tested USDZ (plus a GLB for the in-page
 * preview / Android Scene Viewer). We deliberately do NOT claim an HTML menu
 * inside Quick Look — once it launches, iOS is in control.
 */

interface ModelViewerElement extends HTMLElement {
  activateAR: () => void;
  canActivateAR: boolean;
}

const BASE = import.meta.env.BASE_URL; // e.g. "./" on GitHub Pages
let loaded = false;

async function ensureModelViewer(): Promise<void> {
  if (loaded) return;
  await import('@google/model-viewer');
  loaded = true;
}

/**
 * Render a Quick Look stage for the chosen tree and try to launch AR within the
 * current user gesture. Returns a short status string for the UI.
 */
export async function launchModelViewerAR(type: TreeType, stage: HTMLElement): Promise<string> {
  const spec = TREE_SPECS[type];
  await ensureModelViewer();

  stage.hidden = false;
  stage.innerHTML = '';

  const mv = document.createElement('model-viewer') as ModelViewerElement;
  mv.setAttribute('src', `${BASE}models/${type}.glb`);
  mv.setAttribute('ios-src', `${BASE}models/${type}.usdz`);
  mv.setAttribute('alt', `${spec.label} tree`);
  mv.setAttribute('ar', '');
  mv.setAttribute('ar-modes', 'quick-look scene-viewer webxr');
  mv.setAttribute('ar-scale', 'fixed'); // honour the real metric size
  mv.setAttribute('ar-placement', 'floor');
  mv.setAttribute('camera-controls', '');
  mv.setAttribute('shadow-intensity', '1');
  mv.setAttribute('exposure', '1');
  mv.setAttribute('poster-color', 'transparent');
  mv.style.width = '100%';
  mv.style.height = '320px';

  const arBtn = document.createElement('button');
  arBtn.slot = 'ar-button';
  arBtn.className = 'btn btn--primary mv-ar-btn';
  arBtn.textContent = `View ${spec.label} in your room`;
  mv.appendChild(arBtn);

  stage.appendChild(mv);

  // attempt immediate launch inside the tap gesture; fall back to the button
  return await new Promise<string>((resolve) => {
    let settled = false;
    const done = (msg: string) => {
      if (!settled) {
        settled = true;
        resolve(msg);
      }
    };
    mv.addEventListener(
      'load',
      () => {
        if (mv.canActivateAR) {
          try {
            mv.activateAR();
            done('Launching AR Quick Look…');
          } catch {
            done(`Tap “View ${spec.label} in your room” to place it.`);
          }
        } else {
          done('Drag to preview. AR needs Safari on an ARKit device.');
        }
      },
      { once: true }
    );
    // safety timeout so the UI never hangs on a model that fails to load
    setTimeout(() => done(`Tap “View ${spec.label} in your room” to place it.`), 4000);
  });
}
