// Entry point: wires canvas + pointer to the ECS world, runs the fixed-step
// accumulator loop (frame-rate independent), and drives the Kernel Run game
// loop on top of the stable physics.
import { CONFIG, FLOW } from './config.js';
import { World } from './world.js';
import { stepWorld } from './systems.js';
import { render } from './render.js';
import { makeGameState, buildLevel, gameSystem, canSpawn, SPAWNABLE_KINDS, spawnableLabel, hueFor } from './game.js';
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
    // Press bookkeeping to tell a quick CLICK (spring-pop) from a DRAG, and to
    // start a marquee when the press lands on empty wallpaper.
    let pressT = 0, pressX = 0, pressY = 0, pressWin = false, marqueeStarted = false;
    canvas.addEventListener('pointerdown', (e) => {
        initAudio(); // browsers require a gesture to start audio
        setPos(e);
        world.pointer.down = true;
        world.pointer.pressed = true;
        canvas.setPointerCapture(e.pointerId);
        pressT = performance.now();
        pressX = world.pointer.x;
        pressY = world.pointer.y;
        const hit = world.topWindowAt(world.pointer.x, world.pointer.y);
        pressWin = !!hit;
        marqueeStarted = false;
        // press on empty wallpaper starts a marquee net (recovery tool)
        if (!hit) {
            world.marquee.active = true;
            world.marquee.x0 = world.pointer.x;
            world.marquee.y0 = world.pointer.y;
            world.marquee.x1 = world.pointer.x;
            world.marquee.y1 = world.pointer.y;
            marqueeStarted = true;
        }
    });
    canvas.addEventListener('pointermove', (e) => {
        setPos(e);
        if (marqueeStarted && world.marquee.active) {
            world.marquee.x1 = world.pointer.x;
            world.marquee.y1 = world.pointer.y;
        }
    });
    canvas.addEventListener('pointerup', (e) => {
        setPos(e);
        world.pointer.down = false;
        world.pointer.released = true;
        const dt = performance.now() - pressT;
        const moved = Math.hypot(world.pointer.x - pressX, world.pointer.y - pressY);
        // Click-to-Spring: a quick, near-stationary click on a window requests a
        // spring pop. We do NOT call springPopWindow here (that raced the physics
        // loop); instead we set an intent the InputSystem resolves in-step.
        if (pressWin && dt <= FLOW.spring.clickMaxMs && moved <= FLOW.spring.clickMaxMove) {
            world.springRequest.pending = true;
            world.springRequest.x = pressX;
            world.springRequest.y = pressY;
        }
        // release the marquee (it is a transient clutch tool, not a permanent floor)
        world.marquee.active = false;
        marqueeStarted = false;
    });
    // Spacebar also requests a spring pop on the window under the cursor.
    window.addEventListener('keydown', (e) => {
        if (e.code === 'Space') {
            e.preventDefault();
            world.springRequest.pending = true;
            world.springRequest.x = world.pointer.x;
            world.springRequest.y = world.pointer.y;
        }
    });
    // Mouse wheel cycles which archetype the next spawn will create, so the
    // player can place terminals, media players, alerts, etc. — not just scratch
    // windows. This is how the special platforms "come back" after they dissolve.
    canvas.addEventListener('wheel', (e) => {
        e.preventDefault();
        const n = SPAWNABLE_KINDS.length;
        game.spawnPick = (game.spawnPick + (e.deltaY > 0 ? 1 : n - 1)) % n;
    }, { passive: false });
    // Double-click empty desktop to spawn the currently-selected platform kind —
    // gated by the RAM budget. Scroll-wheel to change the kind first.
    canvas.addEventListener('dblclick', (e) => {
        setPos(e);
        const onWindow = world.topWindowAt(world.pointer.x, world.pointer.y);
        if (onWindow)
            return; // only spawn on empty desktop
        if (!canSpawn(world, game))
            return; // RAM (base+leak) full -> blocked
        const kind = SPAWNABLE_KINDS[game.spawnPick];
        const w = 150, h = 90;
        // spawnWindow clamps X so the window never straddles the firewall; we only
        // center it on the cursor here.
        const sx = Math.max(0, world.pointer.x - w / 2);
        world.spawnWindow(sx, Math.max(40, world.pointer.y - h / 2), w, h, spawnableLabel(kind), hueFor(kind), kind);
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