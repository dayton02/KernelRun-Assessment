// Data-oriented component definitions (DESIGN.md §2.2).
// Components are plain data. No system logic lives here.

import { Vec2 } from './math.js';

export enum FsmState {
  PATROLLING = 'PATROLLING',
  JUMPING = 'JUMPING',
  LAUNCHED = 'LAUNCHED',
  FALLING = 'FALLING',
  WALL_SLIDING = 'WALL_SLIDING',
}

// --- Agent (the autonomous data packet) ---
export interface Transform { pos: Vec2; prev: Vec2; }
export interface Kinematics { vel: Vec2; acc: Vec2; }
export interface AgentShape { radius: number; }
export interface AgentState {
  fsm: FsmState;
  dir: 1 | -1;          // patrol direction
  grounded: boolean;
  wall: -1 | 0 | 1;     // which side border we cling to
  coyote: number;       // seconds of late-jump grace remaining
  groundEntity: number | null;
  // Local-coordinate grounding: while grounded the ball is pinned to the
  // window via this offset (ball.pos.x = window.x + localOffsetX). The ball's
  // own patrol advances the OFFSET, never ball.vel.x. This removes the runaway
  // velocity-coupling accumulator entirely. (See kinematics/collision rewrite.)
  localOffsetX: number;
}

// --- Window (a platform) ---
export interface WindowRect { x: number; y: number; w: number; h: number; z: number; }
export interface WindowPrev { x: number; y: number; w: number; h: number; }
export interface WindowStyle { title: string; closing: number; hue: number; }
export interface Draggable {
  grabbed: boolean;
  grabDX: number;
  grabDY: number;
  titleBarH: number;
  vx: number;           // smoothed (flick) velocity
  vy: number;
}

// --- Window archetypes (DESIGN.md Part 5) ---------------------------------
// Each window's software role gives it a distinct platforming behavior. The
// `kind` selects which branch the ArchetypeSystem and the collision overrides
// take. `Archetype` carries all per-kind mutable state in one plain struct so
// the ECS store stays data-oriented (unused fields are simply ignored).
export enum WindowKind {
  PLAIN = 'PLAIN',             // the original one-way window
  TERMINAL = 'TERMINAL',       // gravity command runner + text rungs
  MEDIA = 'MEDIA',             // beat-matched oscillating trampoline
  EDITOR = 'EDITOR',           // player-grown surface: width/friction/buoyancy
  BSOD = 'BSOD',               // timed crumbling platform, explosive dismiss
  // --- Kernel Run game roles ---
  SPAWN = 'SPAWN',             // "Download_Manager": emits the packet from a port
  SINK = 'SINK',               // "Backup_Drive (D:)": the goal drop zone
  ALERT = 'ALERT',             // "Temp Alert": 5s countdown, +50% restitution if early
}

/** A horizontal "rung" emitted by a Terminal's command output. */
export interface Rung { localY: number; life: number; w: number; }

export interface Archetype {
  kind: WindowKind;

  // TERMINAL -------------------------------------------------------------
  gravityField: number;        // multiplier applied to local gravity (1 = normal)
  cmdTimer: number;            // seconds until the next auto-command fires
  rungs: Rung[];               // traversable text rungs below the title bar

  // MEDIA ----------------------------------------------------------------
  bpm: number;                 // beats per minute of the track
  phase: number;               // waveform phase accumulator (seconds)
  beatPulse: number;           // 0..1 envelope, peaks on the beat
  baseY: number;               // rest Y; collider oscillates around it
  onBeat: boolean;             // true on the exact frame a beat lands

  // EDITOR ---------------------------------------------------------------
  chars: number;               // "typed" characters -> width
  friction: number;            // 0 (ice) .. 1 (sticky) surface friction
  buoyancy: number;            // upward support force when packet rests (float)

  // BSOD -----------------------------------------------------------------
  crumble: number;             // seconds of integrity remaining (counts down)
  crumbleMax: number;          // starting integrity
  dismissed: boolean;          // set when the player force-closes it

  // ALERT (Temp Alert Modal) --------------------------------------------
  alertTimer: number;          // seconds until auto-close
  alertMax: number;            // starting countdown

  // AUDIO PLAYER pulse (Kernel Run spec: +/-10px every 500ms) -----------
  pulseTimer: number;          // phase within the pulse cycle
  pulseUp: boolean;            // current half of the square pulse

  // Game roles ----------------------------------------------------------
  protectedWin: boolean;       // SPAWN/SINK: cannot be closed/consumed by RAM
}

/** A window entity bundles all of these. */
export interface Win {
  id: number;
  rect: WindowRect;
  prev: WindowPrev;
  style: WindowStyle;
  drag: Draggable;
  arch: Archetype;
}

/** The single agent entity. */
export interface Agent {
  id: number;
  tf: Transform;
  kin: Kinematics;
  shape: AgentShape;
  state: AgentState;
}
