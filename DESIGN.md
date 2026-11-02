# Desktop Trampoline — Design & Technical Blueprint

> An interactive meta-interface where the player never touches the character.
> You rearrange application windows; an autonomous data packet treats your
> desktop as terrain.

---

## Part 1 — Academic Concept & Mechanics Justification

### 1.1 The claim

Platforming, stripped of its tile-and-sprite skin, is a problem of **discrete
support over a continuous void**. A genre is defined by its verbs and its
invariants, not its art. The three load-bearing primitives of the platformer
are:

| Primitive | Classic expression | Formal definition |
|-----------|--------------------|-------------------|
| **Support vs. void** | standing on a brick vs. falling in a pit | a predicate `supported(p)` over screen space that partitions it into solid and empty |
| **Trajectory under gravity** | the Mario jump arc | a ballistic path `p(t) = p₀ + v₀t + ½g t²` sampled against support |
| **Momentum transfer** | conveyor belts, moving platforms, springs | the agent inherits the velocity field of the surface it contacts |

`Desktop Trampoline` keeps all three invariants and swaps only the *source* of
the support field. Instead of a static tilemap authored by a level designer,
the support field is the **live set of window rectangles**, authored *in real
time by the player*.

### 1.2 Why this is a subversion, not a reskin

In a conventional platformer the level is immutable and the avatar is the only
mutable thing the player controls. Here the relationship is inverted:

- The **avatar is autonomous** (a finite-state machine, no direct input).
- The **level is the input device.** The player's verbs are `drag`, `resize`,
  `flick`, `stack`, and `close` — the WIMP vocabulary — and those verbs mutate
  the support field.

This recontextualizes "level design" as a *continuous, improvised act* performed
during play. The player is not a platformer protagonist; the player is the
*platform*. That inversion is the conceptual core and the thing worth grading.

### 1.3 Mapping GUI affordances onto platforming surfaces

| WIMP element | Platforming role | Invariant preserved |
|--------------|-----------------|---------------------|
| Title bar | one-way jump-through platform | support-from-above only |
| Left/right window border | frictional wall-slide surface | wall-cling + slide decay |
| Window body (client area) | solid blocking volume | occlusion / no-pass |
| Dragging a window | moving platform | velocity inheritance |
| Flicking a window upward | trampoline / springboard | restitution-scaled launch |
| Closing a modal | disappearing platform | timed support removal |
| Z-order (stacking) | layered terrain | support resolves top-most first |

Each row preserves a platforming invariant, which is the formal proof that the
mechanic *is* platforming rather than merely resembling it.

---

## Part 2 — System Architecture & ECS Data Layout

### 2.1 Design goal

Three concerns must never leak into each other:

1. **UI Window Management** — what windows exist, where, what z-order, user drag
   intent.
2. **Kinematics** — integrating the agent's position/velocity under gravity.
3. **Collision Resolution** — turning the window set into a support field and
   resolving contacts (including CCD against moving borders).

ECS gives us that isolation: windows and the agent are both *entities*; the
three concerns are three *systems* reading disjoint component sets.

### 2.2 Components (TypeScript)

```ts
// --- shared math ---
interface Vec2 { x: number; y: number; }

// --- the agent (data packet) ---
interface Transform   { pos: Vec2; }
interface Kinematics  { vel: Vec2; acc: Vec2; }
interface AgentState  { fsm: FsmState; grounded: boolean; wall: -1 | 0 | 1;
                        coyote: number; groundEntity: number | null; }
interface AgentShape  { radius: number; }

// --- windows (platforms) ---
interface WindowRect  { x: number; y: number; w: number; h: number; z: number; }
interface WindowPrev  { x: number; y: number; w: number; h: number; } // last frame, for inherited velocity
interface WindowStyle { title: string; closing: number; } // closing>0 => fading out
interface Draggable   { grabbed: boolean; grabDX: number; grabDY: number;
                        titleBarH: number; vx: number; vy: number; } // tracked flick velocity
```

