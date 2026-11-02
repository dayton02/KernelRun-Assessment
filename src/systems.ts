// Systems run in the fixed order described in DESIGN.md §2.4:
//   1 InputSystem  2 WindowSystem  3 AgentIntentSystem
//   4 KinematicsSystem  5 CollisionSystem  6 PostFsmSystem
// (RenderSystem lives in render.ts and is not part of the fixed step.)

import { CONFIG } from './config.js';
import { FsmState, Win, WindowKind } from './components.js';
import { World } from './world.js';
import { aabbContainsX, clamp, perp, sweptCircleAABB, Vec2 } from './math.js';
import {
  archetypeSystem, archetypeContact, localGravityMultiplier,
  terminalRungContact, bsodDismiss, ContactEffect,
} from './archetypes.js';

// ---------------------------------------------------------------------------
// 1. InputSystem — translate pointer edges into window grab/close intent.
// ---------------------------------------------------------------------------
export function inputSystem(world: World): void {
  const p = world.pointer;

  if (p.pressed) {
    const win = world.topWindowAt(p.x, p.y);
    if (win) {
      // Close box lives at the right end of the title bar.
      const closeX = win.rect.x + win.rect.w - 20;
      if (p.x >= closeX && p.y <= win.rect.y + win.drag.titleBarH) {
        if (win.arch.kind === WindowKind.BSOD) {
          bsodDismiss(world, win, p.x);   // explosive dismissal (§5.4)
        } else {
          win.style.closing = 0.0001;     // begin fade -> disappearing platform
        }
      } else {
        win.drag.grabbed = true;
        win.drag.grabDX = p.x - win.rect.x;
        win.drag.grabDY = p.y - win.rect.y;
        world.bringToFront(win);
      }
    }
  }

  if (p.released) {
    for (const w of world.windows) w.drag.grabbed = false;
  }
}

// ---------------------------------------------------------------------------
// 2. WindowSystem — apply drag, derive per-window velocity, advance closing.
// ---------------------------------------------------------------------------
export function windowSystem(world: World, dt: number): void {
  const p = world.pointer;

  for (const w of world.windows) {
    // snapshot previous rect BEFORE mutating (used for finite-difference vel)
    const px = w.rect.x;
    const py = w.rect.y;

    if (w.drag.grabbed) {
      w.rect.x = p.x - w.drag.grabDX;
      w.rect.y = p.y - w.drag.grabDY;
    }

    // instantaneous velocity from finite difference, then EMA smoothing (§3.1)
    const instVx = (w.rect.x - px) / dt;
    const instVy = (w.rect.y - py) / dt;
    const a = CONFIG.flickAlpha;
    w.drag.vx = a * instVx + (1 - a) * w.drag.vx;
    w.drag.vy = a * instVy + (1 - a) * w.drag.vy;

    w.prev.x = px; w.prev.y = py; w.prev.w = w.rect.w; w.prev.h = w.rect.h;

    // disappearing platform: fade then despawn
    if (w.style.closing > 0) w.style.closing += dt;
  }

  world.windows = world.windows.filter((w) => w.style.closing < 0.35);
}

// ---------------------------------------------------------------------------
// 3. AgentIntentSystem — FSM transitions that depend only on state/timers.
// ---------------------------------------------------------------------------
export function agentIntentSystem(world: World, dt: number): void {
  const a = world.agent;
  const s = a.state;

  if (s.coyote > 0) s.coyote -= dt;

  if (s.fsm === FsmState.PATROLLING && s.grounded && s.groundEntity != null) {
    const gw = world.windows.find((w) => w.id === s.groundEntity);
    if (gw) {
      // Patrol along the title bar; flip and leap at the edges.
      const left = gw.rect.x + a.shape.radius;
      const right = gw.rect.x + gw.rect.w - a.shape.radius;
      if (a.tf.pos.x <= left) { s.dir = 1; edgeLeap(world); }
      else if (a.tf.pos.x >= right) { s.dir = -1; edgeLeap(world); }
    }
  }
}

function edgeLeap(world: World): void {
  const a = world.agent;
  a.kin.vel.y = -CONFIG.edgeJumpImpulse;
  a.kin.vel.x = world.agent.state.dir * CONFIG.patrolSpeed * 1.4;
  a.state.fsm = FsmState.JUMPING;
  a.state.grounded = false;
  a.state.groundEntity = null;
}

