// Entry point: wires canvas + pointer to the ECS world, runs the fixed-step
// accumulator loop (frame-rate independent), and drives the Kernel Run game
// loop on top of the stable physics.
import { CONFIG } from './config.js';
import { World } from './world.js';
import { stepWorld } from './systems.js';
import { render } from './render.js';
import { WindowKind } from './components.js';
import { makeGameState, buildLevel, gameSystem, canSpawn } from './game.js';
import { initAudio } from './audio.js';
export function boot(canvas) {
    const ctx = canvas.getContext('2d');
    const world = new World(canvas.width, canvas.height);
    const game = makeGameState();
    buildLevel(world, game); // spawn + sink + starter platforms
    // pointer wiring
    const setPos = (e) => {
        const rect = canvas.getBoundingClientRect();
        world.pointer.x = (e.clientX - rect.left) * (canvas.width / rect.width);
        world.pointer.y = (e.clientY - rect.top) * (canvas.height / rect.height);
    };
    canvas.addEventListener('pointerdown', (e) => {
        initAudio(); // browsers require a gesture to start audio
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
    // Double-click empty desktop to spawn a new platform — gated by the RAM
    // budget. This is the "players must close/resize trailing windows to make
    // room for new ones" constraint made interactive.
    canvas.addEventListener('dblclick', (e) => {
        setPos(e);
        const onWindow = world.topWindowAt(world.pointer.x, world.pointer.y);
        if (onWindow)
            return; // only spawn on empty desktop
        if (!canSpawn(world, game))
            return; // RAM (base+leak) full -> blocked
        const w = 150, h = 90;
        // keep the spawned window on one side of the firewall
        let sx = Math.max(0, world.pointer.x - w / 2);
        const barL = world.firewallX - world.firewallW / 2;
        const barR = world.firewallX + world.firewallW / 2;
        if (world.pointer.x < world.firewallX)
            sx = Math.min(sx, barL - w);
        else
            sx = Math.max(sx, barR);
        world.spawnWindow(sx, Math.max(40, world.pointer.y - h / 2), w, h, 'scratch.win', 265, WindowKind.PLAIN);
    });
    // fixed-step accumulator
    let last = performance.now();
    let acc = 0;
    function frame(now) {
        acc += Math.min(0.1, (now - last) / 1000); // clamp long stalls
        last = now;
        while (acc >= CONFIG.dt) {
            stepWorld(world, CONFIG.dt); // physics (unchanged, stable)
            gameSystem(world, game, CONFIG.dt); // game loop AFTER physics
            acc -= CONFIG.dt;
        }
        render(ctx, world, game);
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