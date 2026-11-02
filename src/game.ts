// Kernel Run — the game loop layered on top of the stable physics ECS.
//
// Responsibilities (all data-driven, no changes to the local-coordinate
// grounding fix in systems.ts):
//   - objective: deliver the packet from the SPAWN window to the SINK drop zone
//   - fail: falling past the taskbar costs Data Integrity; 0% => dissolve+reset
//   - resource: Memory Usage (RAM) scales with open window area/count
//   - win: packet overlaps the sink drop zone -> celebrate -> reset level
//
// gameSystem(world, g, dt) runs AFTER the physics step each frame.

import { GAME, CONFIG, FLOW } from './config.js';
import { WindowKind, Win } from './components.js';
import { World } from './world.js';
import { cueIntegrityLoss, cueDissolve, cueGcSweep, cueRecycle, cueDeliverChord } from './audio.js';
import { launchTracker } from './systems.js';

export enum GamePhase { PLAYING = 'PLAYING', WON = 'WON', DISSOLVING = 'DISSOLVING' }

export interface GameState {
  phase: GamePhase;
  integrity: number;      // Data Integrity %
  ram: number;            // Memory Usage % (recomputed each frame)
  spawnId: number | null; // Download_Manager window id
  sinkId: number | null;  // Backup_Drive (D:) window id
  freeze: number;         // seconds remaining in a win/loss celebration
  leakedRam: number;      // accumulated leak (Part 7); recovered on GC/close
  message: string;        // transient HUD banner
  messageTtl: number;
  wins: number;
  resets: number;
  gcSweeps: number;       // count of emergency GC events
  // --- Part 8 arcade pacing ---
  streak: number;         // delivery streak multiplier (1..streakMax)
  combo: number;          // leapfrog recycle combo (resets when the window lapses)
  comboTtl: number;       // seconds left to chain the next recycle
  speedMul: number;       // patrol-speed difficulty ramp (1 = base)
  shake: number;          // current screen-shake amplitude (px)
}

export function makeGameState(): GameState {
  return {
    phase: GamePhase.PLAYING,
    integrity: GAME.integrityStart,
    ram: 0,
    leakedRam: 0,
    spawnId: null,
    sinkId: null,
    freeze: 0,
    message: '',
    messageTtl: 0,
    wins: 0,
    resets: 0,
    gcSweeps: 0,
    streak: 1,
    combo: 0,
    comboTtl: 0,
    speedMul: 1,
    shake: 0,
  };
}

const SINK_W = 200;
const SINK_H = 150;

/**
 * Pick a random landing spot for the sink. It always sits on the RIGHT side of
 * the firewall (so the flick-across-the-firewall challenge is preserved) and is
 * anchored to one of three edges — top-right, right-middle, or bottom-right —
 * so the player must re-aim the flick after every delivery.
 */
export function randomSinkPosition(world: World): { x: number; y: number } {
  const barR = world.firewallX + world.firewallW / 2;
  const minX = barR + 30;
  const maxX = world.width - SINK_W - 10;
  const topMin = 70;                                   // below the HUD
  const botMax = world.height - GAME.taskbarH - SINK_H - 10;

  const x = minX + Math.random() * Math.max(0, maxX - minX);
  // bias toward the three edges for variety, clamp into the legal band
  const edge = Math.floor(Math.random() * 3);
  let y: number;
  if (edge === 0) y = topMin;                          // top-right
  else if (edge === 1) y = (topMin + botMax) / 2;      // right-middle
  else y = botMax;                                     // bottom-right
  y = Math.max(topMin, Math.min(botMax, y));
  return { x: Math.max(minX, Math.min(maxX, x)), y };
}

/** Relocate the existing sink to a fresh random edge (after a delivery). */
export function relocateSink(world: World, g: GameState): void {
  const sink = world.windows.find((w) => w.id === g.sinkId);
  if (!sink) return;
  const pos = randomSinkPosition(world);
  sink.rect.x = pos.x; sink.rect.y = pos.y;
  sink.prev.x = pos.x; sink.prev.y = pos.y;   // no phantom velocity from the jump
}

