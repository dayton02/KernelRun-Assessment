// Entry point: wires canvas + pointer to the ECS world, runs the fixed-step
// accumulator loop (frame-rate independent), and drives the Kernel Run game
// loop on top of the stable physics.
import { CONFIG, FLOW } from './config.js';
import { World } from './world.js';
import { stepWorld } from './systems.js';
import { render } from './render.js';
import { makeGameState, buildLevel, gameSystem, canSpawn, restartGame, GamePhase, SPAWNABLE_KINDS, spawnableLabel, hueFor } from './game.js';
import { initAudio, setMusicEnabled } from './audio.js';
export function boot(canvas) {
    const ctx = canvas.getContext('2d');
    // Size the canvas to its DISPLAYED area at device-pixel resolution so it is
    // crisp (not a small 820x620 buffer stretched by CSS), and give the World
    // that full logical size for a bigger play space. Game coordinates are in CSS
    // pixels; the backing store is CSS size x devicePixelRatio.
    const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
    const rect0 = canvas.getBoundingClientRect();
    const cssW = Math.max(640, Math.round(rect0.width || 820));
    const cssH = Math.max(480, Math.round(rect0.height || 620));
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); // draw in CSS-pixel units
    const world = new World(cssW, cssH);
    const game = makeGameState();
    buildLevel(world, game); // spawn + sink + starter platforms
    // The game is PAUSED until the player clicks to start. The loop still renders
    // (so the title layout + a dimmed board show through) but does not step the
    // simulation, so the packet doesn't move before the player is ready.
    let started = false;
    // pointer wiring: map client coords -> CSS-pixel world coords
    const setPos = (e) => {
        const rect = canvas.getBoundingClientRect();
        world.pointer.x = (e.clientX - rect.left) * (world.width / rect.width);
        world.pointer.y = (e.clientY - rect.top) * (world.height / rect.height);
    };
    let marqueeStarted = false;
    canvas.addEventListener('pointerdown', (e) => {
        initAudio(); // browsers require a gesture to start audio
        setPos(e);
        // First click starts the game (and nothing else that frame).
        if (!started) {
            started = true;
            return;
        }
        // A click on the GAME OVER screen restarts a fresh run.
        if (game.phase === GamePhase.GAME_OVER) {
            restartGame(world, game);
            return;
        }
        world.pointer.down = true;
        world.pointer.pressed = true;
        canvas.setPointerCapture(e.pointerId);
        const hit = world.topWindowAt(world.pointer.x, world.pointer.y);
        marqueeStarted = false;
        // press on empty wallpaper starts a marquee net (recovery tool). It gets a
        // limited number of catches and is consumed as it saves the packet.
        if (!hit) {
            world.marquee.active = true;
            world.marquee.x0 = world.pointer.x;
            world.marquee.y0 = world.pointer.y;
            world.marquee.x1 = world.pointer.x;
            world.marquee.y1 = world.pointer.y;
            world.marquee.charges = FLOW.marquee.charges;
            world.marquee.cool = 0;
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
        // release the marquee (it is a transient clutch tool, not a permanent floor)
        world.marquee.active = false;
        marqueeStarted = false;
    });
    // 'M' toggles the background music without affecting the sound effects.
    let musicOn = true;
    window.addEventListener('keydown', (e) => {
        if (e.code === 'KeyM') {
            musicOn = !musicOn;
            setMusicEnabled(musicOn);
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
    // fixed-step accumulator — only steps the sim once the game has started.
    let last = performance.now();
    let acc = 0;
    function frame(now) {
        const elapsed = Math.min(0.1, (now - last) / 1000); // clamp long stalls
        last = now;
        if (started) {
            acc += elapsed;
            while (acc >= CONFIG.dt) {
                stepWorld(world, CONFIG.dt); // physics (unchanged, stable)
                gameSystem(world, game, CONFIG.dt); // game loop AFTER physics
                acc -= CONFIG.dt;
            }
        }
        else {
            acc = 0; // don't accumulate time while paused
        }
        render(ctx, world, game, started); // render passes the started flag for the overlay
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