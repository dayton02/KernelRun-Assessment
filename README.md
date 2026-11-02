# Desktop Trampoline — prototype

Platforming reframed as real-time window management. You never control the
character. An autonomous data packet runs a finite-state machine across your
"desktop"; you drag, flick, and close application windows to build the terrain
under it.

Full design rationale, ECS layout, state tables, and the physics math are in
[`DESIGN.md`](./DESIGN.md).

## What to try

- **Drag a title bar** under the packet — it rides the moving platform and
  inherits the window's velocity.
- **Flick a window straight up, fast** — restitution-scaled springboard launch.
- **Click the red `x`** — the window fades out; a disappearing platform.
- Let the packet run off an edge onto a **side border** — it wall-slides.

The HUD (top-left) shows the live FSM state, velocity, and ground/wall flags.
Packet color encodes state: green=patrol, yellow=jump, red=launched,
blue=falling, purple=wall-slide.

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

## Run it (zero build — already compiled)

The repo ships with `dist/` prebuilt, so you can just serve the folder and open
`index.html`. Because it loads ES modules, use a tiny static server (opening the
file over `file://` is blocked by module CORS rules in most browsers):

```sh
# any static server works; pick one you have
npx serve .
# or
python -m http.server 8080
```

Then open the printed URL and the canvas auto-boots.

## Rebuild from source

```sh
npm install      # installs TypeScript only
npm run build    # tsc -> dist/
npm run typecheck
```

## Layout

```
src/
  math.ts        vectors, clamp, swept circle-vs-AABB (CCD)
  components.ts  ECS component data + FSM enum + archetype structs
  config.ts      tunable physics constants (CONFIG + ARCH)
  world.ts       entity store + pointer state + archetype factory
  systems.ts     the fixed-step pipeline (now 7 stages incl. archetypes)
  archetypes.ts  per-kind update + collision overrides (Part 5)
  render.ts      canvas draw + archetype visuals
  main.ts        accumulator loop + input wiring
dist/            compiled ES modules (loaded by index.html)
DESIGN.md        academic concept + architecture + math
index.html       playable page
```

Pipeline order (one fixed step): input → window → **archetype** → agent-intent
→ kinematics → collision (CCD + inheritance + archetype overrides) → post-FSM.
See `stepWorld` in `src/systems.ts`.