The agent is `Transform + Kinematics + AgentState + AgentShape`.
A window is `WindowRect + WindowPrev + WindowStyle + Draggable`.
No component references another system's logic — only plain data.

### 2.3 Finite-state machine

```
             ┌───────────────────────────────────────────┐
             │                                             │
      ┌──────▼──────┐  edge reached / timer   ┌──────────┐ │
      │  PATROLLING │────────────────────────▶│  JUMPING │ │
      └──────┬──────┘                         └────┬─────┘ │
             │ support lost                        │ apex  │
             │                                     ▼       │
      ┌──────▼──────┐   wall contact + falling ┌──────────┐│
      │   FALLING   │◀─────────────────────────│ LAUNCHED ││
      └──────┬──────┘                          └────┬─────┘│
             │ touches wall                         │ land │
      ┌──────▼──────┐  no wall / bottom             │      │
      │ WALL_SLIDING│──────────────────────────────┘      │
      └──────┬──────┘                                      │
             │ lands on support                            │
             └─────────────────────────────────────────────┘
```

#### State transition table

| From | Condition | To | Side effect |
|------|-----------|----|-------------|
| PATROLLING | reached title-bar edge | JUMPING | set `vel.y = -jumpImpulse`, keep `vel.x` |
| PATROLLING | `supported == false` | FALLING | — |
| PATROLLING | window flicked up under agent | LAUNCHED | `vel.y = -flickSpeed * restitution` |
| JUMPING | `vel.y >= 0` (apex) | FALLING | — |
| JUMPING | head hits window body | FALLING | `vel.y = 0` |
| LAUNCHED | `vel.y >= 0` | FALLING | — |
| FALLING | lands on a title bar (top contact) | PATROLLING | snap to surface, inherit platform vel |
| FALLING | side border contact, `vel.y > 0` | WALL_SLIDING | set `wall` sign |
| WALL_SLIDING | lands on support | PATROLLING | inherit platform vel |
| WALL_SLIDING | no wall / reached bottom | FALLING | clear `wall` |
| any | `coyote > 0` after support loss | (stays groundable) | allows late jump |

### 2.4 Pipeline execution order (per frame)

Order matters because each stage consumes the previous stage's output.

```
1. InputSystem         read pointer; set Draggable.grabbed / drag target
2. WindowSystem        apply drag to WindowRect; compute per-window velocity
                       from (rect - prev); advance WindowStyle.closing; set prev
3. AgentIntentSystem   run FSM transitions that depend only on state/timers
                       (patrol direction, edge-triggered jumps)
4. KinematicsSystem    semi-implicit Euler: vel += acc*dt; pos += vel*dt
5. CollisionSystem     build support field from windows; CCD sweep of agent
                       against moving borders; resolve contacts; set grounded,
                       wall, groundEntity; inherit platform velocity
6. PostFsmSystem       apply contact-driven transitions (land→PATROL, etc.)
7. RenderSystem        draw windows by z-order, then agent, then HUD
```

Keeping `WindowSystem` strictly before `CollisionSystem` is what makes
momentum transfer correct: the window velocity used for inheritance is the one
computed *this* frame from the player's drag.

---

## Part 3 — Core Math & Inertia Resolution

All integration is **frame-rate independent** via a fixed `dt` (accumulator
pattern). We use **semi-implicit (symplectic) Euler** because it is stable for
gravity-dominated motion and cheap:

```
v_{n+1} = v_n + a·dt          // velocity updated first…
x_{n+1} = x_n + v_{n+1}·dt    // …then position uses the new velocity
```

### 3.1 Window velocity (the moving-platform field)

Each window caches last frame's rect. Its instantaneous velocity is a finite
difference:

```
w_vel = (rect.pos − prev.pos) / dt
```

A ring buffer / EMA smooths this for *flick* detection so a single jittery
frame doesn't fire a launch:

