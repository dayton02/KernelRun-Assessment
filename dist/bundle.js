"use strict";
(() => {
  // src/config.ts
  var CONFIG = {
    dt: 1 / 120,
    // fixed physics step (frame-rate independent)
    gravity: 2200,
    // patrol
    patrolSpeed: 140,
    edgeJumpImpulse: 620,
    // vel.y when leaping a title-bar edge
    coyoteTime: 0.1,
    // seconds
    // springboard (DESIGN.md §3.3)
    restitution: 1.6,
    // e > 1 => super-elastic trampoline
    launchMin: 450,
    // min upward window speed to trigger a launch
    launchMax: 1600,
    jumpAssist: 120,
    // angular coupling (DESIGN.md §3.2)
    kOmega: 5e-4,
    // wall slide (DESIGN.md §3.6)
    slideMaxFall: 260,
    wallFriction: 0.8,
    // flick velocity smoothing (DESIGN.md §3.1)
    flickAlpha: 0.5,
    agentRadius: 9
  };
  var ARCH = {
    terminal: {
      cmdInterval: 2.2,
      // seconds between auto-commands
      gravityLo: 0.35,
      // `setgravity low`
      gravityHi: 1.8,
      // `setgravity high`
      rungLife: 4,
      // seconds a text rung persists
      rungSpacing: 22,
      // vertical px between stacked rungs
      rungThickness: 6,
      // collider half-height for a rung
      maxRungs: 5,
      fieldRadius: 60
      // how far below the bar the gravity field reaches past rungs
    },
    media: {
      bpm: 120,
      amplitude: 34,
      // px of collider oscillation
      launchGain: 7,
      // beat-synced launch = amplitude*gain on a peak
      beatWindow: 0.09,
      // seconds around the beat that count as "on-beat"
      onBeatBonus: 1.9,
      // restitution multiplier if the packet is on-beat
      offBeatBonus: 0.55
      // weak bounce if mistimed
    },
    editor: {
      charsPerSecTyping: 60,
      // how fast content "types" while grabbed+shift
      widthPerChar: 2.4,
      // px of width added per character
      minChars: 10,
      maxChars: 180,
      frictionFull: 0.9,
      // sticky when dense with text
      frictionEmpty: 0.05,
      // near-frictionless when nearly empty (ice)
      buoyancyMax: 900,
      // upward px/s^2 support when "buoyant" (lots of text)
      buoyancyThreshold: 120
      // chars above which the note floats the packet
    },
    bsod: {
      integrity: 2.5,
      // seconds before auto-crumble
      blinkRate: 6,
      // Hz flicker as it nears collapse
      dismissLaunch: 1500,
      // explosive launch speed on force-close
      dismissSpreadX: 480,
      // horizontal kick away from the dismiss point
      shardGravity: 0
      // crumbled fragments are non-solid
    }
  };

  // src/world.ts
  function makeArchetype(kind, baseY) {
    return {
      kind,
      // terminal
      gravityField: 1,
      cmdTimer: ARCH.terminal.cmdInterval,
      rungs: [],
      // media
      bpm: ARCH.media.bpm,
      phase: 0,
      beatPulse: 0,
      baseY,
      onBeat: false,
      // editor
      chars: ARCH.editor.minChars,
      friction: 0.5,
      buoyancy: 0,
      // bsod
      crumble: ARCH.bsod.integrity,
      crumbleMax: ARCH.bsod.integrity,
      dismissed: false
    };
  }
  var World = class {
    constructor(width, height) {
      this.windows = [];
      this.pointer = { x: 0, y: 0, down: false, pressed: false, released: false };
      this.nextId = 1;
      this.width = width;
      this.height = height;
      this.agent = {
        id: this.alloc(),
        tf: { pos: { x: width * 0.3, y: 80 }, prev: { x: width * 0.3, y: 80 } },
        kin: { vel: { x: CONFIG.patrolSpeed, y: 0 }, acc: { x: 0, y: 0 } },
        shape: { radius: CONFIG.agentRadius },
        state: {
          fsm: "FALLING" /* FALLING */,
          dir: 1,
          grounded: false,
          wall: 0,
          coyote: 0,
          groundEntity: null
        }
      };
    }
    alloc() {
      return this.nextId++;
    }
    spawnWindow(x, y, w, h, title, hue, kind = "PLAIN" /* PLAIN */) {
      const win = {
        id: this.alloc(),
        rect: { x, y, w, h, z: this.windows.length },
        prev: { x, y, w, h },
        style: { title, closing: 0, hue },
        drag: { grabbed: false, grabDX: 0, grabDY: 0, titleBarH: 26, vx: 0, vy: 0 },
        arch: makeArchetype(kind, y)
      };
      this.windows.push(win);
      return win;
    }
    /** Top-most window (highest z) whose title bar contains the point. */
    topWindowAt(x, y) {
      let best = null;
      for (const w of this.windows) {
        if (w.style.closing > 0) continue;
        const r = w.rect;
        const inTitle = x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + w.drag.titleBarH;
        if (inTitle && (!best || w.rect.z > best.rect.z)) best = w;
      }
      return best;
    }
    bringToFront(win) {
      const maxZ = this.windows.reduce((m, w) => Math.max(m, w.rect.z), 0);
      win.rect.z = maxZ + 1;
    }
  };

  // src/math.ts
  var clamp = (v, lo, hi) => v < lo ? lo : v > hi ? hi : v;
  var perp = (p) => ({ x: -p.y, y: p.x });
  var aabbContainsX = (r, x) => x >= r.x && x <= r.x + r.w;
  function sweptCircleAABB(p, r, d, box) {
    const ex = { x: box.x - r, y: box.y - r, w: box.w + 2 * r, h: box.h + 2 * r };
    let tmin = 0;
    let tmax = 1;
    let nx = 0;
    let ny = 0;
    if (Math.abs(d.x) < 1e-9) {
      if (p.x < ex.x || p.x > ex.x + ex.w) return null;
    } else {
      const inv = 1 / d.x;
      let t1 = (ex.x - p.x) * inv;
      let t2 = (ex.x + ex.w - p.x) * inv;
      let sign = -1;
      if (t1 > t2) {
        const tmp = t1;
        t1 = t2;
        t2 = tmp;
        sign = 1;
      }
      if (t1 > tmin) {
        tmin = t1;
        nx = sign;
        ny = 0;
      }
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) return null;
    }
    if (Math.abs(d.y) < 1e-9) {
      if (p.y < ex.y || p.y > ex.y + ex.h) return null;
    } else {
      const inv = 1 / d.y;
      let t1 = (ex.y - p.y) * inv;
      let t2 = (ex.y + ex.h - p.y) * inv;
      let sign = -1;
      if (t1 > t2) {
        const tmp = t1;
        t1 = t2;
        t2 = tmp;
        sign = 1;
      }
      if (t1 > tmin) {
        tmin = t1;
        nx = 0;
        ny = sign;
      }
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) return null;
    }
    if (tmin < 0 || tmin > 1) return null;
    return { t: tmin, nx, ny };
  }

  // src/archetypes.ts
  function archetypeSystem(world, dt) {
    for (const w of world.windows) {
      switch (w.arch.kind) {
        case "TERMINAL" /* TERMINAL */:
          updateTerminal(w, dt);
          break;
        case "MEDIA" /* MEDIA */:
          updateMedia(w, dt);
          break;
        case "EDITOR" /* EDITOR */:
          updateEditor(world, w, dt);
          break;
        case "BSOD" /* BSOD */:
          updateBsod(w, dt);
          break;
        default:
          break;
      }
    }
  }
  function updateTerminal(w, dt) {
    const t = ARCH.terminal;
    w.arch.cmdTimer -= dt;
    if (w.arch.cmdTimer <= 0) {
      w.arch.cmdTimer = t.cmdInterval;
      const seq = (w.id + Math.floor(w.arch.phase)) % 3;
      w.arch.phase += 1;
      if (seq === 0) {
        w.arch.gravityField = t.gravityLo;
      } else if (seq === 1) {
        w.arch.gravityField = t.gravityHi;
      } else {
        const localY = w.drag.titleBarH + t.rungSpacing * (w.arch.rungs.length + 1);
        w.arch.rungs.push({ localY, life: t.rungLife, w: w.rect.w * 0.7 });
        if (w.arch.rungs.length > t.maxRungs) w.arch.rungs.shift();
      }
    }
    for (const r of w.arch.rungs) r.life -= dt;
    w.arch.rungs = w.arch.rungs.filter((r) => r.life > 0);
  }
  function updateMedia(w, dt) {
    const m = ARCH.media;
    const beatPeriod = 60 / w.arch.bpm;
    const prevPhase = w.arch.phase;
    w.arch.phase += dt;
    const prevBeat = Math.floor(prevPhase / beatPeriod);
    const nowBeat = Math.floor(w.arch.phase / beatPeriod);
    w.arch.onBeat = nowBeat !== prevBeat;
    const intoBeat = w.arch.phase % beatPeriod / beatPeriod;
    w.arch.beatPulse = Math.pow(1 - intoBeat, 2);
    const offset = -m.amplitude * w.arch.beatPulse;
    if (!w.drag.grabbed) {
      w.rect.y = w.arch.baseY + offset;
    } else {
      w.arch.baseY = w.rect.y - offset;
    }
  }
  function updateEditor(world, w, dt) {
    const e = ARCH.editor;
    const typing = w.drag.grabbed && world.pointer.down;
    if (typing) {
      w.arch.chars = clamp(w.arch.chars + e.charsPerSecTyping * dt, e.minChars, e.maxChars);
    } else {
      w.arch.chars = clamp(w.arch.chars - e.charsPerSecTyping * 0.15 * dt, e.minChars, e.maxChars);
    }
    w.rect.w = e.widthPerChar * w.arch.chars + 60;
    const fill = (w.arch.chars - e.minChars) / (e.maxChars - e.minChars);
    w.arch.friction = e.frictionEmpty + (e.frictionFull - e.frictionEmpty) * fill;
    w.arch.buoyancy = w.arch.chars > e.buoyancyThreshold ? e.buoyancyMax * ((w.arch.chars - e.buoyancyThreshold) / (e.maxChars - e.buoyancyThreshold)) : 0;
  }
  function updateBsod(w, dt) {
    const b = ARCH.bsod;
    w.arch.crumble -= dt;
    if (w.arch.crumble <= 0 && !w.arch.dismissed) {
      w.style.closing = Math.max(w.style.closing, 1e-4);
    }
  }
  function archetypeContact(world, w, dt) {
    switch (w.arch.kind) {
      case "MEDIA" /* MEDIA */:
        return mediaContact(w);
      case "EDITOR" /* EDITOR */:
        return editorContact(w);
      case "BSOD" /* BSOD */:
        return bsodContact(w, dt);
      case "TERMINAL" /* TERMINAL */:
        return terminalContact(world, w);
      default:
        return {};
    }
  }
  function mediaContact(w) {
    const m = ARCH.media;
    if (w.arch.beatPulse > 0.6) {
      const bonus = w.arch.onBeat ? m.onBeatBonus : m.offBeatBonus;
      const speed = m.amplitude * m.launchGain * w.arch.beatPulse * bonus;
      return { launchVy: -clamp(speed, 0, CONFIG.launchMax), forceLaunch: true };
    }
    return {};
  }
  function editorContact(w) {
    return {
      frictionScale: w.arch.friction,
      support: w.arch.buoyancy
    };
  }
  function bsodContact(w, dt) {
    w.arch.crumble -= dt * 2;
    if (w.arch.crumble <= 0) return { passThrough: true };
    return {};
  }
  function terminalContact(world, w) {
    return {};
  }
  function localGravityMultiplier(world) {
    const a = world.agent;
    const t = ARCH.terminal;
    let mult = 1;
    for (const w of world.windows) {
      if (w.arch.kind !== "TERMINAL" /* TERMINAL */ || w.style.closing > 0) continue;
      const withinX = a.tf.pos.x >= w.rect.x && a.tf.pos.x <= w.rect.x + w.rect.w;
      const above = a.tf.pos.y < w.rect.y && a.tf.pos.y > w.rect.y - t.fieldRadius * 4;
      if (withinX && above) mult = w.arch.gravityField;
    }
    return mult;
  }
  function terminalRungContact(w, feetPrev, feetNow, x) {
    if (w.arch.kind !== "TERMINAL" /* TERMINAL */) return null;
    const t = ARCH.terminal;
    const withinX = x >= w.rect.x + w.rect.w * 0.15 && x <= w.rect.x + w.rect.w * 0.85;
    if (!withinX) return null;
    for (const r of w.arch.rungs) {
      const rungY = w.rect.y + r.localY;
      const crossed = feetPrev <= rungY && feetNow >= rungY;
      if (crossed) return rungY;
    }
    return null;
  }
  function bsodDismiss(world, w, clickX) {
    const b = ARCH.bsod;
    w.arch.dismissed = true;
    w.style.closing = 1e-4;
    const a = world.agent;
    const near = a.tf.pos.x >= w.rect.x - 20 && a.tf.pos.x <= w.rect.x + w.rect.w + 20 && a.tf.pos.y <= w.rect.y + w.rect.h && a.tf.pos.y >= w.rect.y - 40;
    if (!near) return;
    const intensity = clamp(w.arch.crumble / w.arch.crumbleMax, 0.2, 1);
    a.kin.vel.y = -b.dismissLaunch * intensity;
    const side = a.tf.pos.x < clickX ? -1 : 1;
    a.kin.vel.x = side * b.dismissSpreadX * intensity;
    a.state.fsm = "LAUNCHED" /* LAUNCHED */;
    a.state.grounded = false;
    a.state.groundEntity = null;
  }

  // src/systems.ts
  function inputSystem(world) {
    const p = world.pointer;
    if (p.pressed) {
      const win = world.topWindowAt(p.x, p.y);
      if (win) {
        const closeX = win.rect.x + win.rect.w - 20;
        if (p.x >= closeX && p.y <= win.rect.y + win.drag.titleBarH) {
          if (win.arch.kind === "BSOD" /* BSOD */) {
            bsodDismiss(world, win, p.x);
          } else {
            win.style.closing = 1e-4;
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
  function windowSystem(world, dt) {
    const p = world.pointer;
    for (const w of world.windows) {
      const px = w.rect.x;
      const py = w.rect.y;
      if (w.drag.grabbed) {
        w.rect.x = p.x - w.drag.grabDX;
        w.rect.y = p.y - w.drag.grabDY;
      }
      const instVx = (w.rect.x - px) / dt;
      const instVy = (w.rect.y - py) / dt;
      const a = CONFIG.flickAlpha;
      w.drag.vx = a * instVx + (1 - a) * w.drag.vx;
      w.drag.vy = a * instVy + (1 - a) * w.drag.vy;
      w.prev.x = px;
      w.prev.y = py;
      w.prev.w = w.rect.w;
      w.prev.h = w.rect.h;
      if (w.style.closing > 0) w.style.closing += dt;
    }
    world.windows = world.windows.filter((w) => w.style.closing < 0.35);
  }
  function agentIntentSystem(world, dt) {
    const a = world.agent;
    const s = a.state;
    if (s.coyote > 0) s.coyote -= dt;
    if (s.fsm === "PATROLLING" /* PATROLLING */ && s.grounded && s.groundEntity != null) {
      const gw = world.windows.find((w) => w.id === s.groundEntity);
      if (gw) {
        const left = gw.rect.x + a.shape.radius;
        const right = gw.rect.x + gw.rect.w - a.shape.radius;
        if (a.tf.pos.x <= left) {
          s.dir = 1;
          edgeLeap(world);
        } else if (a.tf.pos.x >= right) {
          s.dir = -1;
          edgeLeap(world);
        }
      }
    }
  }
  function edgeLeap(world) {
    const a = world.agent;
    a.kin.vel.y = -CONFIG.edgeJumpImpulse;
    a.kin.vel.x = world.agent.state.dir * CONFIG.patrolSpeed * 1.4;
    a.state.fsm = "JUMPING" /* JUMPING */;
    a.state.grounded = false;
    a.state.groundEntity = null;
  }
  function kinematicsSystem(world, dt) {
    const a = world.agent;
    a.tf.prev.x = a.tf.pos.x;
    a.tf.prev.y = a.tf.pos.y;
    a.kin.acc.x = 0;
    a.kin.acc.y = CONFIG.gravity * localGravityMultiplier(world);
    if (a.state.fsm === "JUMPING" /* JUMPING */ && a.kin.vel.y >= 0) a.state.fsm = "FALLING" /* FALLING */;
    if (a.state.fsm === "LAUNCHED" /* LAUNCHED */ && a.kin.vel.y >= 0) a.state.fsm = "FALLING" /* FALLING */;
    a.kin.vel.x += a.kin.acc.x * dt;
    a.kin.vel.y += a.kin.acc.y * dt;
    if (a.state.fsm === "WALL_SLIDING" /* WALL_SLIDING */) {
      a.kin.vel.x = 0;
      a.kin.vel.y = Math.min(a.kin.vel.y, CONFIG.slideMaxFall);
    }
    a.tf.pos.x += a.kin.vel.x * dt;
    a.tf.pos.y += a.kin.vel.y * dt;
  }
  function collisionSystem(world, dt) {
    const a = world.agent;
    const s = a.state;
    const r = a.shape.radius;
    const wasGrounded = s.grounded;
    s.grounded = false;
    let newWall = 0;
    let landedOn = null;
    const sorted = [...world.windows].sort((w1, w2) => w2.rect.z - w1.rect.z);
    for (const w of sorted) {
      if (w.style.closing > 0) continue;
      const rect = w.rect;
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
      const topPrev = w.prev.y;
      const topNow = rect.y;
      const feetPrev = a.tf.prev.y + r;
      const feetNow = a.tf.pos.y + r;
      const relPrev = feetPrev - topPrev;
      const relNow = feetNow - topNow;
      const crossedOntoTop = relPrev <= 0 && relNow >= 0;
      const windowRoseInto = relPrev >= 0 && relNow <= 0 && topNow < topPrev;
      const overlapX = aabbContainsX(rect, a.tf.pos.x);
      const catchable = a.kin.vel.y >= 0 || windowRoseInto;
      if ((crossedOntoTop || windowRoseInto) && overlapX && catchable && !landedOn) {
        const fx = archetypeContact(world, w, dt);
        if (fx.passThrough) {
        } else {
          a.tf.pos.y = topNow - r;
          a.kin.vel.y = 0;
          s.grounded = true;
          s.groundEntity = w.id;
          landedOn = w;
          inheritVelocity(world, w, dt);
          if (fx.frictionScale != null) a.kin.vel.x *= fx.frictionScale;
          if (fx.kickVx != null) a.kin.vel.x += fx.kickVx;
          if (fx.support != null && fx.support > 0) {
            a.kin.vel.y = -Math.sqrt(2 * fx.support * 1);
          }
          if (fx.launchVy != null) {
            a.kin.vel.y = fx.launchVy;
            if (fx.forceLaunch) {
              a.state.fsm = "LAUNCHED" /* LAUNCHED */;
              s.grounded = false;
              s.groundEntity = null;
              landedOn = null;
            }
          }
        }
      }
      if (!landedOn) {
        const wdx = w.rect.x - w.prev.x;
        const wdy = w.rect.y - w.prev.y;
        const d = {
          x: a.tf.pos.x - a.tf.prev.x - wdx,
          y: a.tf.pos.y - a.tf.prev.y - wdy
        };
        const hit = sweptCircleAABB(a.tf.prev, r, d, rect);
        if (hit && hit.nx !== 0) {
          a.tf.pos.x = a.tf.prev.x + d.x * hit.t + wdx;
          a.tf.pos.y = a.tf.prev.y + d.y * hit.t + wdy;
          const vrelx = a.kin.vel.x - w.drag.vx;
          a.kin.vel.x = vrelx - vrelx + w.drag.vx;
          newWall = hit.nx < 0 ? -1 : 1;
        } else {
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
    const floor = world.height - 4;
    if (a.tf.pos.y + r >= floor) {
      a.tf.pos.y = floor - r;
      a.kin.vel.y = 0;
      s.grounded = true;
      s.groundEntity = null;
      landedOn = landedOn ?? {};
    }
    a.tf.pos.x = clamp(a.tf.pos.x, r, world.width - r);
    s.wall = newWall;
    if (s.grounded && s.groundEntity != null) {
      const gw = world.windows.find((w) => w.id === s.groundEntity);
      if (gw) tryLaunch(world, gw);
    }
    if (wasGrounded && !s.grounded) s.coyote = CONFIG.coyoteTime;
  }
  function inheritVelocity(world, w, dt) {
    const a = world.agent;
    a.kin.vel.x = w.drag.vx + world.agent.state.dir * CONFIG.patrolSpeed;
    const center = { x: w.rect.x + w.rect.w / 2, y: w.rect.y + w.rect.h / 2 };
    const rvec = { x: a.tf.pos.x - center.x, y: a.tf.pos.y - center.y };
    const omega = CONFIG.kOmega * w.drag.vx / dt;
    const t = perp(rvec);
    a.kin.vel.x += omega * t.x;
    a.kin.vel.y += omega * t.y * 0.1;
  }
  function tryLaunch(world, w) {
    const a = world.agent;
    const upSpeed = -w.drag.vy;
    if (upSpeed > CONFIG.launchMin) {
      const launch = upSpeed * CONFIG.restitution + CONFIG.jumpAssist;
      a.kin.vel.y = -clamp(launch, 0, CONFIG.launchMax);
      a.state.fsm = "LAUNCHED" /* LAUNCHED */;
      a.state.grounded = false;
      a.state.groundEntity = null;
    }
  }
  function postFsmSystem(world) {
    const s = world.agent.state;
    if (s.grounded && (s.fsm === "FALLING" /* FALLING */ || s.fsm === "WALL_SLIDING" /* WALL_SLIDING */ || s.fsm === "LAUNCHED" /* LAUNCHED */ || s.fsm === "JUMPING" /* JUMPING */)) {
      s.fsm = "PATROLLING" /* PATROLLING */;
    } else if (!s.grounded) {
      if (s.wall !== 0 && world.agent.kin.vel.y > 0) s.fsm = "WALL_SLIDING" /* WALL_SLIDING */;
      else if (s.fsm === "WALL_SLIDING" /* WALL_SLIDING */ && s.wall === 0) s.fsm = "FALLING" /* FALLING */;
      else if (s.fsm === "PATROLLING" /* PATROLLING */) s.fsm = "FALLING" /* FALLING */;
    }
  }
  function stepWorld(world, dt) {
    inputSystem(world);
    windowSystem(world, dt);
    archetypeSystem(world, dt);
    agentIntentSystem(world, dt);
    kinematicsSystem(world, dt);
    collisionSystem(world, dt);
    postFsmSystem(world);
    world.pointer.pressed = false;
    world.pointer.released = false;
  }

  // src/render.ts
  var KIND_TAG = {
    ["PLAIN" /* PLAIN */]: "",
    ["TERMINAL" /* TERMINAL */]: " [sh]",
    ["MEDIA" /* MEDIA */]: " [\u266A]",
    ["EDITOR" /* EDITOR */]: " [txt]",
    ["BSOD" /* BSOD */]: " [ERR]"
  };
  function render(ctx, world) {
    ctx.clearRect(0, 0, world.width, world.height);
    ctx.fillStyle = "#0b1020";
    ctx.fillRect(0, 0, world.width, world.height);
    drawGrid(ctx, world);
    const sorted = [...world.windows].sort((a2, b) => a2.rect.z - b.rect.z);
    for (const w of sorted) {
      const fade = w.style.closing > 0 ? Math.max(0, 1 - w.style.closing / 0.35) : 1;
      ctx.globalAlpha = fade;
      const r = w.rect;
      ctx.fillStyle = `hsl(${w.style.hue} 30% 16%)`;
      ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.strokeStyle = `hsl(${w.style.hue} 60% 55%)`;
      ctx.lineWidth = 2;
      ctx.strokeRect(r.x, r.y, r.w, r.h);
      drawArchetype(ctx, w);
      let barL = 42;
      if (w.arch.kind === "MEDIA" /* MEDIA */) barL = 42 + 28 * w.arch.beatPulse;
      if (w.arch.kind === "BSOD" /* BSOD */) {
        const frac = Math.max(0, w.arch.crumble / w.arch.crumbleMax);
        const flick = frac < 0.4 ? Math.sin(w.arch.crumbleMax * 40 - frac * 60) > 0 ? 55 : 25 : 42;
        barL = flick;
      }
      ctx.fillStyle = `hsl(${w.style.hue} 55% ${barL}%)`;
      ctx.fillRect(r.x, r.y, r.w, w.drag.titleBarH);
      ctx.fillStyle = "#eaf0ff";
      ctx.font = "13px system-ui, sans-serif";
      ctx.fillText(w.style.title + KIND_TAG[w.arch.kind], r.x + 8, r.y + 18);
      ctx.fillStyle = "#e4607a";
      ctx.fillRect(r.x + r.w - 20, r.y + 6, 14, 14);
      ctx.fillStyle = "#2a0c12";
      ctx.fillText("x", r.x + r.w - 17, r.y + 18);
      ctx.globalAlpha = 1;
    }
    const a = world.agent;
    ctx.beginPath();
    ctx.arc(a.tf.pos.x, a.tf.pos.y, a.shape.radius, 0, Math.PI * 2);
    ctx.fillStyle = stateColor(a.state.fsm);
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = "#ffffff";
    ctx.stroke();
    drawHud(ctx, world);
  }
  function drawArchetype(ctx, w) {
    const r = w.rect;
    switch (w.arch.kind) {
      case "TERMINAL" /* TERMINAL */: {
        const g = w.arch.gravityField;
        ctx.fillStyle = g < 1 ? "rgba(120,200,255,0.08)" : g > 1 ? "rgba(255,150,120,0.08)" : "transparent";
        ctx.fillRect(r.x, r.y - 120, r.w, 120);
        ctx.fillStyle = "#6cff9a";
        ctx.font = "11px ui-monospace, monospace";
        ctx.fillText(g < 1 ? "> setgravity low" : g > 1 ? "> setgravity high" : "> _", r.x + 8, r.y + w.drag.titleBarH + 14);
        for (const rung of w.arch.rungs) {
          const y = r.y + rung.localY;
          const alpha = Math.min(1, rung.life);
          ctx.globalAlpha = alpha;
          ctx.fillStyle = "#9ad9ff";
          ctx.fillRect(r.x + r.w * 0.15, y - 3, rung.w, 6);
          ctx.globalAlpha = 1;
        }
        break;
      }
      case "MEDIA" /* MEDIA */: {
        ctx.strokeStyle = "#ff8ad0";
        ctx.lineWidth = 2;
        const bars = 16;
        for (let i = 0; i < bars; i++) {
          const bx = r.x + 10 + i / bars * (r.w - 20);
          const amp = (0.3 + 0.7 * Math.abs(Math.sin(i * 1.3 + w.arch.phase * 6))) * w.arch.beatPulse;
          const bh = 6 + amp * (r.h - w.drag.titleBarH - 20);
          ctx.beginPath();
          ctx.moveTo(bx, r.y + r.h - 10);
          ctx.lineTo(bx, r.y + r.h - 10 - bh);
          ctx.stroke();
        }
        break;
      }
      case "EDITOR" /* EDITOR */: {
        const fillFrac = (w.arch.chars - 10) / (180 - 10);
        ctx.fillStyle = "rgba(255,230,120,0.12)";
        ctx.fillRect(r.x, r.y + r.h - 6, r.w * fillFrac, 6);
        if (w.arch.buoyancy > 0) {
          ctx.fillStyle = "rgba(120,255,200,0.10)";
          ctx.fillRect(r.x, r.y - 30, r.w, 30);
        }
        break;
      }
      case "BSOD" /* BSOD */: {
        const frac = Math.max(0, w.arch.crumble / w.arch.crumbleMax);
        ctx.fillStyle = frac < 0.4 ? "#ff5b5b" : "#ffd166";
        ctx.fillRect(r.x, r.y + r.h - 5, r.w * frac, 5);
        ctx.fillStyle = "#eaf0ff";
        ctx.font = "12px ui-monospace, monospace";
        ctx.fillText(":( FATAL_EXCEPTION", r.x + 10, r.y + r.h / 2);
        break;
      }
      default:
        break;
    }
  }
  function stateColor(s) {
    switch (s) {
      case "PATROLLING" /* PATROLLING */:
        return "#52e0a0";
      case "JUMPING" /* JUMPING */:
        return "#ffd166";
      case "LAUNCHED" /* LAUNCHED */:
        return "#ff7b7b";
      case "FALLING" /* FALLING */:
        return "#7aa2ff";
      case "WALL_SLIDING" /* WALL_SLIDING */:
        return "#c792ea";
    }
  }
  function drawGrid(ctx, world) {
    ctx.strokeStyle = "rgba(255,255,255,0.04)";
    ctx.lineWidth = 1;
    for (let x = 0; x < world.width; x += 40) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, world.height);
      ctx.stroke();
    }
    for (let y = 0; y < world.height; y += 40) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(world.width, y);
      ctx.stroke();
    }
  }
  function drawHud(ctx, world) {
    const a = world.agent;
    ctx.fillStyle = "#9fb0d0";
    ctx.font = "12px ui-monospace, monospace";
    const lines = [
      `state: ${a.state.fsm}`,
      `vel:   (${a.kin.vel.x.toFixed(0)}, ${a.kin.vel.y.toFixed(0)})`,
      `ground:${a.state.grounded}  wall:${a.state.wall}`,
      `[sh] gravity+rungs  [\u266A] beat-bounce  [txt] grow/float  [ERR] close=BOOM`
    ];
    lines.forEach((l, i) => ctx.fillText(l, 10, 16 + i * 15));
  }

  // src/main.ts
  function boot(canvas) {
    const ctx = canvas.getContext("2d");
    const world = new World(canvas.width, canvas.height);
    world.spawnWindow(90, 220, 200, 150, "readme.txt", 210, "PLAIN" /* PLAIN */);
    world.spawnWindow(330, 300, 230, 150, "bash", 150, "TERMINAL" /* TERMINAL */);
    world.spawnWindow(600, 180, 200, 140, "player.fm", 320, "MEDIA" /* MEDIA */);
    world.spawnWindow(150, 450, 180, 120, "notes.txt", 50, "EDITOR" /* EDITOR */);
    world.spawnWindow(470, 470, 220, 120, "SYSTEM_FAULT", 0, "BSOD" /* BSOD */);
    const setPos = (e) => {
      const rect = canvas.getBoundingClientRect();
      world.pointer.x = (e.clientX - rect.left) * (canvas.width / rect.width);
      world.pointer.y = (e.clientY - rect.top) * (canvas.height / rect.height);
    };
    canvas.addEventListener("pointerdown", (e) => {
      setPos(e);
      world.pointer.down = true;
      world.pointer.pressed = true;
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener("pointermove", setPos);
    canvas.addEventListener("pointerup", (e) => {
      setPos(e);
      world.pointer.down = false;
      world.pointer.released = true;
    });
    let last = performance.now();
    let acc = 0;
    function frame(now) {
      acc += Math.min(0.1, (now - last) / 1e3);
      last = now;
      while (acc >= CONFIG.dt) {
        stepWorld(world, CONFIG.dt);
        acc -= CONFIG.dt;
      }
      render(ctx, world);
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }
  if (typeof document !== "undefined") {
    const el = document.getElementById("stage");
    if (el) boot(el);
  }
})();
