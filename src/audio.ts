// Minimal Web Audio cue layer for Kernel Run.
//
// No samples, no assets: three tiny synthesized voices built from oscillators
// and gain envelopes. The AudioContext is created lazily on the first user
// gesture (browsers suspend audio until then) and all calls no-op safely when
// audio is unavailable (e.g. headless tests).

type Ctx = AudioContext;

let ctx: Ctx | null = null;
let master: GainNode | null = null;
let enabled = true;

/** Create (or resume) the audio context. Safe to call repeatedly. */
export function initAudio(): void {
  if (typeof window === 'undefined') return;
  const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) { enabled = false; return; }
  if (!ctx) {
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.18;          // keep the whole thing gentle
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') void ctx.resume();
}

export function setAudioEnabled(on: boolean): void { enabled = on; }

/** One oscillator note with an exponential decay envelope. */
function note(
  freq: number, dur: number, type: OscillatorType = 'sine',
  startGain = 0.6, slideTo?: number,
): void {
  if (!enabled || !ctx || !master) return;
  const t0 = ctx.currentTime;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (slideTo != null) osc.frequency.exponentialRampToValueAtTime(Math.max(1, slideTo), t0 + dur);
  g.gain.setValueAtTime(startGain, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(master);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

// --- Cue vocabulary --------------------------------------------------------

/** Soft blip when the packet lands on a platform. */
export function cueLand(): void {
  note(220, 0.08, 'triangle', 0.5);
}

/** Ascending chime on a successful launch / trampoline. */
export function cueLaunch(): void {
  note(440, 0.1, 'sine', 0.5, 740);
  note(660, 0.14, 'sine', 0.3, 990);
}

/** Alarm chirp when Data Integrity is lost (fell past the taskbar). */
export function cueIntegrityLoss(): void {
  note(300, 0.16, 'sawtooth', 0.5, 120);
  note(150, 0.2, 'square', 0.3);
}

/** Bright triad when the packet reaches the Backup_Drive sink (win). */
export function cueWin(): void {
  if (!ctx) return;
  [523, 659, 784, 1047].forEach((f, i) => {
    window.setTimeout(() => note(f, 0.22, 'sine', 0.5), i * 90);
  });
}

/** Low thud when the packet dissolves (integrity hit zero). */
export function cueDissolve(): void {
  note(110, 0.4, 'sawtooth', 0.5, 40);
}

/** Short skid/slip chirp when the packet loses footing on a ferried window. */
export function cueSlip(): void {
  note(520, 0.09, 'sawtooth', 0.4, 240);
}

/** Harsh sweep when an emergency GC sweep closes the auxiliary windows. */
export function cueGcSweep(): void {
  note(900, 0.25, 'square', 0.4, 90);
  note(300, 0.3, 'sawtooth', 0.3, 60);
}

/** Mechanical "boing" when a window spring-pops the packet (click-to-spring). */
export function cueSpring(): void {
  note(300, 0.12, 'square', 0.45, 680);
}

/** Rubbery bounce off the marquee safety net. */
export function cueNet(): void {
  note(240, 0.14, 'sine', 0.5, 520);
  note(480, 0.1, 'triangle', 0.25);
}

/** Retro bitmap "dissolve" blip when a window auto-recycles. */
export function cueRecycle(): void {
  note(620, 0.1, 'square', 0.3, 180);
}

/** Rising delivery chord (streak-scaled pitch handled by caller via semitones). */
export function cueDeliverChord(semitoneBoost = 0): void {
  const base = 523 * Math.pow(2, semitoneBoost / 12);
  [0, 4, 7, 12].forEach((st, i) => {
    if (typeof window === 'undefined') return;
    window.setTimeout(() => note(base * Math.pow(2, st / 12), 0.26, 'sine', 0.5), i * 70);
  });
}