```
flick_vel ← α · w_vel + (1 − α) · flick_vel       (α ≈ 0.5)
```

### 3.2 Velocity inheritance (standing on a dragged title bar)

When the agent is `grounded` on window *W*, its horizontal motion is **relative
to the platform**. Let `v_rel` be the agent's patrol velocity and `w_vel` the
window velocity:

```
agent.vel.x = w_vel.x + v_rel.x        // linear inheritance
agent.pos.x += ω × r                    // angular term (see below)
```

**Angular inertia.** A fast horizontal flick also rotates perceived footing.
Model it as an angular velocity `ω` proportional to the window's horizontal
acceleration, applied as a tangential nudge about the grab point:

```
ω      = k_ω · (w_vel.x − w_vel_prev.x) / dt
r      = agent.pos − window.center
tangential = ω · perp(r)               // perp((x,y)) = (−y, x)
agent.vel += tangential
```

`k_ω` is a small coupling constant (tuned ≈ 0.0005) so angular effects feel like
"stumble", not teleportation.

### 3.3 Springboard / trampoline launch

When a window translates **upward** faster than a threshold while the agent
rests on its title bar, we convert the surface velocity into a launch with a
**restitution multiplier** `e > 1` (super-elastic, because it's a trampoline,
not a billiard ball):

```
if (−w_vel.y) > v_launch_min and grounded:
    launch_speed = (−w_vel.y) · e + jump_assist
    agent.vel.y  = −clamp(launch_speed, 0, v_launch_max)
    state ← LAUNCHED
```

Typical constants: `e = 1.6`, `v_launch_min = 450 px/s`, `v_launch_max = 1600`,
`jump_assist = 120`. Clamping prevents a violent flick from ejecting the packet
off-screen.

### 3.4 One-way (jump-through) platform penetration check

A title bar supports **only from above**, but it must also be able to *rise
into* a resting packet — that rising case is precisely what makes the
springboard possible. So the test is run in the **window's reference frame**:
we track the sign of `feet − topEdge` across the frame and treat any crossing
as contact, while rejecting a packet that is genuinely moving upward *through*
the bar.

```
top_prev  = window.prevY            // bar top edge last frame
top_now   = window.y                // bar top edge this frame
feet_prev = agent.prevPos.y + r
feet_now  = agent.pos.y    + r

rel_prev  = feet_prev − top_prev
rel_now   = feet_now  − top_now

crossedOntoTop = rel_prev <= 0 and rel_now >= 0         // packet lands from above
windowRoseInto = rel_prev >= 0 and rel_now <= 0 and top_now < top_prev
overlapX       = agent.x in [window.x, window.x + window.w]
catchable      = agent.vel.y >= 0 or windowRoseInto     // allow a rising scoop

if (crossedOntoTop or windowRoseInto) and overlapX and catchable:
    resolve: agent.pos.y = top_now − r
             agent.vel.y = 0
             grounded = true, groundEntity = window
             inheritVelocity(window)      // feeds §3.2 / §3.3
```

Because the test keys off the *relative segment* rather than an instantaneous
point, a packet moving faster than one bar-height per frame cannot tunnel
through (CCD for the one-way case), and a window flicked upward faster than the
packet still catches it — which `tryLaunch` (§3.3) then converts into a
restitution-scaled launch.

### 3.5 CCD against moving borders (general case)

For solid borders that are themselves moving, we work in the **window's
reference frame**: subtract the window velocity from the agent velocity, then do
a swept circle-vs-AABB test over `dt`. The earliest time-of-impact `t_hit ∈
[0,1]` gives the contact; we advance the agent to `t_hit`, zero the normal
component of the *relative* velocity, re-add the window velocity (that re-add is
the inheritance), and continue the remaining `(1 − t_hit)·dt`.

