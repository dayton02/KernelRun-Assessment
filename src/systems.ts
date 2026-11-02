// Systems run in the fixed order described in DESIGN.md §2.4:
//   1 InputSystem  2 WindowSystem  3 AgentIntentSystem
//   4 KinematicsSystem  5 CollisionSystem  6 PostFsmSystem
// (RenderSystem lives in render.ts and is not part of the fixed step.)

import { CONFIG, GAME, FLOW } from './config.js';
import { FsmState, Win, WindowKind } from './components.js';
import { World, marqueeBounds } from './world.js';
import { aabbContainsX, clamp, sweptCircleAABB, Vec2 } from './math.js';
import {
  archetypeSystem, archetypeContact, localGravityMultiplier,
  terminalRungContact, bsodDismiss, ContactEffect,
} from './archetypes.js';
import { cueLand, cueLaunch, cueSlip, cueSpring, cueNet } from './audio.js';

// Hook the game layer reads to drive leapfrog auto-recycle: the id of the
// window the packet most recently LAUNCHED from, and whether it has since
// landed somewhere else. Kept here because launches happen in this module.
export const launchTracker: { lastLaunchWin: number | null; landedElsewhere: boolean } = {
  lastLaunchWin: null,
  landedElsewhere: false,
};

// ---------------------------------------------------------------------------
// 1. InputSystem — translate pointer edges into window grab/close intent.
// ---------------------------------------------------------------------------
export function inputSystem(world: World): void {
  const p = world.pointer;

  if (p.pressed) {
    const win = world.topWindowAt(p.x, p.y);
    if (win) {
      if (win.arch.protectedWin) {
        // SPAWN / SINK are system-reserved and fully IMMOVABLE: the player can
        // neither drag nor close them. Clicking them does nothing. This stops
        // the player from repositioning the goal under the packet.
        // (intentionally no-op)
      } else {
        // Close box lives at the right end of the title bar.
        const closeX = win.rect.x + win.rect.w - 20;
        const onCloseBox = p.x >= closeX && p.y <= win.rect.y + win.drag.titleBarH;
        if (onCloseBox) {
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

      // --- FIREWALL CLAMP (Part 7) ---------------------------------------
      // A window stays on its own side of the firewall. Side is decided by the
      // window center relative to the barrier BEFORE this frame's move, so a
      // window can never tunnel across even on a fast drag.
      const barL = world.firewallX - world.firewallW / 2;
      const barR = world.firewallX + world.firewallW / 2;
      const prevCenter = px + w.rect.w / 2;
      if (prevCenter < world.firewallX) {
        // left side: right edge may not cross the barrier's left face
        if (w.rect.x + w.rect.w > barL) w.rect.x = barL - w.rect.w;
      } else {
        // right side: left edge may not cross the barrier's right face
        if (w.rect.x < barR) w.rect.x = barR;
      }
    }

    // Raw per-frame delta -> CLAMP -> EMA smoothing. (Bug 2 fix.)
    // Clamping the raw delta first means a single pathological mouse jump
    // cannot inject a spike into the smoothed estimate; the EMA then rejects
    // ordinary frame-to-frame jitter. Both stages run before anything reads vx.
    const rawVx = clamp((w.rect.x - px) / dt, -CONFIG.rawDeltaClamp, CONFIG.rawDeltaClamp);
    const rawVy = clamp((w.rect.y - py) / dt, -CONFIG.rawDeltaClamp, CONFIG.rawDeltaClamp);
    const a = CONFIG.flickAlpha;
    w.drag.vx = a * rawVx + (1 - a) * w.drag.vx;
    w.drag.vy = a * rawVy + (1 - a) * w.drag.vy;

    w.prev.x = px; w.prev.y = py; w.prev.w = w.rect.w; w.prev.h = w.rect.h;

    // per-window Part 8 timers
    if (w.drag.springCooldown > 0) w.drag.springCooldown -= dt;
    if (w.drag.springPop > 0) w.drag.springPop -= dt;

    // disappearing platform: fade then despawn
    if (w.style.closing > 0) w.style.closing += dt;
  }

  if (world.marquee.cool > 0) world.marquee.cool -= dt;

  world.windows = world.windows.filter((w) => w.style.closing < 0.35);
}

// ---------------------------------------------------------------------------
// 3. AgentIntentSystem — FSM transitions that depend only on state/timers.
// ---------------------------------------------------------------------------
export function agentIntentSystem(world: World, dt: number): void {
  const s = world.agent.state;
  // Patrol + edge handling now lives in the collision pin block (it needs the
  // final grounded state and window position). Here we only age the coyote
  // timer. This keeps the FSM's time-based concerns separate from contacts.
  if (s.coyote > 0) s.coyote -= dt;
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

  // --- CATCH CONE (Part 8) --------------------------------------------
  // While falling, a mild horizontal pull toward a title bar the packet is
  // about to land on, so good positioning catches the packet without demanding
  // sub-pixel mouse alignment. Pure accel nudge — no teleport, physics-safe.
  if (!a.state.grounded && a.kin.vel.y > 0) {
    const cone = nearestCatchCone(world);
    if (cone) a.kin.acc.x += cone;   // signed accel toward the bar center
  }

  a.kin.vel.x += a.kin.acc.x * dt;   // velocity first…
  a.kin.vel.y += a.kin.acc.y * dt;

  if (a.state.fsm === FsmState.WALL_SLIDING) {
    a.kin.vel.x = 0;
    a.kin.vel.y = Math.min(a.kin.vel.y, CONFIG.slideMaxFall);
  }

  // Horizontal: while grounded the ball is pinned to the window in LOCAL
  // coordinates by the collision system, so we must NOT integrate vel.x here
  // (doing so is what let window motion leak into the ball every frame).
  // Vertical always integrates so gravity / launches still work.
  if (!a.state.grounded) {
    a.tf.pos.x += a.kin.vel.x * dt;
  }
  a.tf.pos.y += a.kin.vel.y * dt;    // position uses the new velocity (symplectic)
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

  // Emergency Marquee Net first: if it bounces the packet this frame, skip the
  // rest of collision (the packet is now airborne off the net).
  if (marqueeNet(world)) {
    s.wall = 0;
    if (wasGrounded) s.coyote = CONFIG.coyoteTime;
    return;
  }

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
        attach(world, w);              // pin in local coords (sets offset if new)
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
        a.kin.vel.x = 0;              // grounded: horizontal is owned by offset
        attach(world, w);            // pin in local coords (sets offset if new)
        landedOn = w;

        // archetype overrides that act on contact. NOTE: no per-frame window
        // velocity is ever added to vel.x here (that was the runaway bug).
        if (fx.support != null && fx.support > 0) {
          // buoyancy: upward support lifts the packet off the surface
          a.kin.vel.y = -Math.sqrt(2 * fx.support * 1); // impulse-like float
        }
        if (fx.launchVy != null) {
          a.kin.vel.y = fx.launchVy;
          if (fx.forceLaunch) {
            detach(world, w);        // single-frame momentum transfer + airborne
            a.state.fsm = FsmState.LAUNCHED;
            landedOn = null;
            cueLaunch();             // ascending chime on auto-bounce / launch
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
        // advance to time of impact and cancel the normal (x) component of the
        // RELATIVE velocity. We deliberately do NOT re-add window.vx to vel.x:
        // a wall contact should stop horizontal motion, not inherit the drag
        // (re-adding it was a second velocity-leak path).
        a.tf.pos.x = a.tf.prev.x + d.x * hit.t + wdx;
        a.tf.pos.y = a.tf.prev.y + d.y * hit.t + wdy;
        a.kin.vel.x = 0;
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

  // --- LOCAL-COORDINATE PIN + PATROL (§1 of the rewrite) -----------------
  // If still attached to a window, lock position to it via the offset and
  // advance the offset by the ball's OWN patrol speed. The ball never reads
  // window velocity here, so a drag can't accumulate into ball.vel.x.
  if (s.grounded && s.groundEntity != null) {
    const gw = world.windows.find((w) => w.id === s.groundEntity);
    if (gw) {
      // --- ELASTIC ANTI-FERRY SLIP (Part 8, replaces instant slip) ------
      // A fast horizontal drag no longer detaches instantly (that felt like an
      // invisible tripwire). Instead the packet WOBBLES for a grace window
      // (telegraphed with a yellow alert + oscillating rotation in render).
      // Only if the over-speed drag persists past the wobble WITHOUT an upward
      // launch does the packet finally slip off and fall straight down.
      const upwardFlick = gw.drag.vy < -CONFIG.flickThreshold;
      const overSpeed = !upwardFlick && Math.abs(gw.drag.vx) > CONFIG.slipThreshold;
      if (overSpeed) {
        if (s.wobble <= 0) s.wobble = FLOW.slip.wobbleTime; // start telegraph
        s.wobble -= dt;
        if (s.wobble <= 0) {
          s.grounded = false;
          s.groundEntity = null;
          a.kin.vel.x = 0;            // NO inherited momentum — falls straight down
          a.kin.vel.y = Math.max(a.kin.vel.y, 0);
          a.state.fsm = FsmState.FALLING;
          cueSlip();
          s.wall = newWall;
          return;                     // slip completed this frame
        }
        // during wobble the packet still rides (pinned below), just unstable
      } else {
        s.wobble = 0;                 // steadied: cancel any pending slip
      }

      // --- SOURCE AUTO-EJECT (Download_Manager) ------------------------
      // The source is a LAUNCHER, not a patrol surface. The packet rests on it
      // (centered) for a short dwell, then is ejected in a diagonal arc toward
      // the goal side. It never patrols or edge-leaps off the source, so it
      // can't get stuck bouncing back and forth on the fixed, undraggable
      // window — the player's job is to CATCH and relay it onward.
      if (gw.arch.kind === WindowKind.SPAWN) {
        // Roll a fresh randomized arc at the START of each charge, so every
        // ejection sends the packet to a different landing spot (but always up
        // and toward the goal side). Stored so it's stable across the dwell.
        if (s.spawnDwell === 0) {
          const sp = GAME.spawn;
          s.ejectVx = sp.ejectVxMin + Math.random() * (sp.ejectVxMax - sp.ejectVxMin);
          s.ejectVy = sp.ejectVyMin + Math.random() * (sp.ejectVyMax - sp.ejectVyMin);
        }
        s.spawnDwell += dt;
        if (s.spawnDwell >= GAME.spawn.dwell) {
          s.spawnDwell = 0;
          detach(world, gw);
          const toCenter = (gw.rect.x + gw.rect.w / 2) < world.width / 2 ? 1 : -1;
          a.kin.vel.x = toCenter * s.ejectVx;   // randomized magnitude
          a.kin.vel.y = s.ejectVy;              // randomized height
          a.state.fsm = FsmState.LAUNCHED;
          cueLaunch();
          s.wall = newWall;
          return;                      // ejected: skip the pin this frame
        }
        // hold the packet centered on the source while it "downloads"
        s.localOffsetX = gw.rect.w / 2;
        a.tf.pos.x = gw.rect.x + s.localOffsetX;
        a.tf.pos.y = gw.rect.y - r;
        a.kin.vel.x = 0;
        s.wall = newWall;
        return;                        // no patrol/edge-leap on the source
      }

      // advance local patrol
      s.localOffsetX += s.dir * CONFIG.patrolSpeed * dt;

      // clamp offset to the title-bar span; flip + leap at the edges
      const lo = r;
      const hi = gw.rect.w - r;
      if (s.localOffsetX <= lo) { s.localOffsetX = lo; s.dir = 1; edgeLeap(world, gw); }
      else if (s.localOffsetX >= hi) { s.localOffsetX = hi; s.dir = -1; edgeLeap(world, gw); }

      // still grounded after the (possible) leap? pin absolutely to the window.
      if (s.grounded) {
        a.tf.pos.x = gw.rect.x + s.localOffsetX;   // THE lock
        a.tf.pos.y = gw.rect.y - r;                // ride vertical motion too
        a.kin.vel.x = 0;                           // no residual horizontal vel
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

/**
 * Attach the ball to a window in LOCAL coordinates. If this is a NEW
 * attachment (different window, or was airborne), capture the current contact
 * point as the local offset so the ball doesn't teleport. No velocity is
 * transferred on attach — grounded horizontal motion is purely the offset.
 */
function attach(world: World, w: Win): void {
  const s = world.agent.state;
  const fresh = !s.grounded || s.groundEntity !== w.id;
  s.grounded = true;
  s.groundEntity = w.id;
  if (fresh) {
    s.localOffsetX = clamp(
      world.agent.tf.pos.x - w.rect.x,
      world.agent.shape.radius,
      w.rect.w - world.agent.shape.radius,
    );
    s.wobble = 0;       // a clean landing steadies the packet
    cueLand();          // blip on a fresh landing
    // Leapfrog recycle: landing on a DIFFERENT window than we launched from
    // means the previous platform can be decommissioned by the game layer.
    if (launchTracker.lastLaunchWin != null && launchTracker.lastLaunchWin !== w.id) {
      launchTracker.landedElsewhere = true;
    }
  }
}

/**
 * Detach from a window and transfer horizontal momentum ONCE, at this exact
 * frame (§2 of the rewrite). The transferred velocity is the smoothed window
 * velocity times a damping scalar, hard-clamped to ±detachMaxVx. The ball's
 * own patrol direction is added so a clean walk-off still moves it.
 */
function detach(world: World, w: Win): void {
  const a = world.agent;
  const s = a.state;

  // one-shot inherited horizontal velocity: damped + clamped window velocity
  const inherited = clamp(
    w.drag.vx * CONFIG.detachDamping,
    -CONFIG.detachMaxVx,
    CONFIG.detachMaxVx,
  );
  a.kin.vel.x = inherited + s.dir * CONFIG.patrolSpeed;

  // remember which window we launched FROM for leapfrog recycling, but never
  // the protected source (it is not a player-placed track piece).
  if (!w.arch.protectedWin) {
    launchTracker.lastLaunchWin = w.id;
    launchTracker.landedElsewhere = false;
  }

  s.grounded = false;
  s.groundEntity = null;
  s.spawnDwell = 0;   // leaving a window resets the source dwell timer
  s.wobble = 0;
}

/** Walk-off / edge jump: detach (transfer once) then apply the jump impulse. */
function edgeLeap(world: World, w: Win): void {
  const a = world.agent;
  detach(world, w);                                  // single momentum transfer
  a.kin.vel.y = -CONFIG.edgeJumpImpulse;
  a.state.fsm = FsmState.JUMPING;
}

/**
 * Catch Cone (Part 8): if the falling packet is within the cone above a title
 * bar, return a horizontal acceleration toward that bar's center. Returns 0 if
 * no bar is in range. Scales with how centered the packet already is, so it
 * assists rather than yanks.
 */
function nearestCatchCone(world: World): number {
  const a = world.agent;
  const c = FLOW.catchCone;
  let best: number | null = null;
  let bestDy = Infinity;
  for (const w of world.windows) {
    if (w.style.closing > 0 || w.drag.grabbed) continue;
    const feet = a.tf.pos.y + a.shape.radius;
    const dy = w.rect.y - feet;                  // bar below the feet
    if (dy < 0 || dy > c.height) continue;       // not within the cone height
    const left = w.rect.x - c.halfWidth;
    const right = w.rect.x + w.rect.w + c.halfWidth;
    if (a.tf.pos.x < left || a.tf.pos.x > right) continue;
    if (dy < bestDy) {
      bestDy = dy;
      const center = w.rect.x + w.rect.w / 2;
      const dir = Math.sign(center - a.tf.pos.x);
      // stronger when nearer the bar (dy small), softer when far
      const strength = 1 - dy / c.height;
      best = dir * c.pull * strength;
    }
  }
  return best ?? 0;
}

/**
 * Click-to-Spring (Part 8): deterministically pop a window, launching a packet
 * that is resting on it straight up — no violent mouse drag required. Returns
 * true if the pop fired (used for audio/feedback by the caller).
 */
export function springPopWindow(world: World, w: Win): boolean {
  if (w.arch.protectedWin || w.style.closing > 0) return false;
  if (w.drag.springCooldown > 0) return false;
  w.drag.springCooldown = FLOW.spring.cooldown;
  w.drag.springPop = 0.18;                 // visual up-nudge duration

  const a = world.agent;
  const s = a.state;
  // Only launches the packet if it is currently grounded on THIS window.
  if (s.grounded && s.groundEntity === w.id) {
    detach(world, w);
    a.kin.vel.y = -FLOW.spring.impulse;
    a.kin.vel.x = s.dir * CONFIG.patrolSpeed; // gentle directional bias, clamped already
    s.fsm = FsmState.LAUNCHED;
    cueSpring();
    return true;
  }
  cueSpring();                             // still "boings" as a bumper
  return false;
}

/**
 * Emergency Marquee Net (Part 8): if the packet is airborne and crosses the
 * TOP border of the active marquee from above, bounce it elastically. Returns
 * true on a bounce. Called from the collision pipeline.
 */
export function marqueeNet(world: World): boolean {
  const m = world.marquee;
  if (!m.active) return false;
  if (m.cool > 0) return false;
  const a = world.agent;
  const s = a.state;
  if (s.grounded || a.kin.vel.y <= 0) return false;  // only catch a falling packet
  const b = marqueeBounds(m);
  if (b.w < FLOW.marquee.minSize || b.h < FLOW.marquee.minSize) return false;

  const r = a.shape.radius;
  const topPrev = b.y;
  const feetPrev = a.tf.prev.y + r;
  const feetNow = a.tf.pos.y + r;
  const crossed = feetPrev <= topPrev && feetNow >= topPrev;
  const overlapX = a.tf.pos.x + r > b.x && a.tf.pos.x - r < b.x + b.w;
  if (crossed && overlapX) {
    a.tf.pos.y = topPrev - r;
    const bounce = Math.min(-a.kin.vel.y * FLOW.marquee.restitution, FLOW.marquee.minBounceVy);
    a.kin.vel.y = bounce;                  // elastic up-bounce (clamped to a min pop)
    s.fsm = FsmState.LAUNCHED;
    m.cool = 0.25;                         // one bounce per arc
    cueNet();
    return true;
  }
  return false;
}

/**
 * Trampoline / springboard flick (§4 of the rewrite). Only launches when the
 * window's UPWARD velocity exceeds the threshold. Launch velocity is the
 * window velocity times restitution (clamped), and the ball detaches into the
 * airborne LAUNCHED state in the same frame.
 */
function tryLaunch(world: World, w: Win): void {
  const a = world.agent;
  const vy = w.drag.vy;                 // negative when the window moves up
  if (vy < -CONFIG.flickThreshold) {    // fast enough upward flick
    detach(world, w);                   // one-shot horizontal transfer too
    // Temp Alert Modal grants +50% restitution if flicked BEFORE it expires.
    let e = CONFIG.restitution;
    if (w.arch.kind === WindowKind.ALERT && w.arch.alertTimer > 0) {
      e *= GAME.alert.earlyRestitution;
    }
    a.kin.vel.y = clamp(vy * e, -CONFIG.launchMax, 0);
    a.state.fsm = FsmState.LAUNCHED;
    cueLaunch();
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