// ---------------------------------------------------------------------------
// 4. KinematicsSystem — semi-implicit Euler (DESIGN.md Part 3 preamble).
// ---------------------------------------------------------------------------
export function kinematicsSystem(world: World, dt: number): void {
  const a = world.agent;
  a.tf.prev.x = a.tf.pos.x;
  a.tf.prev.y = a.tf.pos.y;

  a.kin.acc.x = 0;
  // Terminal windows can warp local gravity above them (§5.1).
  a.kin.acc.y = CONFIG.gravity * localGravityMultiplier(world);

  // apex transitions
  if (a.state.fsm === FsmState.JUMPING && a.kin.vel.y >= 0) a.state.fsm = FsmState.FALLING;
  if (a.state.fsm === FsmState.LAUNCHED && a.kin.vel.y >= 0) a.state.fsm = FsmState.FALLING;

  a.kin.vel.x += a.kin.acc.x * dt;   // velocity first…
  a.kin.vel.y += a.kin.acc.y * dt;

  if (a.state.fsm === FsmState.WALL_SLIDING) {
    a.kin.vel.x = 0;
    a.kin.vel.y = Math.min(a.kin.vel.y, CONFIG.slideMaxFall);
  }

  a.tf.pos.x += a.kin.vel.x * dt;    // …then position uses new velocity
  a.tf.pos.y += a.kin.vel.y * dt;
}

// ---------------------------------------------------------------------------
// 5. CollisionSystem — support field + CCD + inheritance (DESIGN.md §3.2-3.5)
// ---------------------------------------------------------------------------
export function collisionSystem(world: World, dt: number): void {
  const a = world.agent;
  const s = a.state;
  const r = a.shape.radius;

  const wasGrounded = s.grounded;
  s.grounded = false;
  let newWall: -1 | 0 | 1 = 0;
  let landedOn: Win | null = null;

  // z-order: resolve top-most windows first
  const sorted = [...world.windows].sort((w1, w2) => w2.rect.z - w1.rect.z);

  for (const w of sorted) {
    if (w.style.closing > 0) continue;
    const rect = w.rect;

    // --- Terminal text rungs: thin one-way sub-platforms (§5.1) ---
    if (!landedOn && a.kin.vel.y >= 0) {
      const rungY = terminalRungContact(w, a.tf.prev.y + r, a.tf.pos.y + r, a.tf.pos.x);
      if (rungY != null) {
        a.tf.pos.y = rungY - r;
        a.kin.vel.y = 0;
        s.grounded = true;
        s.groundEntity = w.id;
        landedOn = w;
      }
    }

    // --- one-way title bar (DESIGN.md §3.4) with CCD on the top edge ---
    // The crossing test is done in the WINDOW's reference frame so a rising
    // window scooping up a resting packet is detected the same way as a
    // descending packet landing on a static bar. This is what enables the
    // springboard: a fast upward window carries the packet, then tryLaunch
    // converts that surface motion into a restitution-scaled launch.
    const topPrev = w.prev.y;         // window top edge last frame
    const topNow = rect.y;            // window top edge this frame
    const feetPrev = a.tf.prev.y + r; // packet feet last frame
    const feetNow = a.tf.pos.y + r;   // packet feet this frame

    // relative feet-vs-edge position; a sign change across the frame = contact
    const relPrev = feetPrev - topPrev;
    const relNow = feetNow - topNow;
    const crossedOntoTop = relPrev <= 0 && relNow >= 0; // packet landing from above
    const windowRoseInto = relPrev >= 0 && relNow <= 0 && (topNow < topPrev); // bar pushed up into packet
    const overlapX = aabbContainsX(rect, a.tf.pos.x);
    const catchable = a.kin.vel.y >= 0 || windowRoseInto;

    if ((crossedOntoTop || windowRoseInto) && overlapX && catchable && !landedOn) {
      // ask the archetype how to respond to this contact (§5)
      const fx: ContactEffect = archetypeContact(world, w, dt);

      if (fx.passThrough) {
        // platform is non-solid (e.g. fully crumbled BSOD): no landing
      } else {
        a.tf.pos.y = topNow - r;      // snap feet to the bar
        a.kin.vel.y = 0;
        s.grounded = true;
        s.groundEntity = w.id;
        landedOn = w;
        inheritVelocity(world, w, dt);

        // archetype overrides layered on top of default inheritance
        if (fx.frictionScale != null) a.kin.vel.x *= fx.frictionScale;
        if (fx.kickVx != null) a.kin.vel.x += fx.kickVx;
        if (fx.support != null && fx.support > 0) {
          // buoyancy: upward support lifts the packet off the surface
          a.kin.vel.y = -Math.sqrt(2 * fx.support * 1); // impulse-like float
        }
        if (fx.launchVy != null) {
          a.kin.vel.y = fx.launchVy;
          if (fx.forceLaunch) {
            a.state.fsm = FsmState.LAUNCHED;
            s.grounded = false;
            s.groundEntity = null;
            landedOn = null;
          }
        }
      }
    }

    // --- side borders: swept CCD in the window's reference frame (§3.5) ---
    if (!landedOn) {
      // relative motion this frame: agent displacement minus window displacement
      const wdx = w.rect.x - w.prev.x;
      const wdy = w.rect.y - w.prev.y;
      const d: Vec2 = {
        x: (a.tf.pos.x - a.tf.prev.x) - wdx,
        y: (a.tf.pos.y - a.tf.prev.y) - wdy,
      };
      const hit = sweptCircleAABB(a.tf.prev, r, d, rect);
      if (hit && (hit.nx !== 0)) {
        // advance to time of impact, cancel the into-surface component,
        // then re-add the window velocity (that re-add IS the inheritance).
        a.tf.pos.x = a.tf.prev.x + d.x * hit.t + wdx;
        a.tf.pos.y = a.tf.prev.y + d.y * hit.t + wdy;
        const vrelx = a.kin.vel.x - w.drag.vx;
        a.kin.vel.x = (vrelx - vrelx) + w.drag.vx; // normal (x) component removed
        newWall = hit.nx < 0 ? -1 : 1;
      } else {
        // fallback proximity cling keeps the slide readable on slow contacts
        const nearLeft = Math.abs(a.tf.pos.x - rect.x) < r + 4;
        const nearRight = Math.abs(a.tf.pos.x - (rect.x + rect.w)) < r + 4;
        const withinY = a.tf.pos.y > rect.y + w.drag.titleBarH && a.tf.pos.y < rect.y + rect.h;
        if (withinY && (nearLeft || nearRight) && a.kin.vel.y > 0) {
          newWall = nearLeft ? -1 : 1;
          a.tf.pos.x = nearLeft ? rect.x - r : rect.x + rect.w + r;
        }
      }
    }
  }

  // --- floor / walls of the viewport keep the packet on screen for the demo
  const floor = world.height - 4;
  if (a.tf.pos.y + r >= floor) {
    a.tf.pos.y = floor - r;
    a.kin.vel.y = 0;
    s.grounded = true;
    s.groundEntity = null;
    landedOn = landedOn ?? ({} as Win);
  }
  a.tf.pos.x = clamp(a.tf.pos.x, r, world.width - r);

  s.wall = newWall;

  // springboard check runs against the ground window (§3.3)
  if (s.grounded && s.groundEntity != null) {
    const gw = world.windows.find((w) => w.id === s.groundEntity);
    if (gw) tryLaunch(world, gw);
  }

  // record coyote grace when support is lost this frame
  if (wasGrounded && !s.grounded) s.coyote = CONFIG.coyoteTime;
}

