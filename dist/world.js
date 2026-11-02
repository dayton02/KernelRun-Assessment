// The World holds entities. Systems operate on it. This is the ECS "store".
import { FsmState, WindowKind } from './components.js';
import { CONFIG, ARCH, GAME } from './config.js';
/** Build the per-kind archetype state with sensible defaults. */
export function makeArchetype(kind, baseY) {
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
        protectedWin: kind === WindowKind.SPAWN || kind === WindowKind.SINK,
    };
}
export class World {
    constructor(width, height) {
        this.windows = [];
        this.pointer = { x: 0, y: 0, down: false, pressed: false, released: false };
        this.firewallW = 8;
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
                fsm: FsmState.FALLING,
                dir: 1,
                grounded: false,
                wall: 0,
                coyote: 0,
                groundEntity: null,
                localOffsetX: 0,
                spawnDwell: 0,
            },
        };
    }
    alloc() { return this.nextId++; }
    spawnWindow(x, y, w, h, title, hue, kind = WindowKind.PLAIN) {
        const win = {
            id: this.alloc(),
            rect: { x, y, w, h, z: this.windows.length },
            prev: { x, y, w, h },
            style: { title, closing: 0, hue },
            drag: { grabbed: false, grabDX: 0, grabDY: 0, titleBarH: 26, vx: 0, vy: 0 },
            arch: makeArchetype(kind, y),
        };
        this.windows.push(win);
        return win;
    }
    /** Top-most window (highest z) whose title bar contains the point. */
    topWindowAt(x, y) {
        let best = null;
        for (const w of this.windows) {
            if (w.style.closing > 0)
                continue;
            const r = w.rect;
            const inTitle = x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + w.drag.titleBarH;
            if (inTitle && (!best || w.rect.z > best.rect.z))
                best = w;
        }
        return best;
    }
    bringToFront(win) {
        const maxZ = this.windows.reduce((m, w) => Math.max(m, w.rect.z), 0);
        win.rect.z = maxZ + 1;
    }
}
//# sourceMappingURL=world.js.map