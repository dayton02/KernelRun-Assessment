// Window archetypes (DESIGN.md Part 5).
//
// Two entry points:
//   archetypeSystem(world, dt)  — stage 2.5 of the pipeline: advances each
//                                 window's per-kind timers, colliders, and
//                                 fields BEFORE kinematics/collision read them.
//   archetypeCollision(...)     — per-kind override invoked by CollisionSystem
//                                 when the packet contacts a window's title bar.
//
// Design rule: an archetype only ever mutates its own `arch` data plus the
// window rect it owns, and returns a small "collision effect" describing how
// the packet should respond. The core CollisionSystem stays generic.

import { ARCH, CONFIG, GAME } from './config.js';
import { FsmState, Win, WindowKind } from './components.js';
import { World } from './world.js';
import { clamp } from './math.js';

// ---------------------------------------------------------------------------
// Pipeline stage 2.5 — per-frame archetype update.
// ---------------------------------------------------------------------------
export function archetypeSystem(world: World, dt: number): void {
  for (const w of world.windows) {
    switch (w.arch.kind) {
      case WindowKind.TERMINAL: updateTerminal(w, dt); break;
      case WindowKind.MEDIA: updateMedia(w, dt); break;
      case WindowKind.EDITOR: updateEditor(world, w, dt); break;
      case WindowKind.BSOD: updateBsod(w, dt); break;
      case WindowKind.ALERT: updateAlert(w, dt); break;
      default: break;
    }
  }
}

// === 1. TERMINAL ===========================================================
// A shell that periodically "runs a command". Commands do one of two things:
//  - setgravity {low|high}: changes the LOCAL gravity field above the window
//  - echo <bar>: emits a horizontal text rung the packet can stand on
// Rungs decay over time (disappearing sub-platforms). Gravity field only
// applies while the packet is within fieldRadius above the title bar.
function updateTerminal(w: Win, dt: number): void {
  const t = ARCH.terminal;
  w.arch.cmdTimer -= dt;
  if (w.arch.cmdTimer <= 0) {
    w.arch.cmdTimer = t.cmdInterval;
    // deterministic rotation of commands keyed off the window id for variety
    const seq = (w.id + Math.floor(w.arch.phase)) % 3;
    w.arch.phase += 1;
    if (seq === 0) {
      w.arch.gravityField = t.gravityLo;        // "setgravity low"
    } else if (seq === 1) {
      w.arch.gravityField = t.gravityHi;        // "setgravity high"
    } else {
      // "echo ====": push a new rung, stack them downward
      const localY = w.drag.titleBarH + t.rungSpacing * (w.arch.rungs.length + 1);
      w.arch.rungs.push({ localY, life: t.rungLife, w: w.rect.w * 0.7 });
      if (w.arch.rungs.length > t.maxRungs) w.arch.rungs.shift();
    }
  }
  // age rungs
  for (const r of w.arch.rungs) r.life -= dt;
  w.arch.rungs = w.arch.rungs.filter((r) => r.life > 0);
}

// === 2. MEDIA ==============================================================
// The title-bar collider oscillates vertically with the track's waveform.
// On each beat the collider snaps upward; a packet resting on it at that moment
// gets a beat-matched launch. Timing accuracy scales the restitution.
// Kernel Run spec: the Audio Player pulses its top edge by +/-10px every
// 500ms — a predictable, auto-timed bouncing ledge. We drive a square pulse
// off `pulseTimer` and ALSO keep a smooth `beatPulse` envelope purely for the
// visualizer bars. The pulse is the collider; the beat is just decoration.
function updateMedia(w: Win, dt: number): void {
  const m = ARCH.media;
  const p = GAME.pulse;

  // --- the ±10px/500ms square pulse that defines the collider position ---
  w.arch.pulseTimer += dt;
  if (w.arch.pulseTimer >= p.halfPeriod) {
    w.arch.pulseTimer -= p.halfPeriod;
    w.arch.pulseUp = !w.arch.pulseUp;          // toggle every 500ms
  }
  const pulseOffset = w.arch.pulseUp ? -p.amplitude : p.amplitude;

  // --- smooth beat envelope for the visualizer only ---
  const beatPeriod = 60 / w.arch.bpm;
  const prevPhase = w.arch.phase;
  w.arch.phase += dt;
  const prevBeat = Math.floor(prevPhase / beatPeriod);
  const nowBeat = Math.floor(w.arch.phase / beatPeriod);
  w.arch.onBeat = nowBeat !== prevBeat;
  const intoBeat = (w.arch.phase % beatPeriod) / beatPeriod;
  w.arch.beatPulse = Math.pow(1 - intoBeat, 2);

  // apply the pulse to the collider's top edge around its rest Y
  if (!w.drag.grabbed) {
    w.rect.y = w.arch.baseY + pulseOffset;     // auto-timed bouncing ledge
  } else {
    w.arch.baseY = w.rect.y - pulseOffset;     // player drag retargets rest Y
  }
  void m;
}

