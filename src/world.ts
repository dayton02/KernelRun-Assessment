// The World holds entities. Systems operate on it. This is the ECS "store".

import { Agent, Win, FsmState, WindowKind, Archetype } from './components.js';
import { CONFIG, ARCH } from './config.js';

export interface Pointer {
  x: number;
  y: number;
  down: boolean;
  pressed: boolean;   // edge: became down this frame
  released: boolean;  // edge: became up this frame
}

/** Build the per-kind archetype state with sensible defaults. */
export function makeArchetype(kind: WindowKind, baseY: number): Archetype {
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
  };
}

export class World {
  windows: Win[] = [];
  agent: Agent;
  pointer: Pointer = { x: 0, y: 0, down: false, pressed: false, released: false };
  width: number;
  height: number;
  private nextId = 1;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
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
      },
    };
  }

  alloc(): number { return this.nextId++; }

  spawnWindow(
    x: number, y: number, w: number, h: number, title: string, hue: number,
    kind: WindowKind = WindowKind.PLAIN,
  ): Win {
    const win: Win = {
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
  topWindowAt(x: number, y: number): Win | null {
    let best: Win | null = null;
    for (const w of this.windows) {
      if (w.style.closing > 0) continue;
      const r = w.rect;
      const inTitle = x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + w.drag.titleBarH;
      if (inTitle && (!best || w.rect.z > best.rect.z)) best = w;
    }
    return best;
  }

  bringToFront(win: Win): void {
    const maxZ = this.windows.reduce((m, w) => Math.max(m, w.rect.z), 0);
    win.rect.z = maxZ + 1;
  }
}
