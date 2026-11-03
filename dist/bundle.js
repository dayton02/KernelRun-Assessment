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
    // --- stable moving-platform coupling (see §3.2 rewrite) ---------------
    // Horizontal momentum is transferred ONCE on detachment, never per frame.
    detachDamping: 0.5,
    // 0.4..0.6: scalar on inherited horizontal velocity
    detachMaxVx: 400,
    // hard clamp on transferred horizontal velocity (px/s)
    flickThreshold: 350,
    // |window vy| must exceed this (upward) to launch
    // --- anti-ferry inertial slip (Part 7) --------------------------------
    // A grounded packet loses footing if its window is dragged sideways faster
    // than this WITHOUT an upward flick. Prevents ferrying the packet across the
    // desktop by slow horizontal drag.
    slipThreshold: 120,
    // |window vx| px/s above which the packet slips off
    // wall slide (DESIGN.md §3.6)
    slideMaxFall: 260,
    wallFriction: 0.8,
    // Window-velocity smoothing. The EMA weight on the newest raw frame delta:
    // lower = smoother / more spike rejection. 0.2 ignores most single-frame
    // jitter while still tracking a sustained drag within a few frames.
    flickAlpha: 0.2,
    // Hard sanity clamp on the raw per-frame delta BEFORE it feeds the EMA, so a
    // single pathological mouse jump can never enter the smoothed estimate.
    rawDeltaClamp: 2500,
    // px/s
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
  var GAME = {
    integrityStart: 100,
    // Data Integrity %
    integrityPenalty: 25,
    // % lost each time the packet falls past the taskbar
    taskbarH: 28,
    // height of the bottom taskbar (the kill line is its top)
    // RAM / Memory Usage constraint
    ramMax: 100,
    // %
    ramPerWindow: 8,
    // flat base cost to keep a window open
    ramPerArea: 1 / 1400,
    // additional % per px^2 of window area
    ramSpawnBlock: 96,
    // cannot spawn new windows at/above this usage
    // Live memory leak (Part 7): each open non-essential window leaks RAM
    // continuously. Total leak rate = ramLeakPerWindow * openCount per second.
    ramLeakPerWindow: 0.5,
    // % per second, per open auxiliary window
    // Audio Player pulse (spec: +/-10px every 500ms)
    pulse: {
      amplitude: 10,
      // px the top edge moves
      halfPeriod: 0.5,
      // seconds per half-cycle (toggles every 500ms)
      bounceBonus: 1.15
      // mild restitution when landing on the rising edge
    },
    // Temp Alert Modal
    alert: {
      countdown: 5,
      // seconds before it auto-closes
      earlyRestitution: 1.5
      // +50% launch restitution if flicked before expiry
    },
    // win handling
    winFreeze: 1.2,
    // seconds of celebration before level reset
    // Source auto-eject (Download_Manager). The packet does not idle-patrol the
    // source forever: after a short dwell it is ejected in a diagonal arc toward
    // the goal side, so the player relays it onward (catch -> flick) instead of
    // trying to coax it off a fixed, undraggable window.
    //
    // The arc is RANDOMIZED within a band each charge so the landing spot isn't
    // rote. Horizontal is always toward the goal side; vertical always upward —
    // only the magnitudes vary, keeping the opening fresh but always "winnable".
    spawn: {
      dwell: 0.9,
      // seconds grounded on the source before ejection
      ejectVxMin: 240,
      // horizontal eject speed band (toward goal side)
      ejectVxMax: 460,
      ejectVyMin: -820,
      // upward component band (more negative = higher)
      ejectVyMax: -560
    }
  };
  var FLOW = {
    // 1. Click-to-Spring: a quick click/space pops the hovered idle window up,
    //    launching a resting packet deterministically — no violent mouse drag.
    spring: {
      impulse: 780,
      // upward packet launch speed on a spring pop (px/s)
      windowKick: -260,
      // brief visual up-nudge of the window top edge
      cooldown: 0.25,
      // seconds between spring pops on one window
      clickMaxMs: 220,
      // press->release under this = a "click" (vs a drag)
      clickMaxMove: 6
      // px of pointer travel allowed to still count as a click
    },
    // Catch Cone: a mild gravitational snap pulling a falling packet toward a
    // title bar it is about to land on, rewarding good positioning over pixels.
    catchCone: {
      height: 30,
      // px above a title bar where the cone acts
      halfWidth: 40,
      // px to each side of the bar the cone spans
      pull: 1400
      // horizontal accel toward the bar center (px/s^2)
    },
    // 2. Marquee Net: drag on empty wallpaper to draw a selection box; its top
    //    edge is an elastic trampoline. Costs RAM while held.
    marquee: {
      ramCost: 15,
      // % RAM consumed while a marquee is held
      restitution: 0.9,
      // elastic bounce factor off the top border
      minBounceVy: -620,
      // guarantee at least this much upward pop
      minSize: 24
      // px: ignore accidental tiny marquees
    },
    // 3. Leapfrog Auto-Recycle: the window a packet LAUNCHED from decommissions
    //    on a timer once the packet lands elsewhere, refunding RAM + combo.
    recycle: {
      decommission: 2,
      // seconds of pulse before it dissolves
      comboWindow: 6,
      // seconds to chain recycles for the combo meter
      comboMax: 8
      // cap on the recycle combo multiplier
    },
    // 4. Elastic Slip: fast horizontal drag first wobbles the packet for a grace
    //    window; only continued over-speed drag past it actually slips it off.
    slip: {
      wobbleTime: 0.3
      // seconds of telegraphed wobble before detaching
    },
    // 5. Arcade pacing: delivery streak multiplier + difficulty ramp + shake.
    pacing: {
      streakMax: 3,
      // 1x .. 3x delivery multiplier
      speedupPerWin: 0.05,
      // +5% base patrol speed per delivery
      speedupMax: 2.5,
      // cap the ramp at 2.5x base
      shakeOnWin: 10,
      // screen-shake amplitude (px) on a delivery
      shakeDecay: 6
      // per-second shake decay
    }
  };

  // src/world.ts
  function marqueeBounds(m) {
    const x = Math.min(m.x0, m.x1);
    const y = Math.min(m.y0, m.y1);
    return { x, y, w: Math.abs(m.x1 - m.x0), h: Math.abs(m.y1 - m.y0) };
  }
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
      dismissed: false,
      // alert (Temp Alert Modal)
      alertTimer: GAME.alert.countdown,
      alertMax: GAME.alert.countdown,
      // audio-player pulse
      pulseTimer: 0,
      pulseUp: false,
      // game roles
      protectedWin: kind === "SPAWN" /* SPAWN */ || kind === "SINK" /* SINK */
    };
  }
  var World = class {
    constructor(width, height) {
      this.windows = [];
      this.pointer = { x: 0, y: 0, down: false, pressed: false, released: false };
      this.firewallW = 8;
      // Emergency Marquee Net (Part 8): a selection box the player drags on empty
      // wallpaper. Its top edge is an elastic trampoline; costs RAM while held.
      this.marquee = { active: false, x0: 0, y0: 0, x1: 0, y1: 0, cool: 0 };
      // Spring-pop intent (Part 8): DOM input (click or Space) sets this; the
      // InputSystem consumes it INSIDE the fixed step so it stays in sync with the
      // physics (no event-loop race). Holds the target point to resolve a window.
      this.springRequest = { pending: false, x: 0, y: 0 };
      this.nextId = 1;
      this.width = width;
      this.height = height;
      this.firewallX = Math.round(width * 0.5);
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
          groundEntity: null,
          localOffsetX: 0,
          spawnDwell: 0,
          wobble: 0,
          ejectVx: 0,
          ejectVy: 0
        }
      };
    }
    alloc() {
      return this.nextId++;
    }
    /**
     * Clamp a window's left-X so its body never straddles the firewall stripe.
     * A window whose requested span crosses the barrier is pushed fully onto the
     * side its CENTER is nearer (ties go left). Guarantees no tab can spawn in
     * between the firewall regardless of caller coordinates or screen width.
     */
    firewallSafeX(x, w) {
      const barL = this.firewallX - this.firewallW / 2;
      const barR = this.firewallX + this.firewallW / 2;
      const left = x;
      const right = x + w;
      if (right <= barL) return x;
      if (left >= barR) return x;
      const center = x + w / 2;
      if (center < this.firewallX) {
        return Math.max(0, barL - w);
      }
      return Math.min(this.width - w, barR);
    }
    spawnWindow(x, y, w, h, title, hue, kind = "PLAIN" /* PLAIN */) {
      x = this.firewallSafeX(x, w);
      const win = {
        id: this.alloc(),
        rect: { x, y, w, h, z: this.windows.length },
        prev: { x, y, w, h },
        style: { title, closing: 0, hue },
        drag: {
          grabbed: false,
          grabDX: 0,
          grabDY: 0,
          titleBarH: 26,
          vx: 0,
          vy: 0,
          springCooldown: 0,
          springPop: 0,
          recycleTimer: 0
        },
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
        case "ALERT" /* ALERT */:
          updateAlert(w, dt);
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
    const p = GAME.pulse;
    w.arch.pulseTimer += dt;
    if (w.arch.pulseTimer >= p.halfPeriod) {
      w.arch.pulseTimer -= p.halfPeriod;
      w.arch.pulseUp = !w.arch.pulseUp;
    }
    const pulseOffset = w.arch.pulseUp ? -p.amplitude : p.amplitude;
    const beatPeriod = 60 / w.arch.bpm;
    const prevPhase = w.arch.phase;
    w.arch.phase += dt;
    const prevBeat = Math.floor(prevPhase / beatPeriod);
    const nowBeat = Math.floor(w.arch.phase / beatPeriod);
    w.arch.onBeat = nowBeat !== prevBeat;
    const intoBeat = w.arch.phase % beatPeriod / beatPeriod;
    w.arch.beatPulse = Math.pow(1 - intoBeat, 2);
    if (!w.drag.grabbed) {
      w.rect.y = w.arch.baseY + pulseOffset;
    } else {
      w.arch.baseY = w.rect.y - pulseOffset;
    }
  }
  function updateAlert(w, dt) {
    w.arch.alertTimer -= dt;
    if (w.arch.alertTimer <= 0 && w.style.closing === 0) {
      w.style.closing = 1e-4;
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
    const p = GAME.pulse;
    if (w.arch.pulseUp) {
      const speed = CONFIG.edgeJumpImpulse * p.bounceBonus;
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

  // src/audio.ts
  var ctx = null;
  var master = null;
  var enabled = true;
  function initAudio() {
    if (typeof window === "undefined") return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) {
      enabled = false;
      return;
    }
    if (!ctx) {
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.18;
      master.connect(ctx.destination);
    }
    if (ctx.state === "suspended") void ctx.resume();
  }
  function note(freq, dur, type = "sine", startGain = 0.6, slideTo) {
    if (!enabled || !ctx || !master) return;
    const t0 = ctx.currentTime;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slideTo != null) osc.frequency.exponentialRampToValueAtTime(Math.max(1, slideTo), t0 + dur);
    g.gain.setValueAtTime(startGain, t0);
    g.gain.exponentialRampToValueAtTime(1e-4, t0 + dur);
    osc.connect(g).connect(master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }
  function cueLand() {
    note(220, 0.08, "triangle", 0.5);
  }
  function cueLaunch() {
    note(440, 0.1, "sine", 0.5, 740);
    note(660, 0.14, "sine", 0.3, 990);
  }
  function cueIntegrityLoss() {
    note(300, 0.16, "sawtooth", 0.5, 120);
    note(150, 0.2, "square", 0.3);
  }
  function cueDissolve() {
    note(110, 0.4, "sawtooth", 0.5, 40);
  }
  function cueSlip() {
    note(520, 0.09, "sawtooth", 0.4, 240);
  }
  function cueGcSweep() {
    note(900, 0.25, "square", 0.4, 90);
    note(300, 0.3, "sawtooth", 0.3, 60);
  }
  function cueSpring() {
    note(300, 0.12, "square", 0.45, 680);
  }
  function cueNet() {
    note(240, 0.14, "sine", 0.5, 520);
    note(480, 0.1, "triangle", 0.25);
  }
  function cueRecycle() {
    note(620, 0.1, "square", 0.3, 180);
  }
  function cueDeliverChord(semitoneBoost = 0) {
    const base = 523 * Math.pow(2, semitoneBoost / 12);
    [0, 4, 7, 12].forEach((st, i) => {
      if (typeof window === "undefined") return;
      window.setTimeout(() => note(base * Math.pow(2, st / 12), 0.26, "sine", 0.5), i * 70);
    });
  }

  // src/systems.ts
  var launchTracker = {
    lastLaunchWin: null,
    landedElsewhere: false
  };
  function inputSystem(world) {
    const p = world.pointer;
    if (p.pressed) {
      const win = world.topWindowAt(p.x, p.y);
      if (win) {
        if (win.arch.protectedWin) {
        } else {
          const closeX = win.rect.x + win.rect.w - 20;
          const onCloseBox = p.x >= closeX && p.y <= win.rect.y + win.drag.titleBarH;
          if (onCloseBox) {
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
    }
    if (p.released) {
      for (const w of world.windows) w.drag.grabbed = false;
    }
    if (world.springRequest.pending) {
      world.springRequest.pending = false;
      const sr = world.springRequest;
      const win = world.topWindowAt(sr.x, sr.y);
      if (win) springPopWindow(world, win);
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
        const barL = world.firewallX - world.firewallW / 2;
        const barR = world.firewallX + world.firewallW / 2;
        const prevCenter = px + w.rect.w / 2;
        if (prevCenter < world.firewallX) {
          if (w.rect.x + w.rect.w > barL) w.rect.x = barL - w.rect.w;
        } else {
          if (w.rect.x < barR) w.rect.x = barR;
        }
      }
      const rawVx = clamp((w.rect.x - px) / dt, -CONFIG.rawDeltaClamp, CONFIG.rawDeltaClamp);
      const rawVy = clamp((w.rect.y - py) / dt, -CONFIG.rawDeltaClamp, CONFIG.rawDeltaClamp);
      const a = CONFIG.flickAlpha;
      w.drag.vx = a * rawVx + (1 - a) * w.drag.vx;
      w.drag.vy = a * rawVy + (1 - a) * w.drag.vy;
      w.prev.x = px;
      w.prev.y = py;
      w.prev.w = w.rect.w;
      w.prev.h = w.rect.h;
      if (w.drag.springCooldown > 0) w.drag.springCooldown -= dt;
      if (w.drag.springPop > 0) w.drag.springPop -= dt;
      if (w.style.closing > 0) w.style.closing += dt;
    }
    if (world.marquee.cool > 0) world.marquee.cool -= dt;
    world.windows = world.windows.filter((w) => w.style.closing < 0.35);
  }
  function agentIntentSystem(world, dt) {
    const s = world.agent.state;
    if (s.coyote > 0) s.coyote -= dt;
  }
  function kinematicsSystem(world, dt) {
    const a = world.agent;
    a.tf.prev.x = a.tf.pos.x;
    a.tf.prev.y = a.tf.pos.y;
    a.kin.acc.x = 0;
    a.kin.acc.y = CONFIG.gravity * localGravityMultiplier(world);
    if (a.state.fsm === "JUMPING" /* JUMPING */ && a.kin.vel.y >= 0) a.state.fsm = "FALLING" /* FALLING */;
    if (a.state.fsm === "LAUNCHED" /* LAUNCHED */ && a.kin.vel.y >= 0) a.state.fsm = "FALLING" /* FALLING */;
    if (!a.state.grounded && a.kin.vel.y > 0) {
      const cone = nearestCatchCone(world);
      if (cone) a.kin.acc.x += cone;
    }
    a.kin.vel.x += a.kin.acc.x * dt;
    a.kin.vel.y += a.kin.acc.y * dt;
    if (a.state.fsm === "WALL_SLIDING" /* WALL_SLIDING */) {
      a.kin.vel.x = 0;
      a.kin.vel.y = Math.min(a.kin.vel.y, CONFIG.slideMaxFall);
    }
    if (!a.state.grounded) {
      a.tf.pos.x += a.kin.vel.x * dt;
    }
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
    if (marqueeNet(world)) {
      s.wall = 0;
      if (wasGrounded) s.coyote = CONFIG.coyoteTime;
      return;
    }
    const sorted = [...world.windows].sort((w1, w2) => w2.rect.z - w1.rect.z);
    for (const w of sorted) {
      if (w.style.closing > 0) continue;
      const rect = w.rect;
      if (!landedOn && a.kin.vel.y >= 0) {
        const rungY = terminalRungContact(w, a.tf.prev.y + r, a.tf.pos.y + r, a.tf.pos.x);
        if (rungY != null) {
          a.tf.pos.y = rungY - r;
          a.kin.vel.y = 0;
          attach(world, w);
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
          a.kin.vel.x = 0;
          attach(world, w);
          landedOn = w;
          if (fx.support != null && fx.support > 0) {
            a.kin.vel.y = -Math.sqrt(2 * fx.support * 1);
          }
          if (fx.launchVy != null) {
            a.kin.vel.y = fx.launchVy;
            if (fx.forceLaunch) {
              detach(world, w);
              a.state.fsm = "LAUNCHED" /* LAUNCHED */;
              landedOn = null;
              cueLaunch();
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
          a.kin.vel.x = 0;
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
    if (s.grounded && s.groundEntity != null) {
      const gw = world.windows.find((w) => w.id === s.groundEntity);
      if (gw) {
        const upwardFlick = gw.drag.vy < -CONFIG.flickThreshold;
        const overSpeed = !upwardFlick && Math.abs(gw.drag.vx) > CONFIG.slipThreshold;
        if (overSpeed) {
          if (s.wobble <= 0) s.wobble = FLOW.slip.wobbleTime;
          s.wobble -= dt;
          if (s.wobble <= 0) {
            s.grounded = false;
            s.groundEntity = null;
            a.kin.vel.x = 0;
            a.kin.vel.y = Math.max(a.kin.vel.y, 0);
            a.state.fsm = "FALLING" /* FALLING */;
            cueSlip();
            s.wall = newWall;
            return;
          }
        } else {
          s.wobble = 0;
        }
        if (gw.arch.kind === "SPAWN" /* SPAWN */) {
          if (s.spawnDwell === 0) {
            const sp = GAME.spawn;
            s.ejectVx = sp.ejectVxMin + Math.random() * (sp.ejectVxMax - sp.ejectVxMin);
            s.ejectVy = sp.ejectVyMin + Math.random() * (sp.ejectVyMax - sp.ejectVyMin);
          }
          s.spawnDwell += dt;
          if (s.spawnDwell >= GAME.spawn.dwell) {
            s.spawnDwell = 0;
            detach(world, gw);
            const toCenter = gw.rect.x + gw.rect.w / 2 < world.width / 2 ? 1 : -1;
            a.kin.vel.x = toCenter * s.ejectVx;
            a.kin.vel.y = s.ejectVy;
            a.state.fsm = "LAUNCHED" /* LAUNCHED */;
            cueLaunch();
            s.wall = newWall;
            return;
          }
          s.localOffsetX = gw.rect.w / 2;
          a.tf.pos.x = gw.rect.x + s.localOffsetX;
          a.tf.pos.y = gw.rect.y - r;
          a.kin.vel.x = 0;
          s.wall = newWall;
          return;
        }
        s.localOffsetX += s.dir * CONFIG.patrolSpeed * dt;
        const lo = r;
        const hi = gw.rect.w - r;
        if (s.localOffsetX <= lo) {
          s.localOffsetX = lo;
          s.dir = 1;
          edgeLeap(world, gw);
        } else if (s.localOffsetX >= hi) {
          s.localOffsetX = hi;
          s.dir = -1;
          edgeLeap(world, gw);
        }
        if (s.grounded) {
          a.tf.pos.x = gw.rect.x + s.localOffsetX;
          a.tf.pos.y = gw.rect.y - r;
          a.kin.vel.x = 0;
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
  function attach(world, w) {
    const s = world.agent.state;
    const fresh = !s.grounded || s.groundEntity !== w.id;
    s.grounded = true;
    s.groundEntity = w.id;
    if (fresh) {
      s.localOffsetX = clamp(
        world.agent.tf.pos.x - w.rect.x,
        world.agent.shape.radius,
        w.rect.w - world.agent.shape.radius
      );
      s.wobble = 0;
      cueLand();
      if (launchTracker.lastLaunchWin != null && launchTracker.lastLaunchWin !== w.id) {
        launchTracker.landedElsewhere = true;
      }
    }
  }
  function detach(world, w) {
    const a = world.agent;
    const s = a.state;
    const inherited = clamp(
      w.drag.vx * CONFIG.detachDamping,
      -CONFIG.detachMaxVx,
      CONFIG.detachMaxVx
    );
    a.kin.vel.x = inherited + s.dir * CONFIG.patrolSpeed;
    if (!w.arch.protectedWin) {
      launchTracker.lastLaunchWin = w.id;
      launchTracker.landedElsewhere = false;
    }
    s.grounded = false;
    s.groundEntity = null;
    s.spawnDwell = 0;
    s.wobble = 0;
  }
  function edgeLeap(world, w) {
    const a = world.agent;
    detach(world, w);
    a.kin.vel.y = -CONFIG.edgeJumpImpulse;
    a.state.fsm = "JUMPING" /* JUMPING */;
  }
  function nearestCatchCone(world) {
    const a = world.agent;
    const c = FLOW.catchCone;
    let best = null;
    let bestDy = Infinity;
    for (const w of world.windows) {
      if (w.style.closing > 0 || w.drag.grabbed) continue;
      const feet = a.tf.pos.y + a.shape.radius;
      const dy = w.rect.y - feet;
      if (dy < 0 || dy > c.height) continue;
      const left = w.rect.x - c.halfWidth;
      const right = w.rect.x + w.rect.w + c.halfWidth;
      if (a.tf.pos.x < left || a.tf.pos.x > right) continue;
      if (dy < bestDy) {
        bestDy = dy;
        const center = w.rect.x + w.rect.w / 2;
        const dir = Math.sign(center - a.tf.pos.x);
        const strength = 1 - dy / c.height;
        best = dir * c.pull * strength;
      }
    }
    return best ?? 0;
  }
  function springPopWindow(world, w) {
    if (w.arch.protectedWin || w.style.closing > 0) return false;
    if (w.drag.springCooldown > 0) return false;
    w.drag.springCooldown = FLOW.spring.cooldown;
    w.drag.springPop = 0.18;
    w.drag.grabbed = false;
    const a = world.agent;
    const s = a.state;
    if (s.grounded && s.groundEntity === w.id) {
      detach(world, w);
      a.kin.vel.y = -FLOW.spring.impulse;
      a.kin.vel.x = s.dir * CONFIG.patrolSpeed;
      s.fsm = "LAUNCHED" /* LAUNCHED */;
      cueSpring();
      return true;
    }
    cueSpring();
    return false;
  }
  function marqueeNet(world) {
    const m = world.marquee;
    if (!m.active) return false;
    if (m.cool > 0) return false;
    const a = world.agent;
    const s = a.state;
    if (s.grounded || a.kin.vel.y <= 0) return false;
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
      a.kin.vel.y = bounce;
      s.fsm = "LAUNCHED" /* LAUNCHED */;
      m.cool = 0.25;
      cueNet();
      return true;
    }
    return false;
  }
  function tryLaunch(world, w) {
    const a = world.agent;
    const vy = w.drag.vy;
    if (vy < -CONFIG.flickThreshold) {
      detach(world, w);
      let e = CONFIG.restitution;
      if (w.arch.kind === "ALERT" /* ALERT */ && w.arch.alertTimer > 0) {
        e *= GAME.alert.earlyRestitution;
      }
      a.kin.vel.y = clamp(vy * e, -CONFIG.launchMax, 0);
      a.state.fsm = "LAUNCHED" /* LAUNCHED */;
      cueLaunch();
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

  // src/game.ts
  function makeGameState() {
    return {
      phase: "PLAYING" /* PLAYING */,
      integrity: GAME.integrityStart,
      ram: 0,
      leakedRam: 0,
      spawnId: null,
      sinkId: null,
      freeze: 0,
      message: "",
      messageTtl: 0,
      wins: 0,
      resets: 0,
      gcSweeps: 0,
      streak: 1,
      combo: 0,
      comboTtl: 0,
      speedMul: 1,
      shake: 0,
      spawnPick: 0
    };
  }
  var SINK_W = 200;
  var SINK_H = 150;
  var SPAWNABLE_KINDS = [
    "PLAIN" /* PLAIN */,
    "TERMINAL" /* TERMINAL */,
    "MEDIA" /* MEDIA */,
    "EDITOR" /* EDITOR */,
    "ALERT" /* ALERT */
  ];
  function spawnableLabel(kind) {
    switch (kind) {
      case "PLAIN" /* PLAIN */:
        return "scratch.win";
      case "TERMINAL" /* TERMINAL */:
        return "bash";
      case "MEDIA" /* MEDIA */:
        return "player.fm";
      case "EDITOR" /* EDITOR */:
        return "notes.txt";
      case "ALERT" /* ALERT */:
        return "Temp Alert";
      default:
        return "window";
    }
  }
  function hueFor(kind) {
    switch (kind) {
      case "PLAIN" /* PLAIN */:
        return 265;
      case "TERMINAL" /* TERMINAL */:
        return 150;
      case "MEDIA" /* MEDIA */:
        return 320;
      case "EDITOR" /* EDITOR */:
        return 50;
      case "ALERT" /* ALERT */:
        return 35;
      default:
        return 210;
    }
  }
  function randomSinkPosition(world) {
    const barR = world.firewallX + world.firewallW / 2;
    const minX = barR + 30;
    const maxX = world.width - SINK_W - 10;
    const topMin = 70;
    const botMax = world.height - GAME.taskbarH - SINK_H - 10;
    const x = minX + Math.random() * Math.max(0, maxX - minX);
    const edge = Math.floor(Math.random() * 3);
    let y;
    if (edge === 0) y = topMin;
    else if (edge === 1) y = (topMin + botMax) / 2;
    else y = botMax;
    y = Math.max(topMin, Math.min(botMax, y));
    return { x: Math.max(minX, Math.min(maxX, x)), y };
  }
  function relocateSink(world, g) {
    const sink = world.windows.find((w) => w.id === g.sinkId);
    if (!sink) return;
    const pos = randomSinkPosition(world);
    const sx = world.firewallSafeX(pos.x, sink.rect.w);
    sink.rect.x = sx;
    sink.rect.y = pos.y;
    sink.prev.x = sx;
    sink.prev.y = pos.y;
  }
  function buildLevel(world, g) {
    world.windows = [];
    const spawn = world.spawnWindow(40, 110, 190, 96, "Download_Manager", 205, "SPAWN" /* SPAWN */);
    g.spawnId = spawn.id;
    const pos = randomSinkPosition(world);
    const sink = world.spawnWindow(pos.x, pos.y, SINK_W, SINK_H, "Backup_Drive (D:)", 135, "SINK" /* SINK */);
    g.sinkId = sink.id;
    world.spawnWindow(300, 250, 170, 110, "bash", 150, "TERMINAL" /* TERMINAL */);
    world.spawnWindow(520, 320, 150, 110, "player.fm", 320, "MEDIA" /* MEDIA */);
    world.spawnWindow(250, 430, 160, 100, "Temp Alert", 35, "ALERT" /* ALERT */);
    placePacketAtSpawn(world, g);
    g.phase = "PLAYING" /* PLAYING */;
    g.integrity = GAME.integrityStart;
    g.leakedRam = 0;
  }
  function auxWindowCount(world) {
    let n = 0;
    for (const w of world.windows) {
      if (w.style.closing > 0 || w.arch.protectedWin) continue;
      n++;
    }
    return n;
  }
  function placePacketAtSpawn(world, g) {
    const spawn = world.windows.find((w) => w.id === g.spawnId);
    const a = world.agent;
    const px = spawn ? spawn.rect.x + spawn.rect.w - 24 : world.width * 0.1;
    const py = spawn ? spawn.rect.y - a.shape.radius : 80;
    a.tf.pos.x = px;
    a.tf.pos.y = py;
    a.tf.prev.x = px;
    a.tf.prev.y = py;
    a.kin.vel.x = CONFIG.patrolSpeed;
    a.kin.vel.y = 0;
    a.state.grounded = false;
    a.state.groundEntity = null;
    a.state.localOffsetX = 0;
    a.state.dir = 1;
    a.state.spawnDwell = 0;
  }
  function baseRam(world) {
    let ram = 0;
    for (const w of world.windows) {
      if (w.style.closing > 0) continue;
      if (w.arch.protectedWin) continue;
      ram += GAME.ramPerWindow + w.rect.w * w.rect.h * GAME.ramPerArea;
    }
    return ram;
  }
  function totalRam(world, g) {
    const marqueeCost = world.marquee.active ? FLOW.marquee.ramCost : 0;
    return Math.min(GAME.ramMax, baseRam(world) + g.leakedRam + marqueeCost);
  }
  function canSpawn(world, g) {
    const used = g ? totalRam(world, g) : baseRam(world);
    return used < GAME.ramSpawnBlock;
  }
  function emergencyGc(world, g) {
    for (const w of world.windows) {
      if (w.arch.protectedWin) continue;
      if (w.style.closing === 0) w.style.closing = 1e-4;
    }
    const a = world.agent;
    a.state.grounded = false;
    a.state.groundEntity = null;
    g.leakedRam = 0;
    g.gcSweeps++;
    banner(g, "\u26A0 OUT OF MEMORY \u2014 GC SWEEP", 1.4);
    cueGcSweep();
  }
  function banner(g, msg, ttl = 1.6) {
    g.message = msg;
    g.messageTtl = ttl;
  }
  var BASE_PATROL = CONFIG.patrolSpeed;
  function processRecycle(world, g, dt) {
    if (launchTracker.landedElsewhere && launchTracker.lastLaunchWin != null) {
      const src = world.windows.find((w) => w.id === launchTracker.lastLaunchWin);
      if (src && !src.arch.protectedWin && src.drag.recycleTimer === 0 && src.style.closing === 0) {
        src.drag.recycleTimer = FLOW.recycle.decommission;
      }
      launchTracker.landedElsewhere = false;
      launchTracker.lastLaunchWin = null;
    }
    if (g.comboTtl > 0) {
      g.comboTtl -= dt;
      if (g.comboTtl <= 0) g.combo = 0;
    }
    for (const w of world.windows) {
      if (w.drag.recycleTimer > 0) {
        w.drag.recycleTimer -= dt;
        if (w.drag.recycleTimer <= 0 && w.style.closing === 0) {
          w.style.closing = 1e-4;
          g.leakedRam = Math.max(0, g.leakedRam - GAME.ramPerWindow);
          g.combo = Math.min(FLOW.recycle.comboMax, g.combo + 1);
          g.comboTtl = FLOW.recycle.comboWindow;
          cueRecycle();
        }
      }
    }
  }
  function gameSystem(world, g, dt) {
    if (g.messageTtl > 0) g.messageTtl -= dt;
    CONFIG.patrolSpeed = BASE_PATROL * g.speedMul;
    if (g.shake > 0) g.shake = Math.max(0, g.shake - FLOW.pacing.shakeDecay * dt);
    processRecycle(world, g, dt);
    const openCount = auxWindowCount(world);
    g.leakedRam += GAME.ramLeakPerWindow * openCount * dt;
    g.ram = totalRam(world, g);
    if (g.ram >= GAME.ramMax && openCount > 0) {
      emergencyGc(world, g);
      g.ram = totalRam(world, g);
    }
    if (g.phase !== "PLAYING" /* PLAYING */) {
      g.freeze -= dt;
      if (g.freeze <= 0) {
        if (g.phase === "DISSOLVING" /* DISSOLVING */) {
          g.resets++;
          placePacketAtSpawn(world, g);
        }
        if (g.phase === "WON" /* WON */) {
          g.wins++;
          relocateSink(world, g);
          placePacketAtSpawn(world, g);
        }
        g.phase = "PLAYING" /* PLAYING */;
      }
      return;
    }
    const a = world.agent;
    const sink = world.windows.find((w) => w.id === g.sinkId);
    if (sink && overlapsDropZone(a.tf.pos.x, a.tf.pos.y, a.shape.radius, sink)) {
      g.phase = "WON" /* WON */;
      g.freeze = GAME.winFreeze;
      g.streak = Math.min(FLOW.pacing.streakMax, g.streak + 1);
      g.speedMul = Math.min(FLOW.pacing.speedupMax, g.speedMul * (1 + FLOW.pacing.speedupPerWin));
      g.shake = FLOW.pacing.shakeOnWin;
      banner(g, `PACKET DELIVERED \u2713  ${g.streak}x`, GAME.winFreeze);
      cueDeliverChord((g.streak - 1) * 2);
      return;
    }
    const killY = world.height - GAME.taskbarH;
    if (a.tf.pos.y - a.shape.radius > killY) {
      g.integrity -= GAME.integrityPenalty;
      g.streak = 1;
      if (g.integrity <= 0) {
        g.integrity = 0;
        g.phase = "DISSOLVING" /* DISSOLVING */;
        g.freeze = 0.9;
        banner(g, "PACKET DISSOLVED \u2014 restarting", 0.9);
        cueDissolve();
      } else {
        banner(g, `DATA INTEGRITY ${g.integrity}%`, 1.2);
        cueIntegrityLoss();
        placePacketAtSpawn(world, g);
      }
    }
  }
  function predictFlickArc(world) {
    const a = world.agent;
    if (!a.state.grounded || a.state.groundEntity == null) return [];
    const gw = world.windows.find((w) => w.id === a.state.groundEntity);
    if (!gw || !gw.drag.grabbed) return [];
    const vy = gw.drag.vy;
    if (vy >= -CONFIG.flickThreshold) return [];
    let e = CONFIG.restitution;
    if (gw.arch.kind === "ALERT" /* ALERT */ && gw.arch.alertTimer > 0) e *= GAME.alert.earlyRestitution;
    const launchVy = Math.max(-CONFIG.launchMax, vy * e);
    const launchVx = clampNum(gw.drag.vx * CONFIG.detachDamping, -CONFIG.detachMaxVx, CONFIG.detachMaxVx) + a.state.dir * CONFIG.patrolSpeed;
    const pts = [];
    let px = a.tf.pos.x, py = a.tf.pos.y;
    let pvx = launchVx, pvy = launchVy;
    const dt = CONFIG.dt * 4;
    for (let i = 0; i < 28; i++) {
      pvy += CONFIG.gravity * dt;
      px += pvx * dt;
      py += pvy * dt;
      if (py > world.height || px < 0 || px > world.width) break;
      if (i % 2 === 0) pts.push({ x: px, y: py });
    }
    return pts;
  }
  function clampNum(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
  }
  function overlapsDropZone(x, y, r, sink) {
    const zx = sink.rect.x;
    const zy = sink.rect.y + sink.drag.titleBarH;
    const zw = sink.rect.w;
    const zh = sink.rect.h - sink.drag.titleBarH;
    return x + r > zx && x - r < zx + zw && y + r > zy && y - r < zy + zh;
  }

  // src/render.ts
  var KIND_TAG = {
    ["PLAIN" /* PLAIN */]: "",
    ["TERMINAL" /* TERMINAL */]: " [sh]",
    ["MEDIA" /* MEDIA */]: " [\u266A]",
    ["EDITOR" /* EDITOR */]: " [txt]",
    ["BSOD" /* BSOD */]: " [ERR]",
    ["SPAWN" /* SPAWN */]: " [SRC]",
    ["SINK" /* SINK */]: " [DST]",
    ["ALERT" /* ALERT */]: " [!]"
  };
  function render(ctx2, world, game) {
    ctx2.clearRect(0, 0, world.width, world.height);
    ctx2.save();
    if (game && game.shake > 0) {
      const s = game.shake;
      ctx2.translate((Math.random() * 2 - 1) * s, (Math.random() * 2 - 1) * s);
    }
    ctx2.fillStyle = "#0b1020";
    ctx2.fillRect(-20, -20, world.width + 40, world.height + 40);
    drawGrid(ctx2, world);
    drawFirewall(ctx2, world);
    const sorted = [...world.windows].sort((a2, b) => a2.rect.z - b.rect.z);
    for (const w of sorted) {
      const fade = w.style.closing > 0 ? Math.max(0, 1 - w.style.closing / 0.35) : 1;
      const decommission = w.drag.recycleTimer > 0;
      const blink = decommission ? 0.55 + 0.45 * Math.sin(w.drag.recycleTimer * 18) : 1;
      ctx2.globalAlpha = fade * (decommission ? blink : 1);
      const r = w.rect;
      ctx2.fillStyle = decommission ? "hsl(135 45% 22%)" : `hsl(${w.style.hue} 30% 16%)`;
      ctx2.fillRect(r.x, r.y, r.w, r.h);
      ctx2.strokeStyle = decommission ? "#6cff9a" : `hsl(${w.style.hue} 60% 55%)`;
      ctx2.lineWidth = 2;
      ctx2.strokeRect(r.x, r.y, r.w, r.h);
      if (w.style.closing > 0) {
        ctx2.fillStyle = "rgba(120,255,170,0.5)";
        const prog = w.style.closing / 0.35;
        for (let yy = 0; yy < r.h; yy += 4) {
          for (let xx = 0; xx < r.w; xx += 4) {
            if ((xx + yy) / 4 % 3 === 0 && Math.random() < prog) ctx2.fillRect(r.x + xx, r.y + yy, 3, 3);
          }
        }
      }
      drawArchetype(ctx2, w);
      let barL = 42;
      if (w.arch.kind === "MEDIA" /* MEDIA */) barL = 42 + 28 * w.arch.beatPulse;
      if (decommission) barL = 50;
      if (w.arch.kind === "BSOD" /* BSOD */) {
        const frac = Math.max(0, w.arch.crumble / w.arch.crumbleMax);
        const flick = frac < 0.4 ? Math.sin(w.arch.crumbleMax * 40 - frac * 60) > 0 ? 55 : 25 : 42;
        barL = flick;
      }
      ctx2.fillStyle = `hsl(${w.style.hue} 55% ${barL}%)`;
      ctx2.fillRect(r.x, r.y, r.w, w.drag.titleBarH);
      ctx2.fillStyle = "#eaf0ff";
      ctx2.font = "13px system-ui, sans-serif";
      ctx2.fillText(w.style.title + KIND_TAG[w.arch.kind], r.x + 8, r.y + 18);
      ctx2.fillStyle = "#e4607a";
      ctx2.fillRect(r.x + r.w - 20, r.y + 6, 14, 14);
      ctx2.fillStyle = "#2a0c12";
      ctx2.fillText("x", r.x + r.w - 17, r.y + 18);
      ctx2.globalAlpha = 1;
    }
    if (game) {
      const arc = predictFlickArc(world);
      for (let i = 0; i < arc.length; i++) {
        const p = arc[i];
        const t = 1 - i / arc.length;
        ctx2.globalAlpha = 0.3 + 0.5 * t;
        ctx2.fillStyle = "#ffe08a";
        ctx2.beginPath();
        ctx2.arc(p.x, p.y, 3, 0, Math.PI * 2);
        ctx2.fill();
      }
      ctx2.globalAlpha = 1;
    }
    drawMarquee(ctx2, world);
    const a = world.agent;
    const dissolving = game?.phase === "DISSOLVING" /* DISSOLVING */;
    const wobbling = a.state.wobble > 0;
    ctx2.globalAlpha = dissolving ? Math.max(0, game.freeze / 0.9) : 1;
    ctx2.save();
    ctx2.translate(a.tf.pos.x, a.tf.pos.y);
    if (wobbling) {
      ctx2.rotate(Math.sin(Date.now() / 30) * 0.5);
    }
    ctx2.beginPath();
    ctx2.arc(0, 0, a.shape.radius, 0, Math.PI * 2);
    ctx2.fillStyle = wobbling ? "#ffd166" : stateColor(a.state.fsm);
    ctx2.fill();
    ctx2.lineWidth = 2;
    ctx2.strokeStyle = "#ffffff";
    ctx2.stroke();
    ctx2.fillStyle = "#0b1020";
    ctx2.font = "9px ui-monospace, monospace";
    ctx2.fillText("0", -2.5, 3);
    ctx2.restore();
    if (wobbling) {
      ctx2.fillStyle = "#ffd166";
      ctx2.font = "14px system-ui, sans-serif";
      ctx2.fillText("\u26A0", a.tf.pos.x - 6, a.tf.pos.y - a.shape.radius - 6);
    }
    ctx2.globalAlpha = 1;
    drawTaskbar(ctx2, world, game);
    ctx2.restore();
    if (game) drawGameHud(ctx2, world, game);
    else drawHud(ctx2, world);
  }
  function drawMarquee(ctx2, world) {
    const m = world.marquee;
    if (!m.active) return;
    const x = Math.min(m.x0, m.x1), y = Math.min(m.y0, m.y1);
    const w = Math.abs(m.x1 - m.x0), h = Math.abs(m.y1 - m.y0);
    ctx2.fillStyle = "rgba(90,150,255,0.15)";
    ctx2.fillRect(x, y, w, h);
    ctx2.strokeStyle = "rgba(130,180,255,0.9)";
    ctx2.lineWidth = 1;
    ctx2.strokeRect(x + 0.5, y + 0.5, w, h);
    ctx2.strokeStyle = "#8fd0ff";
    ctx2.lineWidth = 3;
    ctx2.beginPath();
    ctx2.moveTo(x, y);
    ctx2.lineTo(x + w, y);
    ctx2.stroke();
  }
  function drawTaskbar(ctx2, world, game) {
    const h = GAME.taskbarH;
    const y = world.height - h;
    ctx2.fillStyle = "#141b2e";
    ctx2.fillRect(0, y, world.width, h);
    ctx2.strokeStyle = game && game.integrity <= 40 ? "rgba(255,90,90,0.8)" : "rgba(255,255,255,0.15)";
    ctx2.setLineDash([6, 6]);
    ctx2.lineWidth = 1;
    ctx2.beginPath();
    ctx2.moveTo(0, y);
    ctx2.lineTo(world.width, y);
    ctx2.stroke();
    ctx2.setLineDash([]);
    ctx2.fillStyle = "#7f8db0";
    ctx2.font = "11px ui-monospace, monospace";
    ctx2.fillText("\u25A3 taskbar \u2014 falling past this line costs Data Integrity", 10, y + 18);
  }
  function drawArchetype(ctx2, w) {
    const r = w.rect;
    switch (w.arch.kind) {
      case "TERMINAL" /* TERMINAL */: {
        const g = w.arch.gravityField;
        ctx2.fillStyle = g < 1 ? "rgba(120,200,255,0.08)" : g > 1 ? "rgba(255,150,120,0.08)" : "transparent";
        ctx2.fillRect(r.x, r.y - 120, r.w, 120);
        ctx2.fillStyle = "#6cff9a";
        ctx2.font = "11px ui-monospace, monospace";
        ctx2.fillText(g < 1 ? "> setgravity low" : g > 1 ? "> setgravity high" : "> _", r.x + 8, r.y + w.drag.titleBarH + 14);
        for (const rung of w.arch.rungs) {
          const y = r.y + rung.localY;
          const alpha = Math.min(1, rung.life);
          ctx2.globalAlpha = alpha;
          ctx2.fillStyle = "#9ad9ff";
          ctx2.fillRect(r.x + r.w * 0.15, y - 3, rung.w, 6);
          ctx2.globalAlpha = 1;
        }
        break;
      }
      case "MEDIA" /* MEDIA */: {
        ctx2.strokeStyle = "#ff8ad0";
        ctx2.lineWidth = 2;
        const bars = 16;
        for (let i = 0; i < bars; i++) {
          const bx = r.x + 10 + i / bars * (r.w - 20);
          const amp = (0.3 + 0.7 * Math.abs(Math.sin(i * 1.3 + w.arch.phase * 6))) * w.arch.beatPulse;
          const bh = 6 + amp * (r.h - w.drag.titleBarH - 20);
          ctx2.beginPath();
          ctx2.moveTo(bx, r.y + r.h - 10);
          ctx2.lineTo(bx, r.y + r.h - 10 - bh);
          ctx2.stroke();
        }
        break;
      }
      case "EDITOR" /* EDITOR */: {
        const fillFrac = (w.arch.chars - 10) / (180 - 10);
        ctx2.fillStyle = "rgba(255,230,120,0.12)";
        ctx2.fillRect(r.x, r.y + r.h - 6, r.w * fillFrac, 6);
        if (w.arch.buoyancy > 0) {
          ctx2.fillStyle = "rgba(120,255,200,0.10)";
          ctx2.fillRect(r.x, r.y - 30, r.w, 30);
        }
        break;
      }
      case "BSOD" /* BSOD */: {
        const frac = Math.max(0, w.arch.crumble / w.arch.crumbleMax);
        ctx2.fillStyle = frac < 0.4 ? "#ff5b5b" : "#ffd166";
        ctx2.fillRect(r.x, r.y + r.h - 5, r.w * frac, 5);
        ctx2.fillStyle = "#eaf0ff";
        ctx2.font = "12px ui-monospace, monospace";
        ctx2.fillText(":( FATAL_EXCEPTION", r.x + 10, r.y + r.h / 2);
        break;
      }
      case "SPAWN" /* SPAWN */: {
        ctx2.fillStyle = "#7fd0ff";
        ctx2.fillRect(r.x + r.w - 10, r.y - 6, 10, 10);
        ctx2.fillStyle = "#9fb0d0";
        ctx2.font = "11px ui-monospace, monospace";
        ctx2.fillText("\u2193 downloading \u2192 EJECT \u2192", r.x + 10, r.y + r.h / 2);
        break;
      }
      case "SINK" /* SINK */: {
        const zy = r.y + w.drag.titleBarH;
        const pulse = 0.12 + 0.08 * Math.abs(Math.sin(Date.now() / 300));
        ctx2.fillStyle = `rgba(120,255,170,${pulse})`;
        ctx2.fillRect(r.x, zy, r.w, r.h - w.drag.titleBarH);
        ctx2.strokeStyle = "rgba(120,255,170,0.6)";
        ctx2.setLineDash([5, 4]);
        ctx2.strokeRect(r.x + 4, zy + 4, r.w - 8, r.h - w.drag.titleBarH - 8);
        ctx2.setLineDash([]);
        ctx2.fillStyle = "#bfffe0";
        ctx2.font = "12px ui-monospace, monospace";
        ctx2.fillText("DROP ZONE", r.x + r.w / 2 - 34, zy + (r.h - w.drag.titleBarH) / 2);
        break;
      }
      case "ALERT" /* ALERT */: {
        const frac = Math.max(0, w.arch.alertTimer / w.arch.alertMax);
        ctx2.fillStyle = frac > 0.3 ? "#8affc0" : "#ff6b6b";
        ctx2.fillRect(r.x, r.y + r.h - 5, r.w * frac, 5);
        ctx2.fillStyle = "#ffe08a";
        ctx2.font = "12px ui-monospace, monospace";
        ctx2.fillText(`\u26A0 ${w.arch.alertTimer.toFixed(1)}s  +50% if flicked`, r.x + 8, r.y + r.h / 2);
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
  function drawFirewall(ctx2, world) {
    const x = world.firewallX - world.firewallW / 2;
    const bottom = world.height - GAME.taskbarH;
    const grad = ctx2.createLinearGradient(x, 0, x + world.firewallW, 0);
    grad.addColorStop(0, "rgba(255,90,90,0.15)");
    grad.addColorStop(0.5, "rgba(255,120,120,0.55)");
    grad.addColorStop(1, "rgba(255,90,90,0.15)");
    ctx2.fillStyle = grad;
    ctx2.fillRect(x, 0, world.firewallW, bottom);
    ctx2.strokeStyle = "rgba(255,170,170,0.35)";
    ctx2.lineWidth = 2;
    for (let y = 0; y < bottom; y += 16) {
      ctx2.beginPath();
      ctx2.moveTo(x, y);
      ctx2.lineTo(x + world.firewallW, y + 8);
      ctx2.stroke();
    }
    ctx2.save();
    ctx2.translate(world.firewallX, bottom - 8);
    ctx2.rotate(-Math.PI / 2);
    ctx2.fillStyle = "rgba(255,200,200,0.7)";
    ctx2.font = "10px ui-monospace, monospace";
    ctx2.fillText("FIREWALL", 0, 3);
    ctx2.restore();
  }
  function drawGrid(ctx2, world) {
    ctx2.strokeStyle = "rgba(255,255,255,0.04)";
    ctx2.lineWidth = 1;
    for (let x = 0; x < world.width; x += 40) {
      ctx2.beginPath();
      ctx2.moveTo(x, 0);
      ctx2.lineTo(x, world.height);
      ctx2.stroke();
    }
    for (let y = 0; y < world.height; y += 40) {
      ctx2.beginPath();
      ctx2.moveTo(0, y);
      ctx2.lineTo(world.width, y);
      ctx2.stroke();
    }
  }
  function drawHud(ctx2, world) {
    const a = world.agent;
    ctx2.fillStyle = "#9fb0d0";
    ctx2.font = "12px ui-monospace, monospace";
    const lines = [
      `state: ${a.state.fsm}`,
      `vel:   (${a.kin.vel.x.toFixed(0)}, ${a.kin.vel.y.toFixed(0)})`,
      `ground:${a.state.grounded}  wall:${a.state.wall}`,
      `[sh] gravity+rungs  [\u266A] beat-bounce  [txt] grow/float  [ERR] close=BOOM`
    ];
    lines.forEach((l, i) => ctx2.fillText(l, 10, 16 + i * 15));
  }
  function bar(ctx2, x, y, w, h, frac, fill, label) {
    ctx2.fillStyle = "rgba(255,255,255,0.08)";
    ctx2.fillRect(x, y, w, h);
    ctx2.fillStyle = fill;
    ctx2.fillRect(x, y, w * Math.max(0, Math.min(1, frac)), h);
    ctx2.strokeStyle = "rgba(255,255,255,0.25)";
    ctx2.lineWidth = 1;
    ctx2.strokeRect(x + 0.5, y + 0.5, w, h);
    ctx2.fillStyle = "#eaf0ff";
    ctx2.font = "11px ui-monospace, monospace";
    ctx2.fillText(label, x, y - 4);
  }
  function drawGameHud(ctx2, world, g) {
    ctx2.fillStyle = "#eaf0ff";
    ctx2.font = "13px system-ui, sans-serif";
    ctx2.fillText("KERNEL RUN \u2014 deliver the packet to Backup_Drive (D:)", 10, 20);
    const integCol = g.integrity > 60 ? "#6cff9a" : g.integrity > 30 ? "#ffd166" : "#ff6b6b";
    bar(ctx2, 10, 40, 180, 12, g.integrity / GAME.integrityStart, integCol, `Data Integrity ${g.integrity}%`);
    const ramFrac = g.ram / GAME.ramMax;
    const ramCol = ramFrac < 0.75 ? "#7fd0ff" : ramFrac < 0.96 ? "#ffd166" : "#ff6b6b";
    const leakTag = g.leakedRam > 0.5 ? ` (leak +${g.leakedRam.toFixed(0)})` : "";
    bar(ctx2, 10, 72, 180, 12, ramFrac, ramCol, `Memory Usage ${g.ram.toFixed(0)}%${leakTag}`);
    if (ramFrac >= GAME.ramSpawnBlock / GAME.ramMax) {
      ctx2.fillStyle = "#ff9b9b";
      ctx2.font = "10px ui-monospace, monospace";
      ctx2.fillText("RAM critical \u2014 close windows (X) before GC sweep!", 10, 98);
    }
    ctx2.fillStyle = "#7f8db0";
    ctx2.font = "11px ui-monospace, monospace";
    ctx2.fillText(`delivered: ${g.wins}  resets: ${g.resets}  GC: ${g.gcSweeps}`, world.width - 230, 20);
    ctx2.fillStyle = g.streak > 1 ? "#ffd166" : "#7f8db0";
    ctx2.font = "600 15px system-ui, sans-serif";
    ctx2.fillText(`STREAK ${g.streak}x`, world.width - 230, 40);
    if (g.combo > 0) {
      ctx2.fillStyle = "#6cff9a";
      ctx2.font = "12px ui-monospace, monospace";
      ctx2.fillText(`recycle combo ${g.combo}x`, world.width - 230, 58);
    }
    ctx2.fillStyle = "#7f8db0";
    ctx2.font = "10px ui-monospace, monospace";
    ctx2.fillText(`speed ${(g.speedMul * 100).toFixed(0)}%`, world.width - 230, 74);
    const nextKind = SPAWNABLE_KINDS[g.spawnPick];
    ctx2.fillStyle = "#cfd8ec";
    ctx2.font = "11px ui-monospace, monospace";
    ctx2.fillText(`spawn \u25B8 ${spawnableLabel(nextKind)}  (wheel to change, dbl-click to place)`, 10, world.height - GAME.taskbarH - 10);
    if (g.messageTtl > 0 && g.message) {
      ctx2.globalAlpha = Math.min(1, g.messageTtl * 2);
      ctx2.fillStyle = g.phase === "WON" /* WON */ ? "#6cff9a" : "#ffd166";
      ctx2.font = "600 22px system-ui, sans-serif";
      const tw = ctx2.measureText(g.message).width;
      ctx2.fillText(g.message, (world.width - tw) / 2, world.height / 2 - 40);
      ctx2.globalAlpha = 1;
    }
    const spawn = world.windows.find((w) => w.id === g.spawnId);
    if (spawn && world.agent.state.grounded && world.agent.state.groundEntity === spawn.id) {
      const frac = Math.min(1, world.agent.state.spawnDwell / GAME.spawn.dwell);
      ctx2.fillStyle = "rgba(127,208,255,0.25)";
      ctx2.fillRect(spawn.rect.x, spawn.rect.y - 8, spawn.rect.w, 5);
      ctx2.fillStyle = "#7fd0ff";
      ctx2.fillRect(spawn.rect.x, spawn.rect.y - 8, spawn.rect.w * frac, 5);
    }
    const sink = world.windows.find((w) => w.id === g.sinkId);
    const a = world.agent;
    if (sink && !overlapsDropZone(a.tf.pos.x, a.tf.pos.y, a.shape.radius, sink)) {
      ctx2.fillStyle = "rgba(120,255,170,0.5)";
      ctx2.font = "11px ui-monospace, monospace";
      ctx2.fillText("\u2192 goal", sink.rect.x - 4, sink.rect.y - 8);
    }
  }

  // src/main.ts
  function boot(canvas) {
    const ctx2 = canvas.getContext("2d");
    const world = new World(canvas.width, canvas.height);
    const game = makeGameState();
    buildLevel(world, game);
    const setPos = (e) => {
      const rect = canvas.getBoundingClientRect();
      world.pointer.x = (e.clientX - rect.left) * (canvas.width / rect.width);
      world.pointer.y = (e.clientY - rect.top) * (canvas.height / rect.height);
    };
    let pressT = 0, pressX = 0, pressY = 0, pressWin = false, marqueeStarted = false;
    canvas.addEventListener("pointerdown", (e) => {
      initAudio();
      setPos(e);
      world.pointer.down = true;
      world.pointer.pressed = true;
      canvas.setPointerCapture(e.pointerId);
      pressT = performance.now();
      pressX = world.pointer.x;
      pressY = world.pointer.y;
      const hit = world.topWindowAt(world.pointer.x, world.pointer.y);
      pressWin = !!hit;
      marqueeStarted = false;
      if (!hit) {
        world.marquee.active = true;
        world.marquee.x0 = world.pointer.x;
        world.marquee.y0 = world.pointer.y;
        world.marquee.x1 = world.pointer.x;
        world.marquee.y1 = world.pointer.y;
        marqueeStarted = true;
      }
    });
    canvas.addEventListener("pointermove", (e) => {
      setPos(e);
      if (marqueeStarted && world.marquee.active) {
        world.marquee.x1 = world.pointer.x;
        world.marquee.y1 = world.pointer.y;
      }
    });
    canvas.addEventListener("pointerup", (e) => {
      setPos(e);
      world.pointer.down = false;
      world.pointer.released = true;
      const dt = performance.now() - pressT;
      const moved = Math.hypot(world.pointer.x - pressX, world.pointer.y - pressY);
      if (pressWin && dt <= FLOW.spring.clickMaxMs && moved <= FLOW.spring.clickMaxMove) {
        world.springRequest.pending = true;
        world.springRequest.x = pressX;
        world.springRequest.y = pressY;
      }
      world.marquee.active = false;
      marqueeStarted = false;
    });
    window.addEventListener("keydown", (e) => {
      if (e.code === "Space") {
        e.preventDefault();
        world.springRequest.pending = true;
        world.springRequest.x = world.pointer.x;
        world.springRequest.y = world.pointer.y;
      }
    });
    canvas.addEventListener("wheel", (e) => {
      e.preventDefault();
      const n = SPAWNABLE_KINDS.length;
      game.spawnPick = (game.spawnPick + (e.deltaY > 0 ? 1 : n - 1)) % n;
    }, { passive: false });
    canvas.addEventListener("dblclick", (e) => {
      setPos(e);
      const onWindow = world.topWindowAt(world.pointer.x, world.pointer.y);
      if (onWindow) return;
      if (!canSpawn(world, game)) return;
      const kind = SPAWNABLE_KINDS[game.spawnPick];
      const w = 150, h = 90;
      const sx = Math.max(0, world.pointer.x - w / 2);
      world.spawnWindow(sx, Math.max(40, world.pointer.y - h / 2), w, h, spawnableLabel(kind), hueFor(kind), kind);
    });
    let last = performance.now();
    let acc = 0;
    function frame(now) {
      acc += Math.min(0.1, (now - last) / 1e3);
      last = now;
      while (acc >= CONFIG.dt) {
        stepWorld(world, CONFIG.dt);
        gameSystem(world, game, CONFIG.dt);
        acc -= CONFIG.dt;
      }
      render(ctx2, world, game);
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }
  if (typeof document !== "undefined") {
    const el = document.getElementById("stage");
    if (el) boot(el);
  }
})();