// === 5. ALERT (Temp Alert Modal) ==========================================
// Kernel Run spec: an internal 5s countdown before it auto-closes. Flicking it
// upward BEFORE expiry grants +50% launch restitution (earlyRestitution). Once
// the timer runs out it closes (disappearing platform) via the standard path.
function updateAlert(w: Win, dt: number): void {
  w.arch.alertTimer -= dt;
  if (w.arch.alertTimer <= 0 && w.style.closing === 0) {
    w.style.closing = 0.0001;   // auto-close -> fades out, platform vanishes
  }
}

// === 3. EDITOR / STICKY NOTE ==============================================
// The player grows content by grabbing the note (acts as "typing"). More
// characters -> wider surface, stickier friction, and eventually buoyancy so
// the note floats the packet upward like a raft. Deleting (not grabbed) lets
// content slowly evaporate, shrinking the surface back down.
function updateEditor(world: World, w: Win, dt: number): void {
  const e = ARCH.editor;
  const typing = w.drag.grabbed && world.pointer.down;

  if (typing) {
    w.arch.chars = clamp(w.arch.chars + e.charsPerSecTyping * dt, e.minChars, e.maxChars);
  } else {
    // idle evaporation, much slower than typing
    w.arch.chars = clamp(w.arch.chars - e.charsPerSecTyping * 0.15 * dt, e.minChars, e.maxChars);
  }

  // width follows character count (anchored on the left edge)
  w.rect.w = e.widthPerChar * w.arch.chars + 60;

  // friction scales from ice (empty) to sticky (full)
  const fill = (w.arch.chars - e.minChars) / (e.maxChars - e.minChars);
  w.arch.friction = e.frictionEmpty + (e.frictionFull - e.frictionEmpty) * fill;

  // buoyancy kicks in only past the threshold
  w.arch.buoyancy = w.arch.chars > e.buoyancyThreshold
    ? e.buoyancyMax * ((w.arch.chars - e.buoyancyThreshold) / (e.maxChars - e.buoyancyThreshold))
    : 0;
}

// === 4. BSOD / ERROR MODAL =================================================
// A crumbling platform on a hard timer. Integrity counts down whether or not
// the packet stands on it; standing on it accelerates the decay. At zero it
// despawns (floor drops out). Force-closing it early (the dismiss) converts the
// stored integrity into an explosive launch — high risk, high reward.
function updateBsod(w: Win, dt: number): void {
  const b = ARCH.bsod;
  // passive decay; accelerated decay (when stood on) is applied in collision.
  w.arch.crumble -= dt;
  if (w.arch.crumble <= 0 && !w.arch.dismissed) {
    // collapse: becomes non-solid and fades out via the standard closing path
    w.style.closing = Math.max(w.style.closing, 0.0001);
  }
  void b;
}

// ---------------------------------------------------------------------------
// Collision override result. CollisionSystem applies these to the packet.
// ---------------------------------------------------------------------------
export interface ContactEffect {
  // vertical velocity to impose (px/s, negative = up). undefined => default snap.
  launchVy?: number;
  // horizontal velocity to impose/add.
  kickVx?: number;
  // multiplier applied to the inherited patrol friction (1 = normal).
  frictionScale?: number;
  // extra upward acceleration while grounded (buoyancy), px/s^2.
  support?: number;
  // if true, the packet should NOT be grounded (platform is non-solid now).
  passThrough?: boolean;
  // force the packet into LAUNCHED state.
  forceLaunch?: boolean;
}

/**
 * Per-archetype response when the packet lands on / rests on window `w`.
 * Called by CollisionSystem after it has confirmed top-edge contact.
 */
