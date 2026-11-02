# Kernel Run — prototype

Platforming reframed as real-time window management. You never control the
character. An autonomous data packet runs a finite-state machine across your
"desktop"; you drag, flick, and close application windows to build the terrain
under it. **Kernel Run** is the game loop on top: deliver the packet from a
source window to a destination sink under RAM and Data-Integrity constraints.

Full design rationale, ECS layout, state tables, and the physics math are in
[`DESIGN.md`](./DESIGN.md).

## The game — Kernel Run

- **Objective:** move the packet from **Download_Manager** (source) to the
  **Backup_Drive (D:)** drop zone (goal). Reaching the green drop zone wins and
  advances the level.
- **Data Integrity (starts 100%):** every time the packet falls past the
  **taskbar** at the bottom, you lose 25%. At 0% the packet dissolves and
  restarts at the source.
- **Memory Usage (RAM):** every open window (except the protected source/sink)
  costs RAM **and leaks more every second**. **Double-click empty desktop** to
  spawn a platform — but only if the RAM bar has room. Closing a window (its
  `X`) instantly recovers its memory and slows the leak. Hit **100%** and an
  **emergency GC sweep** closes every auxiliary window and drops the packet.

## Anti-ferry rules — you must flick, not carry

- **Inertial slip:** you can't ferry the packet by slowly dragging its window.
  Drag the carrying window sideways faster than ~120 px/s (without an upward
  flick) and the packet **loses footing and drops straight down**. The only way
  to cover horizontal distance is an intentional **upward/diagonal flick**.
- **Firewall barrier:** an immovable red stripe splits the desktop down the
  middle. **Windows can't cross it**, but an **airborne packet passes through
  freely**. So the path is: flick off a left-side window → across the firewall
  in the air → catch on a right-side window → into the sink.

## What to try

- **Drag a title bar** under the packet — it rides the moving platform
  (position-locked, no runaway).
- **Flick a window straight up, fast** — restitution-scaled launch, with a
  dotted **trajectory arc** previewing where it'll go.
- **`[♪]` Audio Player** auto-pulses ±10px every 500ms — an auto-timed bouncing
  ledge.
- **`[!]` Temp Alert** has a 5s countdown; flick it up **before it expires** for
  +50% launch restitution.
- **Click the red `x`** — ordinary windows fade out (disappearing platform);
  source/sink can't be closed.

Audio cues: blip on landing, ascending chime on launch, alarm on integrity loss,
triad on delivery. Click once to enable audio (browser gesture requirement).

The HUD shows Data Integrity, Memory Usage, the live FSM state, and score.

## Window archetypes (Part 5)

The scene seeds one of each. Each window's software role is its mechanic — see
[`DESIGN.md`](./DESIGN.md) Part 5 for the full state machines and collision
overrides.

- **`[sh]` Terminal** — periodically runs `setgravity low/high` (warps local
  gravity in the column above it) and `echo` (drops decaying text **rungs** you
  can stand on).
- **`[♪]` Media player** — its title bar pulses on the beat. Land on the **peak
  of the pulse** for a full super-elastic bounce; mistime it and barely hop.
- **`[txt]` Editor / sticky note** — grab-and-hold "types" content, growing its
  width and shifting footing from **ice → sticky**; fill it past the threshold
  and it turns **buoyant**, floating the packet.
- **`[ERR]` BSOD modal** — a crumbling platform on a hard timer (standing on it
  decays it faster). Click its close box for an **explosive launch** — stronger
  the earlier you dismiss it.

## Run it

`index.html` loads a single self-contained bundle (`dist/bundle.js`, a classic
script with no ES-module imports), so you can **just double-click `index.html`**
and it plays — no server needed.

If you prefer a server (or edit the modular `dist/*.js` files directly), any
static server works too:

```sh
npx serve .
# or
python -m http.server 8080
```

> Note: a `<script type="module">` version would NOT work over `file://` —
> browsers block module imports on the file protocol for security. That's why
> `index.html` uses the bundled classic script instead.

## Rebuild from source

```sh
npm install      # installs TypeScript + esbuild
npm run build    # tsc -> dist/*.js  AND  esbuild -> dist/bundle.js
npm run typecheck
```

`npm run build` does both: the modular `dist/` ES modules (for the served
workflow) and the single `dist/bundle.js` that `index.html` loads.

## Layout

```
src/
  math.ts        vectors, clamp, swept circle-vs-AABB (CCD)
  components.ts  ECS component data + FSM enum + archetype structs
  config.ts      tunable constants (CONFIG physics + ARCH + GAME)
  world.ts       entity store + pointer state + archetype factory
  systems.ts     the fixed-step physics pipeline
  archetypes.ts  per-kind update + collision overrides (Part 5)
  game.ts        Kernel Run loop: objective, integrity, RAM, win/loss, arc
  audio.ts       Web Audio cue synthesizers (no assets)
  render.ts      canvas draw + archetype visuals + game HUD
  main.ts        accumulator loop + input wiring + game orchestration
dist/            compiled ES modules (loaded by index.html)
DESIGN.md        academic concept + architecture + math
index.html       playable page
```

Pipeline order (one fixed step): input → window → **archetype** → agent-intent
→ kinematics → collision (CCD + inheritance + archetype overrides) → post-FSM.
See `stepWorld` in `src/systems.ts`.