/** Build the level: spawn + sink + a few starter platforms. Idempotent-ish:
 *  it clears existing windows and reseeds. */
export function buildLevel(world: World, g: GameState): void {
  world.windows = [];

  // SPAWN — Download_Manager, top-left, emits the packet from its "port"
  const spawn = world.spawnWindow(40, 110, 190, 96, 'Download_Manager', 205, WindowKind.SPAWN);
  g.spawnId = spawn.id;

  // SINK — Backup_Drive (D:), at a random right-side edge, with an active drop
  // zone (the body). Immovable, and relocated after every delivery.
  const pos = randomSinkPosition(world);
  const sink = world.spawnWindow(pos.x, pos.y, SINK_W, SINK_H, 'Backup_Drive (D:)', 135, WindowKind.SINK);
  g.sinkId = sink.id;

  // starter platforms the player can rearrange (all RAM-costing)
  world.spawnWindow(300, 250, 170, 110, 'bash', 150, WindowKind.TERMINAL);
  world.spawnWindow(520, 320, 150, 110, 'player.fm', 320, WindowKind.MEDIA);
  world.spawnWindow(250, 430, 160, 100, 'Temp Alert', 35, WindowKind.ALERT);

  placePacketAtSpawn(world, g);
  g.phase = GamePhase.PLAYING;
  g.integrity = GAME.integrityStart;
  g.leakedRam = 0;
}

/** Count of open auxiliary (non-protected, non-closing) windows. */
export function auxWindowCount(world: World): number {
  let n = 0;
  for (const w of world.windows) {
    if (w.style.closing > 0 || w.arch.protectedWin) continue;
    n++;
  }
  return n;
}

/** Position the packet at the spawn window's emit port and reset its state. */
export function placePacketAtSpawn(world: World, g: GameState): void {
  const spawn = world.windows.find((w) => w.id === g.spawnId);
  const a = world.agent;
  const px = spawn ? spawn.rect.x + spawn.rect.w - 24 : world.width * 0.1;
  const py = spawn ? spawn.rect.y - a.shape.radius : 80;
  a.tf.pos.x = px; a.tf.pos.y = py;
  a.tf.prev.x = px; a.tf.prev.y = py;
  a.kin.vel.x = CONFIG.patrolSpeed; a.kin.vel.y = 0;
  a.state.grounded = false;
  a.state.groundEntity = null;
  a.state.localOffsetX = 0;
  a.state.dir = 1;
  a.state.spawnDwell = 0;
}

/** Recompute Memory Usage from the open (non-closing, non-protected) windows. */
/** Base RAM allocation from the currently-open auxiliary windows. This is the
 *  part recovered INSTANTLY when a window is closed (it stops being counted). */
export function baseRam(world: World): number {
  let ram = 0;
  for (const w of world.windows) {
    if (w.style.closing > 0) continue;
    if (w.arch.protectedWin) continue;   // spawn/sink are system-reserved, free
    ram += GAME.ramPerWindow + w.rect.w * w.rect.h * GAME.ramPerArea;
  }
  return ram;
}

/** Total Memory Usage = base allocation + leak + any held marquee, clamped. */
export function totalRam(world: World, g: GameState): number {
  const marqueeCost = world.marquee.active ? FLOW.marquee.ramCost : 0;
  return Math.min(GAME.ramMax, baseRam(world) + g.leakedRam + marqueeCost);
}

/** Back-compat alias (older callers/tests). */
export function computeRam(world: World): number {
  return baseRam(world);
}

/** True if a new window may be spawned given the current RAM budget. */
export function canSpawn(world: World, g?: GameState): boolean {
  const used = g ? totalRam(world, g) : baseRam(world);
  return used < GAME.ramSpawnBlock;
}

/**
 * Emergency GC sweep (Part 7): at 100% RAM, force-close every auxiliary window
 * and drop the packet (whether grounded or airborne). Recovers all base+leak.
 */
