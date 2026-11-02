// Entry point: wires canvas + pointer to the ECS world and runs the fixed-step
// accumulator loop (frame-rate independent — DESIGN.md Part 3 preamble).
import { CONFIG } from './config.js';
import { World } from './world.js';
import { stepWorld } from './systems.js';
import { render } from './render.js';
import { WindowKind } from './components.js';
export function boot(canvas) {
    const ctx = canvas.getContext('2d');
    const world = new World(canvas.width, canvas.height);
    // seed one of each archetype to play with (DESIGN.md Part 5)
    world.spawnWindow(90, 220, 200, 150, 'readme.txt', 210, WindowKind.PLAIN);
    world.spawnWindow(330, 300, 230, 150, 'bash', 150, WindowKind.TERMINAL);
    world.spawnWindow(600, 180, 200, 140, 'player.fm', 320, WindowKind.MEDIA);
    world.spawnWindow(150, 450, 180, 120, 'notes.txt', 50, WindowKind.EDITOR);
    world.spawnWindow(470, 470, 220, 120, 'SYSTEM_FAULT', 0, WindowKind.BSOD);
    // pointer wiring
    const setPos = (e) => {
        const rect = canvas.getBoundingClientRect();
        world.pointer.x = (e.clientX - rect.left) * (canvas.width / rect.width);
        world.pointer.y = (e.clientY - rect.top) * (canvas.height / rect.height);
    };
    canvas.addEventListener('pointerdown', (e) => {
        setPos(e);
        world.pointer.down = true;
        world.pointer.pressed = true;
        canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener('pointermove', setPos);
    canvas.addEventListener('pointerup', (e) => {
        setPos(e);
        world.pointer.down = false;
        world.pointer.released = true;
    });
    // fixed-step accumulator
    let last = performance.now();
    let acc = 0;
    function frame(now) {
        acc += Math.min(0.1, (now - last) / 1000); // clamp long stalls
        last = now;
        while (acc >= CONFIG.dt) {
            stepWorld(world, CONFIG.dt);
            acc -= CONFIG.dt;
        }
        render(ctx, world);
        requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
}
// auto-boot when loaded in a page that provides #stage
if (typeof document !== 'undefined') {
    const el = document.getElementById('stage');
    if (el)
        boot(el);
}
//# sourceMappingURL=main.js.map