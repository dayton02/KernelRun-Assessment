// Window archetypes (DESIGN.md Part 5).
//
// Two entry points:
//   archetypeSystem(world, dt)  — stage 2.5 of the pipeline: advances each
//                                 window's per-kind timers, colliders, and
//                                 fields BEFORE kinematics/collision read them.
//   archetypeCollision(...)     — per-kind override invoked by CollisionSystem
//                                 when the packet contacts a window's title bar.
//
// Design rule: an archetype only ever mutates its own `arch` data plus the
// window rect it owns, and returns a small "collision effect" describing how
// the packet should respond. The core CollisionSystem stays generic.
import { ARCH, CONFIG } from './config.js';
import { FsmState, WindowKind } from './components.js';
import { clamp } from './math.js';
// ---------------------------------------------------------------------------
// Pipeline stage 2.5 — per-frame archetype update.
// ---------------------------------------------------------------------------
export function archetypeSystem(world, dt) {
    for (const w of world.windows) {
        switch (w.arch.kind) {
            case WindowKind.TERMINAL:
                updateTerminal(w, dt);
                break;
            case WindowKind.MEDIA:
                updateMedia(w, dt);
                break;
            case WindowKind.EDITOR:
                updateEditor(world, w, dt);
                break;
            case WindowKind.BSOD:
                updateBsod(w, dt);
                break;
            default: break;
        }
    }
}
// === 1. TERMINAL ===========================================================
// A shell that periodically "runs a command". Commands do one of two things:
//  - setgravity {low|high}: changes the LOCAL gravity field above the window
//  - echo <bar>: emits a horizontal text rung the packet can stand on
// Rungs decay over time (disappearing sub-platforms). Gravity field only
// applies while the packet is within fieldRadius above the title bar.
function updateTerminal(w, dt) {
    const t = ARCH.terminal;
    w.arch.cmdTimer -= dt;
    if (w.arch.cmdTimer <= 0) {
        w.arch.cmdTimer = t.cmdInterval;
        // deterministic rotation of commands keyed off the window id for variety
        const seq = (w.id + Math.floor(w.arch.phase)) % 3;
        w.arch.phase += 1;
        if (seq === 0) {
            w.arch.gravityField = t.gravityLo; // "setgravity low"
        }
        else if (seq === 1) {
            w.arch.gravityField = t.gravityHi; // "setgravity high"
        }
        else {
            // "echo ====": push a new rung, stack them downward
            const localY = w.drag.titleBarH + t.rungSpacing * (w.arch.rungs.length + 1);
            w.arch.rungs.push({ localY, life: t.rungLife, w: w.rect.w * 0.7 });
            if (w.arch.rungs.length > t.maxRungs)
                w.arch.rungs.shift();
        }
    }
    // age rungs
    for (const r of w.arch.rungs)
        r.life -= dt;
    w.arch.rungs = w.arch.rungs.filter((r) => r.life > 0);
}
// === 2. MEDIA ==============================================================
// The title-bar collider oscillates vertically with the track's waveform.
// On each beat the collider snaps upward; a packet resting on it at that moment
// gets a beat-matched launch. Timing accuracy scales the restitution.
function updateMedia(w, dt) {
    const m = ARCH.media;
    const beatPeriod = 60 / w.arch.bpm; // seconds per beat
    const prevPhase = w.arch.phase;
    w.arch.phase += dt;
    // detect a beat crossing this frame
    const prevBeat = Math.floor(prevPhase / beatPeriod);
    const nowBeat = Math.floor(w.arch.phase / beatPeriod);
    w.arch.onBeat = nowBeat !== prevBeat;
    // waveform: a sharp attack on the beat decaying until the next one
    const intoBeat = (w.arch.phase % beatPeriod) / beatPeriod; // 0..1
    w.arch.beatPulse = Math.pow(1 - intoBeat, 2); // 1 at beat, ->0
    // oscillate the collider's top edge around its rest Y
    const offset = -m.amplitude * w.arch.beatPulse;
    if (!w.drag.grabbed) {
        // only auto-oscillate when not being dragged, so player control wins
        w.rect.y = w.arch.baseY + offset;
    }
    else {
        // if dragged, the new resting position becomes baseY
        w.arch.baseY = w.rect.y - offset;
    }
}
// === 3. EDITOR / STICKY NOTE ==============================================
// The player grows content by grabbing the note (acts as "typing"). More
// characters -> wider surface, stickier friction, and eventually buoyancy so
// the note floats the packet upward like a raft. Deleting (not grabbed) lets
// content slowly evaporate, shrinking the surface back down.
function updateEditor(world, w, dt) {
    const e = ARCH.editor;
    const typing = w.drag.grabbed && world.pointer.down;
    if (typing) {
        w.arch.chars = clamp(w.arch.chars + e.charsPerSecTyping * dt, e.minChars, e.maxChars);
    }
    else {
        // idle evaporation, much slower than typing
        w.arch.chars = clamp(w.arch.chars - e.charsPerSecTyping * 0.15 * dt, e.minChars, e.maxChars);
    }
    // width follows character count (anchored on the left edge)
    w.rect.w = e.widthPerChar * w.arch.chars + 60;
    // friction scales from ice (empty) to sticky (full)
    const fill = (w.arch.chars - e.minChars) / (e.maxChars - e.minChars);
    w.arch.friction = e.frictionEmpty + (e.frictionFull - e.frictionEmpty) * fill;
    // buoyancy kicks in only past the threshold
    w.arch.buoyancy = w.arch.chars > e.buoyancyThreshold
        ? e.buoyancyMax * ((w.arch.chars - e.buoyancyThreshold) / (e.maxChars - e.buoyancyThreshold))
        : 0;
}
// === 4. BSOD / ERROR MODAL =================================================
// A crumbling platform on a hard timer. Integrity counts down whether or not
// the packet stands on it; standing on it accelerates the decay. At zero it
// despawns (floor drops out). Force-closing it early (the dismiss) converts the
// stored integrity into an explosive launch — high risk, high reward.
function updateBsod(w, dt) {
    const b = ARCH.bsod;
    // passive decay; accelerated decay (when stood on) is applied in collision.
    w.arch.crumble -= dt;
    if (w.arch.crumble <= 0 && !w.arch.dismissed) {
        // collapse: becomes non-solid and fades out via the standard closing path
        w.style.closing = Math.max(w.style.closing, 0.0001);
    }
    void b;
}
/**
 * Per-archetype response when the packet lands on / rests on window `w`.
 * Called by CollisionSystem after it has confirmed top-edge contact.
 */
