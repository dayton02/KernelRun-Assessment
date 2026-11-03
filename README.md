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
  **Backup_Drive (D:)** drop zone (goal). The source is a **launcher**: it holds
  the packet briefly (watch the charge bar), then **auto-ejects it in a
  randomized arc toward the goal side** — so you catch and relay it onward
  rather than coax it off a fixed window. **The source, the goal, and the three
  starter platforms all spawn at random positions** each new level (source left,
  goal right, starters a random mix of platform types across both sides), so
  every run is a fresh layout. The source and goal also **relocate after every
  delivery**. Platforms and Data Integrity carry over between deliveries.
- **Data Integrity (starts 100%):** every time the packet falls past the
  **taskbar** at the bottom, you lose 25% and the packet respawns at the source.
  At **0% it's GAME OVER** — a *SYSTEM CRASH* screen shows your packets-delivered
  score and best, and a click starts a fresh run (best score carries over).
- **Memory Usage (RAM):** every open window (except the protected source/sink)
  costs RAM **and leaks more every second**. **Double-click empty desktop** to
  spawn a platform — but only if the RAM bar has room. Closing a window (its
  `X`) instantly recovers its memory and slows the leak. Hit **100%** and an
  **emergency GC sweep** closes every auxiliary window and drops the packet.

## Anti-ferry rules — you must flick, not carry

- **Inertial slip:** you can't ferry the packet by dragging its window. Move the
  carrying window faster than ~120 px/s **in any direction** (without an upward
  flick) and the packet first **wobbles** (yellow ⚠), then **loses footing and
  drops**. And even a slow carry won't score — a delivery only counts when the
  packet arrives **airborne from a real launch**, never while riding a window.
- **Firewall barrier:** an immovable red stripe splits the desktop down the
  middle. **Windows can't cross it**, but an **airborne packet passes through
  freely**. So the path is: flick off a left-side window → across the firewall
  in the air → catch on a right-side window → into the sink.

## Controls & flow (Part 8)

- **Click anywhere to start** — the game is paused on a title overlay until the
  first click (which also enables sound).
- **Flick a window upward** (drag it up fast) to launch the packet off it — this
  is the only way to make the packet jump. A dotted trajectory arc previews the
  shot while you wind up.
- **Scroll the mouse wheel** to choose which platform the next spawn makes
  (scratch / terminal / media / notes / alert), then **double-click empty
  desktop** to place it (only when the RAM bar has room). This is how you bring
  platforms back after they auto-recycle.
- **Catch cone:** a falling packet gently snaps toward a title bar it's about to
  land on, so good positioning catches it — no pixel-perfect aiming.
- **Drag on empty wallpaper** to draw a blue **marquee net** — a soft clutch
  save with a limited number of catches (shown as ●/○), not a trampoline. It
  gives a gentle, capped upward nudge then is spent and vanishes; costs 25% RAM
  while held, so it competes with your platforms.
- **The goal (Backup_Drive) is a drop zone, not a platform** — fly or drop the
  packet straight into its green body to deliver. You can't stand on it.
- **Leapfrog auto-recycle:** the window you just launched *from* dissolves on its
  own once the packet lands elsewhere — refunding RAM and building a combo. No
  hunting for `[X]` buttons.
- **Elastic slip:** dragging a carrying window too fast (any direction) first
  makes the packet **wobble** (yellow ⚠) for a moment; only continued over-speed
  dragging slips it off. Flick up or steady the drag to recover.
- **Streak & difficulty:** each delivery raises a streak multiplier (resets on
  integrity loss) and ramps the packet's base speed, with screen-shake and an
  ascending chord.

## What to try

- **Slide a window** slowly under the packet to reposition it — but only gently.
  Dragging the carrying window fast (in any direction) makes the packet **slip
  off**, and you can't score by carrying it: deliveries only count from an
  airborne launch.
- **Flick a window straight up, fast** — restitution-scaled launch, with a
  dotted **trajectory arc** previewing where it'll go. This is the only way to
  make the packet jump.
- **`[♪]` Audio Player** auto-pulses its top edge ±10px every 500ms — an
  auto-timed bouncing ledge. Land while it's in the raised half for a reliable
  bounce; no flick needed.
- **`[!]` Temp Alert** has a 5s countdown; flick it up **before it expires** for
  +50% launch restitution.
- **Click the red `x`** to close an ordinary window early (source/sink can't be
  closed). Mostly you won't need to — the window you launch *from* auto-recycles
  itself (leapfrog recycling).

Audio cues: blip on landing, ascending chime on launch, alarm on integrity loss,
triad on delivery. A looping chiptune plays underneath, kept quiet so it never
masks the effects. Click once to enable audio (browser gesture requirement);
press **M** to mute the music.

The HUD shows Data Integrity, Memory Usage (with live leak), the delivery
streak, recycle combo, speed ramp, your score (delivered / resets / GC), and the
next-spawn selector.

## Credits

- Music: *Tip C - Quirky 8-Bit Chiptune Instrumental* by **NickPanek**, from
  [pixabay.com](https://pixabay.com). Looped at low volume; press **M** to mute.
- Sound effects: synthesized in-engine via the Web Audio API (`src/audio.ts`).

## Window archetypes (Part 5)

Each new level seeds **three random starter platforms** (random kinds, random
positions) plus the source and goal; scroll the wheel and double-click to spawn
more of any kind. Each window's software role is its mechanic — see
[`DESIGN.md`](./DESIGN.md) Part 5 for the full state machines and collision
overrides. Spawnable kinds: scratch (plain), terminal, media, editor, alert.

- **`[sh]` Terminal** — periodically runs `setgravity low/high` (warps local
  gravity in the column above it) and `echo` (drops decaying text **rungs** you
  can stand on).
- **`[♪]` Media player** — its top edge pulses **±10px every 500ms** (an
  auto-timed bouncing ledge). Land while it's in the raised half of the pulse
  for a reliable bounce — no flick needed.
- **`[txt]` Editor / sticky note** — grab-and-hold "types" content, growing its
  width and shifting footing from **ice → sticky**; fill it past the threshold
  and it turns **buoyant**, floating the packet.
- **`[!]` Temp Alert** — a 5s countdown then it auto-closes; flick it up
  **before it expires** for +50% launch restitution.
- **`[ERR]` BSOD modal** — a crumbling platform with an explosive dismiss. Fully
  implemented (see `DESIGN.md` Part 5), but **not currently seeded or spawnable**
  in the Kernel Run level — included for reference.

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