export function emergencyGc(world: World, g: GameState): void {
  for (const w of world.windows) {
    if (w.arch.protectedWin) continue;
    if (w.style.closing === 0) w.style.closing = 0.0001; // begin fade-out
  }
  // drop the packet: if it was riding/standing on anything, it loses footing.
  const a = world.agent;
  a.state.grounded = false;
  a.state.groundEntity = null;
  g.leakedRam = 0;             // leak reclaimed by the sweep
  g.gcSweeps++;
  banner(g, '⚠ OUT OF MEMORY — GC SWEEP', 1.4);
  cueGcSweep();
}

function banner(g: GameState, msg: string, ttl = 1.6): void {
  g.message = msg; g.messageTtl = ttl;
}

/** Immutable base patrol speed; the difficulty ramp scales this into CONFIG. */
const BASE_PATROL = CONFIG.patrolSpeed;

/**
 * Leapfrog Auto-Recycle (Part 8): when the packet has launched from window A
 * and landed elsewhere, mark A for decommissioning (a 2s pulse), then dissolve
 * it, refund its RAM, and award a combo. Replaces hunting for tiny [X] boxes.
 */
function processRecycle(world: World, g: GameState, dt: number): void {
  // trigger: physics flagged that we landed on a different window than launch
  if (launchTracker.landedElsewhere && launchTracker.lastLaunchWin != null) {
    const src = world.windows.find((w) => w.id === launchTracker.lastLaunchWin);
    if (src && !src.arch.protectedWin && src.drag.recycleTimer === 0 && src.style.closing === 0) {
      src.drag.recycleTimer = FLOW.recycle.decommission;   // begin the pulse
    }
    launchTracker.landedElsewhere = false;
    launchTracker.lastLaunchWin = null;
  }

  // advance decommission pulses; dissolve + reward when they elapse
  if (g.comboTtl > 0) { g.comboTtl -= dt; if (g.comboTtl <= 0) g.combo = 0; }
  for (const w of world.windows) {
    if (w.drag.recycleTimer > 0) {
      w.drag.recycleTimer -= dt;
      if (w.drag.recycleTimer <= 0 && w.style.closing === 0) {
        w.style.closing = 0.0001;                 // retro fade-out (render handles look)
        g.leakedRam = Math.max(0, g.leakedRam - GAME.ramPerWindow); // RAM refund
        g.combo = Math.min(FLOW.recycle.comboMax, g.combo + 1);
        g.comboTtl = FLOW.recycle.comboWindow;
        cueRecycle();
      }
    }
  }
}

/** The game system: run once per frame AFTER the physics step. */
export function gameSystem(world: World, g: GameState, dt: number): void {
  if (g.messageTtl > 0) g.messageTtl -= dt;

  // difficulty ramp: scale patrol speed by the delivery count (Part 8)
  CONFIG.patrolSpeed = BASE_PATROL * g.speedMul;

  // screen-shake decay
  if (g.shake > 0) g.shake = Math.max(0, g.shake - FLOW.pacing.shakeDecay * dt);

  // leapfrog auto-recycle + combo meter
  processRecycle(world, g, dt);

  // --- LIVE MEMORY LEAK (Part 7) ---------------------------------------
  // Each open auxiliary window leaks RAM continuously. Closing windows lowers
  // the open count (and drops base RAM instantly), slowing the leak.
  const openCount = auxWindowCount(world);
  g.leakedRam += GAME.ramLeakPerWindow * openCount * dt;
  g.ram = totalRam(world, g);

  // --- EMERGENCY GC at 100% --------------------------------------------
  if (g.ram >= GAME.ramMax && openCount > 0) {
    emergencyGc(world, g);
    g.ram = totalRam(world, g);   // recomputed after the sweep
  }

  // celebration / reset freeze
  if (g.phase !== GamePhase.PLAYING) {
    g.freeze -= dt;
    if (g.freeze <= 0) {
      if (g.phase === GamePhase.DISSOLVING) { g.resets++; placePacketAtSpawn(world, g); }
      if (g.phase === GamePhase.WON) {
        g.wins++;
        // Relocate the goal to a fresh random edge and re-emit the packet.
        // The player's platform layout and integrity carry over, so a
        // delivery flows straight into the next run with a new target.
        relocateSink(world, g);
        placePacketAtSpawn(world, g);
      }
      g.phase = GamePhase.PLAYING;
    }
    return; // packet is frozen during celebration
  }

  const a = world.agent;

  // --- WIN: packet enters the sink drop zone ---
  const sink = world.windows.find((w) => w.id === g.sinkId);
  if (sink && overlapsDropZone(a.tf.pos.x, a.tf.pos.y, a.shape.radius, sink)) {
    g.phase = GamePhase.WON;
    g.freeze = GAME.winFreeze;
    // arcade pacing: bump streak (1..max), ramp difficulty, shake + chord
    g.streak = Math.min(FLOW.pacing.streakMax, g.streak + 1);
    g.speedMul = Math.min(FLOW.pacing.speedupMax, g.speedMul * (1 + FLOW.pacing.speedupPerWin));
    g.shake = FLOW.pacing.shakeOnWin;
    banner(g, `PACKET DELIVERED ✓  ${g.streak}x`, GAME.winFreeze);
    cueDeliverChord((g.streak - 1) * 2);   // higher chord as the streak climbs
    return;
  }

  // --- FAIL: fell past the taskbar (bottom kill line) ---
  const killY = world.height - GAME.taskbarH;
  if (a.tf.pos.y - a.shape.radius > killY) {
    g.integrity -= GAME.integrityPenalty;
    g.streak = 1;                          // integrity loss breaks the streak
    if (g.integrity <= 0) {
      g.integrity = 0;
      g.phase = GamePhase.DISSOLVING;
      g.freeze = 0.9;
      banner(g, 'PACKET DISSOLVED — restarting', 0.9);
      cueDissolve();
    } else {
      banner(g, `DATA INTEGRITY ${g.integrity}%`, 1.2);
      cueIntegrityLoss();
      placePacketAtSpawn(world, g);
    }
  }
}