```
v_rel      = agent.vel − w_vel
t_hit      = sweptCircleAABB(agent.pos, agent.radius, v_rel·dt, windowRect)
if t_hit < 1:
    agent.pos += v_rel · (t_hit · dt)
    n          = contactNormal
    v_rel     -= n · dot(v_rel, n)      // remove into-surface component
    agent.vel  = v_rel + w_vel          // inheritance re-applied
```

### 3.6 Wall-slide decay

On a side border, gravity is attenuated and horizontal motion is clamped to the
wall:

```
if WALL_SLIDING:
    agent.vel.x = 0
    agent.vel.y = min(agent.vel.y, v_slide_max)   // capped descent
    // optional friction: agent.vel.y *= (1 − μ·dt)
```

---

## Part 4 — Minimal Playable Prototype

See `src/` for the runnable implementation. It is a self-contained
TypeScript + Canvas build (no framework) demonstrating:

- draggable / flickable windows with tracked velocity,
- an autonomous packet on the FSM from §2.3,
- velocity inheritance (§3.2), springboard launch (§3.3),
- one-way title-bar platforms with CCD (§3.4),
- wall-sliding (§3.6), and
- all four window archetypes from Part 5 (terminal, media, editor, BSOD).

Run instructions are in `README.md`. The scene seeds one window of each
archetype so every mechanic is reachable from the start.

---

## Part 5 — Window Archetypes

The base game treats every window identically (a one-way title bar). The
archetype layer gives a window **platforming behavior tied to its software
role**, so the player's mental model of "what this app does" maps directly onto
"how this platform behaves." Reading a terminal as a gravity console or a media
player as a metronome is the design payload: the UI metaphor *is* the mechanic.

### 5.0 Integration (where archetypes live in the pipeline)

The pipeline (DESIGN.md §2.4) gains one stage:

```
1 InputSystem       pointer -> grab / close / BSOD-dismiss
2 WindowSystem      drag -> rect, finite-difference velocity
2.5 ArchetypeSystem  advance per-kind timers, fields, colliders   ← NEW
3 AgentIntentSystem FSM transitions from state/timers
4 KinematicsSystem  gravity (× local field from §5.1) + Euler
5 CollisionSystem   generic contact, then archetypeContact() override
6 PostFsmSystem     contact-driven state transitions
```

Each window carries one `Archetype` component (`src/components.ts`). Systems
branch on `arch.kind`. The collision core stays generic: on a confirmed
title-bar contact it calls `archetypeContact(world, w, dt)`, which returns a
small `ContactEffect` (`launchVy`, `kickVx`, `frictionScale`, `support`,
`passThrough`, `forceLaunch`) that the core applies. This keeps the kinematics
and collision math untouched while allowing per-kind overrides.

`ContactEffect` is the single extension seam. Adding a new archetype means
writing one update function and one contact function — no edits to the core
integrator or CCD.

---

### 5.1 Terminal / Shell — gravity console + text rungs

**Role fantasy:** a shell that runs commands which reshape local physics.

**Systemic rules**

- Every `cmdInterval` seconds it "runs a command," cycling deterministically:
  - `setgravity low` → local gravity multiplier `0.35`
  - `setgravity high` → local gravity multiplier `1.8`
  - `echo ====` → emits a horizontal **text rung** below the title bar
- The gravity multiplier applies **only to the field region** directly above
  the window (`withinX` and within `fieldRadius×4` px above the top edge). The
  packet feels normal gravity everywhere else. This makes the terminal a *local*
  modifier, not a global one — you route the packet through its column.
- Rungs are thin **one-way sub-platforms** stacked downward. Each has a `life`
  timer (`rungLife`) and vanishes when it expires — disappearing platforms you
  must traverse before they decay.

**Collision override**

