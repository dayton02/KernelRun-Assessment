// RenderSystem — draws windows by z-order, then the agent, then the HUD.
import { FsmState, WindowKind } from './components.js';
import { GAME } from './config.js';
import { GamePhase, predictFlickArc, overlapsDropZone, SPAWNABLE_KINDS, spawnableLabel } from './game.js';
const KIND_TAG = {
    [WindowKind.PLAIN]: '',
    [WindowKind.TERMINAL]: ' [sh]',
    [WindowKind.MEDIA]: ' [♪]',
    [WindowKind.EDITOR]: ' [txt]',
    [WindowKind.BSOD]: ' [ERR]',
    [WindowKind.SPAWN]: ' [SRC]',
    [WindowKind.SINK]: ' [DST]',
    [WindowKind.ALERT]: ' [!]',
};
export function render(ctx, world, game) {
    ctx.clearRect(0, 0, world.width, world.height);
    // --- screen shake (Part 8): offset the whole scene on a delivery ---
    ctx.save();
    if (game && game.shake > 0) {
        const s = game.shake;
        ctx.translate((Math.random() * 2 - 1) * s, (Math.random() * 2 - 1) * s);
    }
    // desktop backdrop
    ctx.fillStyle = '#0b1020';
    ctx.fillRect(-20, -20, world.width + 40, world.height + 40);
    drawGrid(ctx, world);
    drawFirewall(ctx, world);
    const sorted = [...world.windows].sort((a, b) => a.rect.z - b.rect.z);
    for (const w of sorted) {
        const fade = w.style.closing > 0 ? Math.max(0, 1 - w.style.closing / 0.35) : 1;
        // Leapfrog decommission pulse: blink while counting down to dissolve.
        const decommission = w.drag.recycleTimer > 0;
        const blink = decommission ? 0.55 + 0.45 * Math.sin(w.drag.recycleTimer * 18) : 1;
        ctx.globalAlpha = fade * (decommission ? blink : 1);
        const r = w.rect;
        // body
        ctx.fillStyle = decommission ? 'hsl(135 45% 22%)' : `hsl(${w.style.hue} 30% 16%)`;
        ctx.fillRect(r.x, r.y, r.w, r.h);
        ctx.strokeStyle = decommission ? '#6cff9a' : `hsl(${w.style.hue} 60% 55%)`;
        ctx.lineWidth = 2;
        ctx.strokeRect(r.x, r.y, r.w, r.h);
        // retro bitmap "dissolve" dither while fading out
        if (w.style.closing > 0) {
            ctx.fillStyle = 'rgba(120,255,170,0.5)';
            const prog = w.style.closing / 0.35;
            for (let yy = 0; yy < r.h; yy += 4) {
                for (let xx = 0; xx < r.w; xx += 4) {
                    if (((xx + yy) / 4 % 3 === 0) && Math.random() < prog)
                        ctx.fillRect(r.x + xx, r.y + yy, 3, 3);
                }
            }
        }
        // archetype-specific body decoration (drawn under the title bar)
        drawArchetype(ctx, w);
        // title bar (one-way platform) — brighten on a media beat
        let barL = 42;
        if (w.arch.kind === WindowKind.MEDIA)
            barL = 42 + 28 * w.arch.beatPulse;
        if (decommission)
            barL = 50;
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
    // trajectory arc preview (dots) when a rapid flick is building
    if (game) {
        const arc = predictFlickArc(world);
        for (let i = 0; i < arc.length; i++) {
            const p = arc[i];
            const t = 1 - i / arc.length;
            ctx.globalAlpha = 0.3 + 0.5 * t;
            ctx.fillStyle = '#ffe08a';
            ctx.beginPath();
            ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.globalAlpha = 1;
    }
    // marquee safety net (drawn over windows, under the packet/HUD)
    drawMarquee(ctx, world);
    // agent (the data packet)
    const a = world.agent;
    const dissolving = game?.phase === GamePhase.DISSOLVING;
    const wobbling = a.state.wobble > 0;
    ctx.globalAlpha = dissolving ? Math.max(0, game.freeze / 0.9) : 1;
    ctx.save();
    ctx.translate(a.tf.pos.x, a.tf.pos.y);
    if (wobbling) {
        // oscillating "stumble" rotation telegraphing the imminent slip
        ctx.rotate(Math.sin(Date.now() / 30) * 0.5);
    }
    ctx.beginPath();
    ctx.arc(0, 0, a.shape.radius, 0, Math.PI * 2);
    ctx.fillStyle = wobbling ? '#ffd166' : stateColor(a.state.fsm);
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();
    ctx.fillStyle = '#0b1020';
    ctx.font = '9px ui-monospace, monospace';
    ctx.fillText('0', -2.5, 3);
    ctx.restore();
    // yellow alert icon above a wobbling packet
    if (wobbling) {
        ctx.fillStyle = '#ffd166';
        ctx.font = '14px system-ui, sans-serif';
        ctx.fillText('⚠', a.tf.pos.x - 6, a.tf.pos.y - a.shape.radius - 6);
    }
    ctx.globalAlpha = 1;
    // taskbar + kill line
    drawTaskbar(ctx, world, game);
    ctx.restore(); // end screen-shake transform
    if (game)
        drawGameHud(ctx, world, game);
    else
        drawHud(ctx, world);
}
function drawMarquee(ctx, world) {
    const m = world.marquee;
    if (!m.active)
        return;
    const x = Math.min(m.x0, m.x1), y = Math.min(m.y0, m.y1);
    const w = Math.abs(m.x1 - m.x0), h = Math.abs(m.y1 - m.y0);
    // standard translucent blue OS selection box
    ctx.fillStyle = 'rgba(90,150,255,0.15)';
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = 'rgba(130,180,255,0.9)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, w, h);
    // highlight the TOP edge — the elastic trampoline surface
    ctx.strokeStyle = '#8fd0ff';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + w, y);
    ctx.stroke();
}
function drawTaskbar(ctx, world, game) {
    const h = GAME.taskbarH;
    const y = world.height - h;
    ctx.fillStyle = '#141b2e';
    ctx.fillRect(0, y, world.width, h);
    // the kill line (top of the taskbar)
    ctx.strokeStyle = game && game.integrity <= 40 ? 'rgba(255,90,90,0.8)' : 'rgba(255,255,255,0.15)';
    ctx.setLineDash([6, 6]);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(world.width, y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#7f8db0';
    ctx.font = '11px ui-monospace, monospace';
    ctx.fillText('▣ taskbar — falling past this line costs Data Integrity', 10, y + 18);
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
        case WindowKind.SPAWN: {
            // emit "port" at the right edge
            ctx.fillStyle = '#7fd0ff';
            ctx.fillRect(r.x + r.w - 10, r.y - 6, 10, 10);
            ctx.fillStyle = '#9fb0d0';
            ctx.font = '11px ui-monospace, monospace';
            ctx.fillText('↓ downloading → EJECT →', r.x + 10, r.y + r.h / 2);
            break;
        }
        case WindowKind.SINK: {
            // active drop zone (the body), pulsing to invite delivery
            const zy = r.y + w.drag.titleBarH;
            const pulse = 0.12 + 0.08 * Math.abs(Math.sin(Date.now() / 300));
            ctx.fillStyle = `rgba(120,255,170,${pulse})`;
            ctx.fillRect(r.x, zy, r.w, r.h - w.drag.titleBarH);
            ctx.strokeStyle = 'rgba(120,255,170,0.6)';
            ctx.setLineDash([5, 4]);
            ctx.strokeRect(r.x + 4, zy + 4, r.w - 8, r.h - w.drag.titleBarH - 8);
            ctx.setLineDash([]);
            ctx.fillStyle = '#bfffe0';
            ctx.font = '12px ui-monospace, monospace';
            ctx.fillText('DROP ZONE', r.x + r.w / 2 - 34, zy + (r.h - w.drag.titleBarH) / 2);
            break;
        }
        case WindowKind.ALERT: {
            // countdown ring/number — green while bonus is live, red as it expires
            const frac = Math.max(0, w.arch.alertTimer / w.arch.alertMax);
            ctx.fillStyle = frac > 0.3 ? '#8affc0' : '#ff6b6b';
            ctx.fillRect(r.x, r.y + r.h - 5, r.w * frac, 5);
            ctx.fillStyle = '#ffe08a';
            ctx.font = '12px ui-monospace, monospace';
            ctx.fillText(`⚠ ${w.arch.alertTimer.toFixed(1)}s  +50% if flicked`, r.x + 8, r.y + r.h / 2);
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
function drawFirewall(ctx, world) {
    const x = world.firewallX - world.firewallW / 2;
    const bottom = world.height - GAME.taskbarH;
    // hazard-striped immovable barrier from top to the taskbar
    const grad = ctx.createLinearGradient(x, 0, x + world.firewallW, 0);
    grad.addColorStop(0, 'rgba(255,90,90,0.15)');
    grad.addColorStop(0.5, 'rgba(255,120,120,0.55)');
    grad.addColorStop(1, 'rgba(255,90,90,0.15)');
    ctx.fillStyle = grad;
    ctx.fillRect(x, 0, world.firewallW, bottom);
    // diagonal hazard ticks
    ctx.strokeStyle = 'rgba(255,170,170,0.35)';
    ctx.lineWidth = 2;
    for (let y = 0; y < bottom; y += 16) {
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + world.firewallW, y + 8);
        ctx.stroke();
    }
    ctx.save();
    ctx.translate(world.firewallX, bottom - 8);
    ctx.rotate(-Math.PI / 2);
    ctx.fillStyle = 'rgba(255,200,200,0.7)';
    ctx.font = '10px ui-monospace, monospace';
    ctx.fillText('FIREWALL', 0, 3);
    ctx.restore();
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
function bar(ctx, x, y, w, h, frac, fill, label) {
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = fill;
    ctx.fillRect(x, y, w * Math.max(0, Math.min(1, frac)), h);
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, w, h);
    ctx.fillStyle = '#eaf0ff';
    ctx.font = '11px ui-monospace, monospace';
    ctx.fillText(label, x, y - 4);
}
function drawGameHud(ctx, world, g) {
    // title
    ctx.fillStyle = '#eaf0ff';
    ctx.font = '13px system-ui, sans-serif';
    ctx.fillText('KERNEL RUN — deliver the packet to Backup_Drive (D:)', 10, 20);
    // Data Integrity bar
    const integCol = g.integrity > 60 ? '#6cff9a' : g.integrity > 30 ? '#ffd166' : '#ff6b6b';
    bar(ctx, 10, 40, 180, 12, g.integrity / GAME.integrityStart, integCol, `Data Integrity ${g.integrity}%`);
    // Memory Usage (RAM) bar — leaks continuously; closing windows recovers it
    const ramFrac = g.ram / GAME.ramMax;
    const ramCol = ramFrac < 0.75 ? '#7fd0ff' : ramFrac < 0.96 ? '#ffd166' : '#ff6b6b';
    const leakTag = g.leakedRam > 0.5 ? ` (leak +${g.leakedRam.toFixed(0)})` : '';
    bar(ctx, 10, 72, 180, 12, ramFrac, ramCol, `Memory Usage ${g.ram.toFixed(0)}%${leakTag}`);
    if (ramFrac >= GAME.ramSpawnBlock / GAME.ramMax) {
        ctx.fillStyle = '#ff9b9b';
        ctx.font = '10px ui-monospace, monospace';
        ctx.fillText('RAM critical — close windows (X) before GC sweep!', 10, 98);
    }
    // scoreboard
    ctx.fillStyle = '#7f8db0';
    ctx.font = '11px ui-monospace, monospace';
    ctx.fillText(`delivered: ${g.wins}  resets: ${g.resets}  GC: ${g.gcSweeps}`, world.width - 230, 20);
    // streak + combo + difficulty (arcade pacing, Part 8)
    ctx.fillStyle = g.streak > 1 ? '#ffd166' : '#7f8db0';
    ctx.font = '600 15px system-ui, sans-serif';
    ctx.fillText(`STREAK ${g.streak}x`, world.width - 230, 40);
    if (g.combo > 0) {
        ctx.fillStyle = '#6cff9a';
        ctx.font = '12px ui-monospace, monospace';
        ctx.fillText(`recycle combo ${g.combo}x`, world.width - 230, 58);
    }
    ctx.fillStyle = '#7f8db0';
    ctx.font = '10px ui-monospace, monospace';
    ctx.fillText(`speed ${(g.speedMul * 100).toFixed(0)}%`, world.width - 230, 74);
    // next-spawn selector (wheel to cycle, double-click empty desktop to place)
    const nextKind = SPAWNABLE_KINDS[g.spawnPick];
    ctx.fillStyle = '#cfd8ec';
    ctx.font = '11px ui-monospace, monospace';
    ctx.fillText(`spawn ▸ ${spawnableLabel(nextKind)}  (wheel to change, dbl-click to place)`, 10, world.height - GAME.taskbarH - 10);
    // transient banner
    if (g.messageTtl > 0 && g.message) {
        ctx.globalAlpha = Math.min(1, g.messageTtl * 2);
        ctx.fillStyle = g.phase === GamePhase.WON ? '#6cff9a' : '#ffd166';
        ctx.font = '600 22px system-ui, sans-serif';
        const tw = ctx.measureText(g.message).width;
        ctx.fillText(g.message, (world.width - tw) / 2, world.height / 2 - 40);
        ctx.globalAlpha = 1;
    }
    // source eject-charge bar: shows the dwell filling while the packet is held
    const spawn = world.windows.find((w) => w.id === g.spawnId);
    if (spawn && world.agent.state.grounded && world.agent.state.groundEntity === spawn.id) {
        const frac = Math.min(1, world.agent.state.spawnDwell / GAME.spawn.dwell);
        ctx.fillStyle = 'rgba(127,208,255,0.25)';
        ctx.fillRect(spawn.rect.x, spawn.rect.y - 8, spawn.rect.w, 5);
        ctx.fillStyle = '#7fd0ff';
        ctx.fillRect(spawn.rect.x, spawn.rect.y - 8, spawn.rect.w * frac, 5);
    }
    // sink affordance hint arrow when far
    const sink = world.windows.find((w) => w.id === g.sinkId);
    const a = world.agent;
    if (sink && !overlapsDropZone(a.tf.pos.x, a.tf.pos.y, a.shape.radius, sink)) {
        ctx.fillStyle = 'rgba(120,255,170,0.5)';
        ctx.font = '11px ui-monospace, monospace';
        ctx.fillText('→ goal', sink.rect.x - 4, sink.rect.y - 8);
    }
}
//# sourceMappingURL=render.js.map