export function archetypeContact(world, w, dt) {
    switch (w.arch.kind) {
        case WindowKind.MEDIA: return mediaContact(w);
        case WindowKind.EDITOR: return editorContact(w);
        case WindowKind.BSOD: return bsodContact(w, dt);
        case WindowKind.TERMINAL: return terminalContact(world, w);
        default: return {};
    }
}
function mediaContact(w) {
    const m = ARCH.media;
    // launch only when the collider is near a beat peak
    if (w.arch.beatPulse > 0.6) {
        const bonus = w.arch.onBeat ? m.onBeatBonus : m.offBeatBonus;
        const speed = m.amplitude * m.launchGain * w.arch.beatPulse * bonus;
        return { launchVy: -clamp(speed, 0, CONFIG.launchMax), forceLaunch: true };
    }
    return {};
}
function editorContact(w) {
    // sticky/icy footing + optional buoyant float
    return {
        frictionScale: w.arch.friction,
        support: w.arch.buoyancy,
    };
}
function bsodContact(w, dt) {
    // standing on it accelerates the crumble (3x passive rate)
    w.arch.crumble -= dt * 2;
    if (w.arch.crumble <= 0)
        return { passThrough: true };
    return {};
}
function terminalContact(world, w) {
    // gravity field is applied in kinematics; nothing special on contact itself
    void world;
    void w;
    return {};
}
/**
 * Local-gravity override for Terminal windows. Returns the gravity multiplier
 * the packet should feel given its position, or 1 if no field applies.
 * Called by KinematicsSystem (DESIGN.md §5.1).
 */
export function localGravityMultiplier(world) {
    const a = world.agent;
    const t = ARCH.terminal;
    let mult = 1;
    for (const w of world.windows) {
        if (w.arch.kind !== WindowKind.TERMINAL || w.style.closing > 0)
            continue;
        const withinX = a.tf.pos.x >= w.rect.x && a.tf.pos.x <= w.rect.x + w.rect.w;
        const above = a.tf.pos.y < w.rect.y && a.tf.pos.y > w.rect.y - t.fieldRadius * 4;
        if (withinX && above)
            mult = w.arch.gravityField; // last/topmost wins
    }
    return mult;
}
/**
 * Terminal text rungs act as thin one-way sub-platforms. Returns the world-Y
 * of a rung the packet is landing on, or null. Called by CollisionSystem.
 */
export function terminalRungContact(w, feetPrev, feetNow, x) {
    if (w.arch.kind !== WindowKind.TERMINAL)
        return null;
    const t = ARCH.terminal;
    const withinX = x >= w.rect.x + w.rect.w * 0.15 && x <= w.rect.x + w.rect.w * 0.85;
    if (!withinX)
        return null;
    for (const r of w.arch.rungs) {
        const rungY = w.rect.y + r.localY;
        const crossed = feetPrev <= rungY && feetNow >= rungY;
        if (crossed)
            return rungY;
    }
    void t;
    return null;
}
/**
 * Explosive dismissal of a BSOD modal (player clicked close). Converts the
 * remaining integrity into a launch vector aimed away from the dismiss point.
 */
export function bsodDismiss(world, w, clickX) {
    const b = ARCH.bsod;
    w.arch.dismissed = true;
    w.style.closing = 0.0001;
    const a = world.agent;
    // only launch the packet if it is on/near the modal
    const near = a.tf.pos.x >= w.rect.x - 20 && a.tf.pos.x <= w.rect.x + w.rect.w + 20
        && a.tf.pos.y <= w.rect.y + w.rect.h && a.tf.pos.y >= w.rect.y - 40;
    if (!near)
        return;
    const intensity = clamp(w.arch.crumble / w.arch.crumbleMax, 0.2, 1);
    a.kin.vel.y = -b.dismissLaunch * intensity;
    const side = a.tf.pos.x < clickX ? -1 : 1;
    a.kin.vel.x = side * b.dismissSpreadX * intensity;
    a.state.fsm = FsmState.LAUNCHED;
    a.state.grounded = false;
    a.state.groundEntity = null;
}
//# sourceMappingURL=archetypes.js.map