```
localGravityMultiplier(world):          # consumed by KinematicsSystem §4
    for each TERMINAL window w:
        if agent.x in w.x-span and agent.y in field-column above w:
            mult = w.arch.gravityField
    return mult                          # default 1

terminalRungContact(w, feetPrev, feetNow, x):   # consumed by CollisionSystem §5
    if x within central 70% of w:
        for rung in w.arch.rungs:
            rungY = w.y + rung.localY
            if feetPrev <= rungY <= feetNow:    # one-way, CCD segment test
                return rungY                    # land, grounded = true
    return null
```

**State machine (window-local)**

| State | Enter when | Does | Exits to |
|-------|-----------|------|----------|
| IDLE | spawn / after a command | counts `cmdTimer` down | RUN_CMD at 0 |
| RUN_CMD | `cmdTimer <= 0` | pick next command, apply effect, reset timer | IDLE |
| (rungs age independently each frame; expired rungs are removed) |

The packet's own FSM is unchanged; the terminal only alters the *forces and
support* it experiences.

---

### 5.2 Media Player — beat-matched oscillating trampoline

**Role fantasy:** the title-bar collider pulses on the beat; land in time and
it throws you higher.

**Systemic rules**

- A phase accumulator advances by `dt`. `beatPeriod = 60 / bpm`. A **beat**
  fires whenever `floor(phase/beatPeriod)` increments.
- The collider's top edge oscillates around its rest Y by
  `offset = −amplitude · beatPulse`, where `beatPulse = (1 − intoBeat)²` is a
  sharp attack on the beat decaying to zero before the next.
- Dragging the window overrides oscillation (player control wins); the new
  resting Y becomes the oscillation center.

**Collision override — timing-scaled restitution**

```
mediaContact(w):
    if w.arch.beatPulse > 0.6:                       # near a peak
        bonus = onBeatBonus (1.9) if w.arch.onBeat    # perfect timing
              else offBeatBonus (0.55)                # mistimed, weak
        speed = amplitude · launchGain · beatPulse · bonus
        return { launchVy: -clamp(speed, 0, launchMax), forceLaunch: true }
    return {}                                         # off-peak: ordinary footing
```

The skill expression: a packet that happens to be resting on the bar **at the
peak of the pulse** gets the full super-elastic bounce; contact off the peak
barely launches. The player sequences the packet's arrival to land on the beat.

**State machine (window-local)**

| State | Enter when | Does | Exits to |
|-------|-----------|------|----------|
| OSCILLATING | not grabbed | moves top edge by beat envelope; sets `onBeat` | PINNED on grab |
| PINNED | grabbed | follows cursor; recomputes rest Y | OSCILLATING on release |

Packet FSM transition added: `PATROLLING/FALLING → LAUNCHED` when
`mediaContact` returns `forceLaunch`.

---

### 5.3 Text Editor / Sticky Note — player-grown surface

**Role fantasy:** you "type" content into the note; more text makes it wider,
stickier, and eventually buoyant enough to float the packet.

**Systemic rules**

- While grabbed with the pointer down it **gains characters** at
  `charsPerSecTyping`; otherwise content slowly **evaporates**. `chars` is
  clamped to `[minChars, maxChars]`.
- Derived properties update every frame:
  - **width** `= widthPerChar · chars + 60` (surface grows from the left edge)
  - **friction** interpolates `frictionEmpty (0.05, ice) → frictionFull (0.9,
    sticky)` with fill fraction
  - **buoyancy** is `0` below `buoyancyThreshold` chars, then ramps to
    `buoyancyMax` — a dense note *floats* the packet.

**Collision override**

```
editorContact(w):
    return { frictionScale: w.arch.friction,   # scales inherited patrol vel.x
             support: w.arch.buoyancy }         # upward lift when grounded

# applied by CollisionSystem:
agent.vel.x *= frictionScale                     # ice slides, sticky grips
if support > 0:
    agent.vel.y = -sqrt(2 · support)             # impulse-like float off surface
```

The friction scale couples into the velocity-inheritance step: a near-empty
note is ice (the packet keeps sliding), a full note is sticky (patrol speed is
damped). Buoyancy turns a maxed-out note into a soft upward launch pad — a
gentler, controllable alternative to the media trampoline.

