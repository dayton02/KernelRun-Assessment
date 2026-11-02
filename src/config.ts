// Tunable constants. All velocities in px/s, accelerations in px/s^2.
// Values referenced from DESIGN.md Part 3.

export const CONFIG = {
  dt: 1 / 120,            // fixed physics step (frame-rate independent)
  gravity: 2200,

  // patrol
  patrolSpeed: 140,
  edgeJumpImpulse: 620,   // vel.y when leaping a title-bar edge
  coyoteTime: 0.1,        // seconds

  // springboard (DESIGN.md §3.3)
  restitution: 1.6,       // e > 1 => super-elastic trampoline
  launchMin: 450,         // min upward window speed to trigger a launch
  launchMax: 1600,
  jumpAssist: 120,

  // angular coupling (DESIGN.md §3.2)
  kOmega: 0.0005,

  // wall slide (DESIGN.md §3.6)
  slideMaxFall: 260,
  wallFriction: 0.8,

  // flick velocity smoothing (DESIGN.md §3.1)
  flickAlpha: 0.5,

  agentRadius: 9,
};

// Per-archetype tunables (DESIGN.md Part 5). Grouped by window kind.
export const ARCH = {
  terminal: {
    cmdInterval: 2.2,       // seconds between auto-commands
    gravityLo: 0.35,        // `setgravity low`
    gravityHi: 1.8,         // `setgravity high`
    rungLife: 4.0,          // seconds a text rung persists
    rungSpacing: 22,        // vertical px between stacked rungs
    rungThickness: 6,       // collider half-height for a rung
    maxRungs: 5,
    fieldRadius: 60,        // how far below the bar the gravity field reaches past rungs
  },
  media: {
    bpm: 120,
    amplitude: 34,          // px of collider oscillation
    launchGain: 7.0,        // beat-synced launch = amplitude*gain on a peak
    beatWindow: 0.09,       // seconds around the beat that count as "on-beat"
    onBeatBonus: 1.9,       // restitution multiplier if the packet is on-beat
    offBeatBonus: 0.55,     // weak bounce if mistimed
  },
  editor: {
    charsPerSecTyping: 60,  // how fast content "types" while grabbed+shift
    widthPerChar: 2.4,      // px of width added per character
    minChars: 10,
    maxChars: 180,
    frictionFull: 0.9,      // sticky when dense with text
    frictionEmpty: 0.05,    // near-frictionless when nearly empty (ice)
    buoyancyMax: 900,       // upward px/s^2 support when "buoyant" (lots of text)
    buoyancyThreshold: 120, // chars above which the note floats the packet
  },
  bsod: {
    integrity: 2.5,         // seconds before auto-crumble
    blinkRate: 6,           // Hz flicker as it nears collapse
    dismissLaunch: 1500,    // explosive launch speed on force-close
    dismissSpreadX: 480,    // horizontal kick away from the dismiss point
    shardGravity: 0.0,      // crumbled fragments are non-solid
  },
};