function inheritVelocity(world: World, w: Win, dt: number): void {
  const a = world.agent;
  // linear inheritance (§3.2)
  a.kin.vel.x = w.drag.vx + world.agent.state.dir * CONFIG.patrolSpeed;

  // angular term: tangential nudge about window center (§3.2)
  const center: Vec2 = { x: w.rect.x + w.rect.w / 2, y: w.rect.y + w.rect.h / 2 };
  const rvec: Vec2 = { x: a.tf.pos.x - center.x, y: a.tf.pos.y - center.y };
  const omega = CONFIG.kOmega * (w.drag.vx) / dt;
  const t = perp(rvec);
  a.kin.vel.x += omega * t.x;
  a.kin.vel.y += omega * t.y * 0.1; // damp vertical component
}

function tryLaunch(world: World, w: Win): void {
  const a = world.agent;
  const upSpeed = -w.drag.vy; // positive when window moves up
  if (upSpeed > CONFIG.launchMin) {
    const launch = upSpeed * CONFIG.restitution + CONFIG.jumpAssist;
    a.kin.vel.y = -clamp(launch, 0, CONFIG.launchMax);
    a.state.fsm = FsmState.LAUNCHED;
    a.state.grounded = false;
    a.state.groundEntity = null;
  }
}

// ---------------------------------------------------------------------------
// 6. PostFsmSystem — contact-driven transitions (DESIGN.md §2.3 table).
// ---------------------------------------------------------------------------
export function postFsmSystem(world: World): void {
  const s = world.agent.state;

  if (s.grounded && (s.fsm === FsmState.FALLING || s.fsm === FsmState.WALL_SLIDING
      || s.fsm === FsmState.LAUNCHED || s.fsm === FsmState.JUMPING)) {
    s.fsm = FsmState.PATROLLING;
  } else if (!s.grounded) {
    if (s.wall !== 0 && world.agent.kin.vel.y > 0) s.fsm = FsmState.WALL_SLIDING;
    else if (s.fsm === FsmState.WALL_SLIDING && s.wall === 0) s.fsm = FsmState.FALLING;
    else if (s.fsm === FsmState.PATROLLING) s.fsm = FsmState.FALLING;
  }
}

// ---------------------------------------------------------------------------
// Driver: one fixed step = the full pipeline.
// ---------------------------------------------------------------------------
export function stepWorld(world: World, dt: number): void {
  inputSystem(world);
  windowSystem(world, dt);
  archetypeSystem(world, dt);     // stage 2.5: advance per-kind state (§5)
  agentIntentSystem(world, dt);
  kinematicsSystem(world, dt);
  collisionSystem(world, dt);
  postFsmSystem(world);
  // consume pointer edges after the step
  world.pointer.pressed = false;
  world.pointer.released = false;
}