/**
 * Trajectory preview: if a window is being dragged fast enough upward to
 * trigger a flick launch, predict where the packet would go and return sample
 * points for the dotted arc. Returns [] when no launch would occur.
 *
 * This mirrors the launch math in systems.tryLaunch (window.vy * restitution)
 * and then integrates a simple ballistic arc under gravity — a preview, so it
 * ignores mid-air collisions on purpose.
 */
export function predictFlickArc(world: World): { x: number; y: number }[] {
  const a = world.agent;
  // only meaningful while grounded on a draggable window being flicked up
  if (!a.state.grounded || a.state.groundEntity == null) return [];
  const gw = world.windows.find((w) => w.id === a.state.groundEntity);
  if (!gw || !gw.drag.grabbed) return [];

  const vy = gw.drag.vy;
  if (vy >= -CONFIG.flickThreshold) return []; // not a launch-grade flick yet

  // restitution incl. Temp Alert early bonus (matches systems.tryLaunch)
  let e = CONFIG.restitution;
  if (gw.arch.kind === WindowKind.ALERT && gw.arch.alertTimer > 0) e *= GAME.alert.earlyRestitution;

  const launchVy = Math.max(-CONFIG.launchMax, vy * e);
  const launchVx = clampNum(gw.drag.vx * CONFIG.detachDamping, -CONFIG.detachMaxVx, CONFIG.detachMaxVx)
    + a.state.dir * CONFIG.patrolSpeed;

  const pts: { x: number; y: number }[] = [];
  let px = a.tf.pos.x, py = a.tf.pos.y;
  let pvx = launchVx, pvy = launchVy;
  const dt = CONFIG.dt * 4; // coarse preview steps
  for (let i = 0; i < 28; i++) {
    pvy += CONFIG.gravity * dt;
    px += pvx * dt;
    py += pvy * dt;
    if (py > world.height || px < 0 || px > world.width) break;
    if (i % 2 === 0) pts.push({ x: px, y: py });
  }
  return pts;
}

function clampNum(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** The sink's body (below its title bar) is the active drop zone. */
export function overlapsDropZone(x: number, y: number, r: number, sink: Win): boolean {
  const zx = sink.rect.x;
  const zy = sink.rect.y + sink.drag.titleBarH;
  const zw = sink.rect.w;
  const zh = sink.rect.h - sink.drag.titleBarH;
  return x + r > zx && x - r < zx + zw && y + r > zy && y - r < zy + zh;
}