**State machine (window-local)**

| State | Enter when | Does | Exits to |
|-------|-----------|------|----------|
| EDITING | grabbed + pointer down | `chars += rate·dt` | IDLE on release |
| IDLE | not editing | `chars -= evaporate·dt` | EDITING on grab |
| (BUOYANT is not a separate state — it's a threshold on `chars` read at contact) |

---

### 5.4 System Error / BSOD Modal — crumbling platform, explosive dismiss

**Role fantasy:** a fatal error you can briefly stand on, or weaponize by force-
closing it.

**Systemic rules**

- `crumble` integrity counts down from `crumbleMax` every frame (passive).
- **Standing on it accelerates decay** (an extra `2·dt` per frame in
  `bsodContact`) — the more you use it, the faster it fails.
- At `crumble <= 0` it collapses: `passThrough` is returned (non-solid) and the
  window fades out via the standard closing path. A packet resting on it drops.
- **Explosive dismiss:** clicking the close box does *not* do an ordinary fade.
  It converts the **remaining integrity** into a launch vector — close it early
  for a bigger blast (`intensity = crumble/crumbleMax`), aimed up and away from
  the click point.

**Collision override**

```
bsodContact(w, dt):
    w.arch.crumble -= dt · 2                 # accelerated decay while stood on
    if w.arch.crumble <= 0: return { passThrough: true }   # platform gone
    return {}                                # otherwise ordinary footing

bsodDismiss(world, w, clickX):               # from InputSystem on close-click
    w.dismissed = true; w.closing = begin-fade
    if agent near the modal:
        intensity = clamp(crumble / crumbleMax, 0.2, 1)
        agent.vel.y = -dismissLaunch · intensity          # up
        side        = sign(agent.x − clickX)
        agent.vel.x = side · dismissSpreadX · intensity   # away from click
        agent.fsm   = LAUNCHED
```

**Risk/reward:** a BSOD is the strongest launcher in the game, but it is on a
hard timer and gets weaker the longer you wait. The optimal line is to route the
packet onto it and dismiss immediately — high skill, high payoff.

**State machine (window-local)**

```
     ┌────────┐  crumble<=0 (auto)   ┌──────────┐
     │ ACTIVE │─────────────────────▶│ COLLAPSED│ (non-solid, fades out)
     └───┬────┘                       └──────────┘
         │ player clicks close
         ▼
     ┌──────────┐  imparts explosive launch to packet, then fades
     │ DISMISSED │
     └──────────┘
```

| State | Enter when | Does | Exits to |
|-------|-----------|------|----------|
| ACTIVE | spawn | decays; accelerated decay while stood on | COLLAPSED at 0, or DISMISSED on close |
| COLLAPSED | `crumble <= 0` | returns `passThrough`; begins fade | despawn |
| DISMISSED | close clicked | explosive launch (§ above); begins fade | despawn |

---

### 5.5 Archetype → ContactEffect summary

| Archetype | Field / timer | On-contact effect | Signature quirk |
|-----------|---------------|-------------------|-----------------|
| Terminal | local gravity multiplier; aging rungs | (gravity applied pre-contact) | routes the packet through a gravity column; decaying rungs |
| Media | beat phase + pulse envelope | `launchVy` scaled by beat timing | perfect-on-beat = full super-elastic bounce |
| Editor | `chars` → width/friction/buoyancy | `frictionScale`, `support` | player grows the platform; ice ↔ sticky ↔ float |
| BSOD | `crumble` countdown | `passThrough` at 0 | explosive dismiss; stronger the earlier you close it |

All four are verified by headless tests (gravity field, beat launch, editor
width/friction/buoyancy, BSOD decay + explosive dismiss) plus a 5000-frame
stability pass over a mixed scene. See `src/archetypes.ts` for the
implementation and `src/config.ts` (`ARCH`) for the tunables.
