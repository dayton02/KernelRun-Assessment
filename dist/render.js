// RenderSystem — draws windows by z-order, then the agent, then the HUD.
import { FsmState, WindowKind } from './components.js';
const KIND_TAG = {
    [WindowKind.PLAIN]: '',
    [WindowKind.TERMINAL]: ' [sh]',
    [WindowKind.MEDIA]: ' [♪]',
    [WindowKind.EDITOR]: ' [txt]',
    [WindowKind.BSOD]: ' [ERR]',
};
export function render(ctx, world) {
    ctx.clearRect(0, 0, world.width, world.height);
    // desktop backdrop
    ctx.fillStyle = '#0b1020';
    ctx.fillRect(0, 0, world.width, world.height);
    drawGrid(ctx, world);
    const sorted = [...world.windows].sort((a, b) => a.rect.z - b.rect.z);
    for (const w of sorted) {
        const fade = w.style.closing > 0 ? Math.max(0, 1 - w.style.closing / 0.35) : 1;
        ctx.globalAlpha = fade;
        const r = w.rect;
        // body
        ctx.fillStyle = `hsl(${w.style.hue} 30% 16%)`;
        ctx.fillRect(r.x, r.y, r.w, r.h);
        ctx.strokeStyle = `hsl(${w.style.hue} 60% 55%)`;
        ctx.lineWidth = 2;
        ctx.strokeRect(r.x, r.y, r.w, r.h);
        // archetype-specific body decoration (drawn under the title bar)
        drawArchetype(ctx, w);
        // title bar (one-way platform) — brighten on a media beat
        let barL = 42;
        if (w.arch.kind === WindowKind.MEDIA)
            barL = 42 + 28 * w.arch.beatPulse;
        if (w.arch.kind === WindowKind.BSOD) {
            // flicker as it nears collapse
            const frac = Math.max(0, w.arch.crumble / w.arch.crumbleMax);
            const flick = frac < 0.4 ? (Math.sin(w.arch.crumbleMax * 40 - frac * 60) > 0 ? 55 : 25) : 42;
            barL = flick;
        }
        ctx.fillStyle = `hsl(${w.style.hue} 55% ${barL}%)`;
        ctx.fillRect(r.x, r.y, r.w, w.drag.titleBarH);
        ctx.fillStyle = '#eaf0ff';
        ctx.font = '13px system-ui, sans-serif';
        ctx.fillText(w.style.title + KIND_TAG[w.arch.kind], r.x + 8, r.y + 18);
        // close box
        ctx.fillStyle = '#e4607a';
        ctx.fillRect(r.x + r.w - 20, r.y + 6, 14, 14);
        ctx.fillStyle = '#2a0c12';
        ctx.fillText('x', r.x + r.w - 17, r.y + 18);
        ctx.globalAlpha = 1;
    }
    // agent (the data packet)
    const a = world.agent;
    ctx.beginPath();
    ctx.arc(a.tf.pos.x, a.tf.pos.y, a.shape.radius, 0, Math.PI * 2);
    ctx.fillStyle = stateColor(a.state.fsm);
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();
    drawHud(ctx, world);
}
function drawArchetype(ctx, w) {
    const r = w.rect;
    switch (w.arch.kind) {
        case WindowKind.TERMINAL: {
            // gravity field tint + traversable text rungs
            const g = w.arch.gravityField;
            ctx.fillStyle = g < 1 ? 'rgba(120,200,255,0.08)' : g > 1 ? 'rgba(255,150,120,0.08)' : 'transparent';
            ctx.fillRect(r.x, r.y - 120, r.w, 120);
            ctx.fillStyle = '#6cff9a';
            ctx.font = '11px ui-monospace, monospace';
            ctx.fillText(g < 1 ? '> setgravity low' : g > 1 ? '> setgravity high' : '> _', r.x + 8, r.y + w.drag.titleBarH + 14);
            for (const rung of w.arch.rungs) {
                const y = r.y + rung.localY;
                const alpha = Math.min(1, rung.life);
                ctx.globalAlpha = alpha;
                ctx.fillStyle = '#9ad9ff';
                ctx.fillRect(r.x + r.w * 0.15, y - 3, rung.w, 6);
                ctx.globalAlpha = 1;
            }
            break;
        }
        case WindowKind.MEDIA: {
            // waveform bars reacting to the beat
            ctx.strokeStyle = '#ff8ad0';
            ctx.lineWidth = 2;
            const bars = 16;
            for (let i = 0; i < bars; i++) {
                const bx = r.x + 10 + (i / bars) * (r.w - 20);
                const amp = (0.3 + 0.7 * Math.abs(Math.sin(i * 1.3 + w.arch.phase * 6))) * w.arch.beatPulse;
                const bh = 6 + amp * (r.h - w.drag.titleBarH - 20);
                ctx.beginPath();
                ctx.moveTo(bx, r.y + r.h - 10);
                ctx.lineTo(bx, r.y + r.h - 10 - bh);
                ctx.stroke();
            }
            break;
        }
        case WindowKind.EDITOR: {
            // text-fill meter + buoyancy glow
            const fillFrac = (w.arch.chars - 10) / (180 - 10);
            ctx.fillStyle = 'rgba(255,230,120,0.12)';
            ctx.fillRect(r.x, r.y + r.h - 6, r.w * fillFrac, 6);
            if (w.arch.buoyancy > 0) {
                ctx.fillStyle = 'rgba(120,255,200,0.10)';
                ctx.fillRect(r.x, r.y - 30, r.w, 30);
            }
            break;
        }
        case WindowKind.BSOD: {
            // integrity bar
            const frac = Math.max(0, w.arch.crumble / w.arch.crumbleMax);
            ctx.fillStyle = frac < 0.4 ? '#ff5b5b' : '#ffd166';
            ctx.fillRect(r.x, r.y + r.h - 5, r.w * frac, 5);
            ctx.fillStyle = '#eaf0ff';
            ctx.font = '12px ui-monospace, monospace';
            ctx.fillText(':( FATAL_EXCEPTION', r.x + 10, r.y + r.h / 2);
            break;
        }
        default: break;
    }
}
function stateColor(s) {
    switch (s) {
        case FsmState.PATROLLING: return '#52e0a0';
        case FsmState.JUMPING: return '#ffd166';
        case FsmState.LAUNCHED: return '#ff7b7b';
        case FsmState.FALLING: return '#7aa2ff';
        case FsmState.WALL_SLIDING: return '#c792ea';
    }
}
function drawGrid(ctx, world) {
    ctx.strokeStyle = 'rgba(255,255,255,0.04)';
    ctx.lineWidth = 1;
    for (let x = 0; x < world.width; x += 40) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, world.height);
        ctx.stroke();
    }
    for (let y = 0; y < world.height; y += 40) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(world.width, y);
        ctx.stroke();
    }
}
function drawHud(ctx, world) {
    const a = world.agent;
    ctx.fillStyle = '#9fb0d0';
    ctx.font = '12px ui-monospace, monospace';
    const lines = [
        `state: ${a.state.fsm}`,
        `vel:   (${a.kin.vel.x.toFixed(0)}, ${a.kin.vel.y.toFixed(0)})`,
        `ground:${a.state.grounded}  wall:${a.state.wall}`,
        `[sh] gravity+rungs  [♪] beat-bounce  [txt] grow/float  [ERR] close=BOOM`,
    ];
    lines.forEach((l, i) => ctx.fillText(l, 10, 16 + i * 15));
}
//# sourceMappingURL=render.js.map