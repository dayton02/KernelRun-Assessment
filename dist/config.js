// Tunable constants. All velocities in px/s, accelerations in px/s^2.
// Values referenced from DESIGN.md Part 3.
export const CONFIG = {
    dt: 1 / 120, // fixed physics step (frame-rate independent)
    gravity: 2200,
    // patrol
    patrolSpeed: 140,
    edgeJumpImpulse: 620, // vel.y when leaping a title-bar edge
    coyoteTime: 0.1, // seconds
    // springboard (DESIGN.md §3.3)
    restitution: 1.6, // e > 1 => super-elastic trampoline
    launchMin: 450, // min upward window speed to trigger a launch
    launchMax: 1600,
    jumpAssist: 120,
    // --- stable moving-platform coupling (see §3.2 rewrite) ---------------
    // Horizontal momentum is transferred ONCE on detachment, never per frame.
    detachDamping: 0.5, // 0.4..0.6: scalar on inherited horizontal velocity
    detachMaxVx: 400, // hard clamp on transferred horizontal velocity (px/s)
    flickThreshold: 350, // |window vy| must exceed this (upward) to launch
    // --- anti-ferry inertial slip (Part 7) --------------------------------
    // A grounded packet loses footing if its window is dragged sideways faster
    // than this WITHOUT an upward flick. Prevents ferrying the packet across the
    // desktop by slow horizontal drag.
    slipThreshold: 120, // |window vx| px/s above which the packet slips off
    // wall slide (DESIGN.md §3.6)
    slideMaxFall: 260,
    wallFriction: 0.8,
    // Window-velocity smoothing. The EMA weight on the newest raw frame delta:
    // lower = smoother / more spike rejection. 0.2 ignores most single-frame
    // jitter while still tracking a sustained drag within a few frames.
    flickAlpha: 0.2,
    // Hard sanity clamp on the raw per-frame delta BEFORE it feeds the EMA, so a
    // single pathological mouse jump can never enter the smoothed estimate.
    rawDeltaClamp: 2500, // px/s
    agentRadius: 9,
};
// Per-archetype tunables (DESIGN.md Part 5). Grouped by window kind.
export const ARCH = {
    terminal: {
        cmdInterval: 2.2, // seconds between auto-commands
        gravityLo: 0.35, // `setgravity low`
        gravityHi: 1.8, // `setgravity high`
        rungLife: 4.0, // seconds a text rung persists
        rungSpacing: 22, // vertical px between stacked rungs
        rungThickness: 6, // collider half-height for a rung
        maxRungs: 5,
        fieldRadius: 60, // how far below the bar the gravity field reaches past rungs
    },
    media: {
        bpm: 120,
        amplitude: 34, // px of collider oscillation
        launchGain: 7.0, // beat-synced launch = amplitude*gain on a peak
        beatWindow: 0.09, // seconds around the beat that count as "on-beat"
        onBeatBonus: 1.9, // restitution multiplier if the packet is on-beat
        offBeatBonus: 0.55, // weak bounce if mistimed
    },
    editor: {
        charsPerSecTyping: 60, // how fast content "types" while grabbed+shift
        widthPerChar: 2.4, // px of width added per character
        minChars: 10,
        maxChars: 180,
        frictionFull: 0.9, // sticky when dense with text
        frictionEmpty: 0.05, // near-frictionless when nearly empty (ice)
        buoyancyMax: 900, // upward px/s^2 support when "buoyant" (lots of text)
        buoyancyThreshold: 120, // chars above which the note floats the packet
    },
    bsod: {
        integrity: 2.5, // seconds before auto-crumble
        blinkRate: 6, // Hz flicker as it nears collapse
        dismissLaunch: 1500, // explosive launch speed on force-close
        dismissSpreadX: 480, // horizontal kick away from the dismiss point
        shardGravity: 0.0, // crumbled fragments are non-solid
    },
};
// ---------------------------------------------------------------------------
// "Kernel Run" game-loop tunables (objective, integrity, RAM, archetypes).
// ---------------------------------------------------------------------------
export const GAME = {
    integrityStart: 100, // Data Integrity %
    integrityPenalty: 25, // % lost each time the packet falls past the taskbar
    taskbarH: 28, // height of the bottom taskbar (the kill line is its top)
    // RAM / Memory Usage constraint
    ramMax: 100, // %
    ramPerWindow: 8, // flat base cost to keep a window open
    ramPerArea: 1 / 1400, // additional % per px^2 of window area
    ramSpawnBlock: 96, // cannot spawn new windows at/above this usage
    // Live memory leak (Part 7): each open non-essential window leaks RAM
    // continuously. Total leak rate = ramLeakPerWindow * openCount per second.
    ramLeakPerWindow: 0.5, // % per second, per open auxiliary window
    // Audio Player pulse (spec: +/-10px every 500ms)
    pulse: {
        amplitude: 10, // px the top edge moves
        halfPeriod: 0.5, // seconds per half-cycle (toggles every 500ms)
        bounceBonus: 1.15, // mild restitution when landing on the rising edge
    },
    // Temp Alert Modal
    alert: {
        countdown: 5.0, // seconds before it auto-closes
        earlyRestitution: 1.5, // +50% launch restitution if flicked before expiry
    },
    // win handling
    winFreeze: 1.2, // seconds of celebration before level reset
    // Source auto-eject (Download_Manager). The packet does not idle-patrol the
    // source forever: after a short dwell it is ejected in a diagonal arc toward
    // the goal side, so the player relays it onward (catch -> flick) instead of
    // trying to coax it off a fixed, undraggable window.
    //
    // The arc is RANDOMIZED within a band each charge so the landing spot isn't
    // rote. Horizontal is always toward the goal side; vertical always upward —
    // only the magnitudes vary, keeping the opening fresh but always "winnable".
    spawn: {
        dwell: 0.9, // seconds grounded on the source before ejection
        ejectVxMin: 240, // horizontal eject speed band (toward goal side)
        ejectVxMax: 460,
        ejectVyMin: -820, // upward component band (more negative = higher)
        ejectVyMax: -560,
    },
};
// ---------------------------------------------------------------------------
// Gameplay-flow overhaul (Part 8). Ergonomics, recovery, recycling, pacing.
// ---------------------------------------------------------------------------
export const FLOW = {
    // 1. Click-to-Spring: a quick click/space pops the hovered idle window up,
    //    launching a resting packet deterministically — no violent mouse drag.
    spring: {
        impulse: 780, // upward packet launch speed on a spring pop (px/s)
        windowKick: -260, // brief visual up-nudge of the window top edge
        cooldown: 0.25, // seconds between spring pops on one window
        clickMaxMs: 220, // press->release under this = a "click" (vs a drag)
        clickMaxMove: 6, // px of pointer travel allowed to still count as a click
    },
    // Catch Cone: a mild gravitational snap pulling a falling packet toward a
    // title bar it is about to land on, rewarding good positioning over pixels.
    catchCone: {
        height: 30, // px above a title bar where the cone acts
        halfWidth: 40, // px to each side of the bar the cone spans
        pull: 1400, // horizontal accel toward the bar center (px/s^2)
    },
    // 2. Marquee Net: drag on empty wallpaper to draw a selection box; its top
    //    edge is a SOFT safety net — a clutch save, not a trampoline floor. It
    //    catches the packet a limited number of times, then is spent and must be
    //    redrawn (which re-pays the RAM cost), so it can't be used as a permanent
    //    bouncy floor.
    marquee: {
        ramCost: 25, // % RAM consumed while a marquee is held (steep)
        restitution: 0.45, // soft, lossy bounce (saves, doesn't launch)
        maxBounceVy: -520, // CAP the upward pop (no rocket launches)
        minBounceVy: -240, // gentle guaranteed nudge so it always "saves"
        charges: 2, // catches before the net is spent
        minSize: 40, // px: ignore small marquees (must commit to a real net)
    },
    // 3. Leapfrog Auto-Recycle: the window a packet LAUNCHED from decommissions
    //    on a timer once the packet lands elsewhere, refunding RAM + combo.
    recycle: {
        decommission: 2.0, // seconds of pulse before it dissolves
        comboWindow: 6.0, // seconds to chain recycles for the combo meter
        comboMax: 8, // cap on the recycle combo multiplier
    },
    // 4. Elastic Slip: fast horizontal drag first wobbles the packet for a grace
    //    window; only continued over-speed drag past it actually slips it off.
    slip: {
        wobbleTime: 0.30, // seconds of telegraphed wobble before detaching
    },
    // 5. Arcade pacing: delivery streak multiplier + difficulty ramp + shake.
    pacing: {
        streakMax: 3, // 1x .. 3x delivery multiplier
        speedupPerWin: 0.05, // +5% base patrol speed per delivery
        speedupMax: 2.5, // cap the ramp at 2.5x base
        shakeOnWin: 10, // screen-shake amplitude (px) on a delivery
        shakeDecay: 6, // per-second shake decay
    },
};
//# sourceMappingURL=config.js.map