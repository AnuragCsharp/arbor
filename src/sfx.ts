/**
 * Procedural sound effects via the Web Audio API — no audio files, works
 * offline on every device. All generators are no-ops until audio is unlocked
 * by a user gesture (mobile autoplay policy), and are guarded so importing this
 * module never throws in a non-browser context (tests).
 */

type Ctx = AudioContext;

let ctx: Ctx | null = null;
let master: GainNode | null = null;
let enabled = false;

function AudioCtor(): (new () => AudioContext) | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { AudioContext?: new () => AudioContext; webkitAudioContext?: new () => AudioContext };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

/** Call inside a user gesture (tap) to create/resume the audio graph. */
export function unlockAudio(): void {
  const Ctor = AudioCtor();
  if (!Ctor) return;
  if (!ctx) {
    ctx = new Ctor();
    master = ctx.createGain();
    master.gain.value = 0.5;
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') void ctx.resume();
  enabled = true;
}

export function audioReady(): boolean {
  return enabled && !!ctx && ctx.state === 'running';
}

function now(): number {
  return ctx ? ctx.currentTime : 0;
}

function tone(
  type: OscillatorType,
  f0: number,
  f1: number,
  dur: number,
  peak: number,
  dest?: AudioNode
): void {
  if (!ctx || !master) return;
  const t = now();
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(f0, t);
  osc.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g);
  g.connect(dest ?? master);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

function noise(dur: number, peak: number, lpFrom: number, lpTo: number): void {
  if (!ctx || !master) return;
  const t = now();
  const frames = Math.floor(ctx.sampleRate * dur);
  const buffer = ctx.createBuffer(1, frames, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < frames; i++) data[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.setValueAtTime(lpFrom, t);
  lp.frequency.exponentialRampToValueAtTime(Math.max(60, lpTo), t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(peak, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(lp);
  lp.connect(g);
  g.connect(master);
  src.start(t);
  src.stop(t + dur + 0.02);
}

/** bright descending "pew" when the player fires. */
export function sfxLaser(): void {
  if (!audioReady()) return;
  tone('square', 1400, 240, 0.18, 0.28);
  tone('sawtooth', 2200, 600, 0.12, 0.08);
}

/** dull wooden chop when an enemy strikes a tree. */
export function sfxChop(): void {
  if (!audioReady()) return;
  noise(0.1, 0.5, 2600, 400);
  tone('triangle', 180, 90, 0.12, 0.22);
}

/** crunchy burst when an enemy is destroyed. */
export function sfxExplosion(): void {
  if (!audioReady()) return;
  noise(0.32, 0.6, 3200, 120);
  tone('sawtooth', 320, 70, 0.3, 0.2);
}

/** low timber-fall thud when a tree is cut down. */
export function sfxTreeDown(): void {
  if (!audioReady()) return;
  tone('sine', 200, 55, 0.6, 0.35);
  noise(0.4, 0.3, 1200, 200);
}

/** two-note descent on game over. */
export function sfxGameOver(): void {
  if (!audioReady()) return;
  tone('sawtooth', 440, 330, 0.25, 0.25);
  tone('sawtooth', 300, 160, 0.5, 0.25);
}

/** short confirmation blip when a tree is planted. */
export function sfxPlant(): void {
  if (!audioReady()) return;
  tone('sine', 520, 820, 0.12, 0.18);
}

export const sfx = {
  laser: sfxLaser,
  chop: sfxChop,
  explosion: sfxExplosion,
  treeDown: sfxTreeDown,
  gameOver: sfxGameOver,
  plant: sfxPlant,
};
export type Sfx = typeof sfx;