export function archetypeContact(world: World, w: Win, dt: number): ContactEffect {
  switch (w.arch.kind) {
    case WindowKind.MEDIA: return mediaContact(w);
    case WindowKind.EDITOR: return editorContact(w);
    case WindowKind.BSOD: return bsodContact(w, dt);
    case WindowKind.TERMINAL: return terminalContact(world, w);
    default: return {};
  }
}

function mediaContact(w: Win): ContactEffect {
  const p = GAME.pulse;
  // Auto-timed bounce: if the packet lands while the ledge is in its UP half
  // of the pulse (rising/raised), it gets a reliable moderate bounce. This is
  // the "auto-timed bouncing ledge" from the Kernel Run spec — no flick needed.
  if (w.arch.pulseUp) {
    const speed = CONFIG.edgeJumpImpulse * p.bounceBonus;
    return { launchVy: -clamp(speed, 0, CONFIG.launchMax), forceLaunch: true };
  }
  return {};
}

function editorContact(w: Win): ContactEffect {
  // sticky/icy footing + optional buoyant float
  return {
    frictionScale: w.arch.friction,
    support: w.arch.buoyancy,
  };
}

function bsodContact(w: Win, dt: number): ContactEffect {
  // standing on it accelerates the crumble (3x passive rate)
  w.arch.crumble -= dt * 2;
  if (w.arch.crumble <= 0) return { passThrough: true };
  return {};
}

function terminalContact(world: World, w: Win): ContactEffect {
  // gravity field is applied in kinematics; nothing special on contact itself
  void world; void w;
  return {};
}

/**
 * Local-gravity override for Terminal windows. Returns the gravity multiplier
 * the packet should feel given its position, or 1 if no field applies.
 * Called by KinematicsSystem (DESIGN.md §5.1).
 */
export function localGravityMultiplier(world: World): number {
  const a = world.agent;
  const t = ARCH.terminal;
  let mult = 1;
  for (const w of world.windows) {
    if (w.arch.kind !== WindowKind.TERMINAL || w.style.closing > 0) continue;
    const withinX = a.tf.pos.x >= w.rect.x && a.tf.pos.x <= w.rect.x + w.rect.w;
    const above = a.tf.pos.y < w.rect.y && a.tf.pos.y > w.rect.y - t.fieldRadius * 4;
    if (withinX && above) mult = w.arch.gravityField; // last/topmost wins
  }
  return mult;
}

/**
 * Terminal text rungs act as thin one-way sub-platforms. Returns the world-Y
 * of a rung the packet is landing on, or null. Called by CollisionSystem.
 */
export function terminalRungContact(w: Win, feetPrev: number, feetNow: number, x: number): number | null {
  if (w.arch.kind !== WindowKind.TERMINAL) return null;
  const t = ARCH.terminal;
  const withinX = x >= w.rect.x + w.rect.w * 0.15 && x <= w.rect.x + w.rect.w * 0.85;
  if (!withinX) return null;
  for (const r of w.arch.rungs) {
    const rungY = w.rect.y + r.localY;
    const crossed = feetPrev <= rungY && feetNow >= rungY;
    if (crossed) return rungY;
  }
  void t;
  return null;
}

/**
 * Explosive dismissal of a BSOD modal (player clicked close). Converts the
 * remaining integrity into a launch vector aimed away from the dismiss point.
 */
export function bsodDismiss(world: World, w: Win, clickX: number): void {
  const b = ARCH.bsod;
  w.arch.dismissed = true;
  w.style.closing = 0.0001;
  const a = world.agent;
  // only launch the packet if it is on/near the modal
  const near = a.tf.pos.x >= w.rect.x - 20 && a.tf.pos.x <= w.rect.x + w.rect.w + 20
    && a.tf.pos.y <= w.rect.y + w.rect.h && a.tf.pos.y >= w.rect.y - 40;
  if (!near) return;
  const intensity = clamp(w.arch.crumble / w.arch.crumbleMax, 0.2, 1);
  a.kin.vel.y = -b.dismissLaunch * intensity;
  const side = a.tf.pos.x < clickX ? -1 : 1;
  a.kin.vel.x = side * b.dismissSpreadX * intensity;
  a.state.fsm = FsmState.LAUNCHED;
  a.state.grounded = false;
  a.state.groundEntity = null;
}
