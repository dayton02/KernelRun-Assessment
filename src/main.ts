// Entry point: wires canvas + pointer to the ECS world, runs the fixed-step
// accumulator loop (frame-rate independent), and drives the Kernel Run game
// loop on top of the stable physics.

import { CONFIG, FLOW } from './config.js';
import { World } from './world.js';
import { stepWorld, springPopWindow } from './systems.js';
import { render } from './render.js';
import { WindowKind } from './components.js';
import { makeGameState, buildLevel, gameSystem, canSpawn } from './game.js';
import { initAudio } from './audio.js';

export function boot(canvas: HTMLCanvasElement): void {
  const ctx = canvas.getContext('2d')!;
  const world = new World(canvas.width, canvas.height);
  const game = makeGameState();
  buildLevel(world, game);   // spawn + sink + starter platforms

  // pointer wiring
  const setPos = (e: { clientX: number; clientY: number }) => {
    const rect = canvas.getBoundingClientRect();
    world.pointer.x = (e.clientX - rect.left) * (canvas.width / rect.width);
    world.pointer.y = (e.clientY - rect.top) * (canvas.height / rect.height);
  };
  // Press bookkeeping to tell a quick CLICK (spring-pop) from a DRAG, and to
  // start a marquee when the press lands on empty wallpaper.
  let pressT = 0, pressX = 0, pressY = 0, pressWin = false, marqueeStarted = false;

  canvas.addEventListener('pointerdown', (e) => {
    initAudio();                       // browsers require a gesture to start audio
    setPos(e); world.pointer.down = true; world.pointer.pressed = true;
    canvas.setPointerCapture(e.pointerId);
    pressT = performance.now(); pressX = world.pointer.x; pressY = world.pointer.y;
    const hit = world.topWindowAt(world.pointer.x, world.pointer.y);
    pressWin = !!hit;
    marqueeStarted = false;
    // press on empty wallpaper starts a marquee net (recovery tool)
    if (!hit) {
      world.marquee.active = true;
      world.marquee.x0 = world.pointer.x; world.marquee.y0 = world.pointer.y;
      world.marquee.x1 = world.pointer.x; world.marquee.y1 = world.pointer.y;
      marqueeStarted = true;
    }
  });
  canvas.addEventListener('pointermove', (e) => {
    setPos(e);
    if (marqueeStarted && world.marquee.active) {
      world.marquee.x1 = world.pointer.x; world.marquee.y1 = world.pointer.y;
    }
  });
  canvas.addEventListener('pointerup', (e) => {
    setPos(e); world.pointer.down = false; world.pointer.released = true;
    const dt = performance.now() - pressT;
    const moved = Math.hypot(world.pointer.x - pressX, world.pointer.y - pressY);
    // Click-to-Spring: a quick, near-stationary click on a window pops it.
    if (pressWin && dt <= FLOW.spring.clickMaxMs && moved <= FLOW.spring.clickMaxMove) {
      const hit = world.topWindowAt(pressX, pressY);
      if (hit) springPopWindow(world, hit);
    }
    // release the marquee (it is a transient clutch tool, not a permanent floor)
    world.marquee.active = false;
    marqueeStarted = false;
  });

  // Spacebar also spring-pops the window under the cursor (keyboard affordance).
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space') {
      e.preventDefault();
      const hit = world.topWindowAt(world.pointer.x, world.pointer.y);
      if (hit) springPopWindow(world, hit);
    }
  });

  // Double-click empty desktop to spawn a new platform — gated by the RAM
  // budget. This is the "players must close/resize trailing windows to make
  // room for new ones" constraint made interactive.
  canvas.addEventListener('dblclick', (e) => {
    setPos(e);
    const onWindow = world.topWindowAt(world.pointer.x, world.pointer.y);
    if (onWindow) return;              // only spawn on empty desktop
    if (!canSpawn(world, game)) return; // RAM (base+leak) full -> blocked
    const w = 150, h = 90;
    // keep the spawned window on one side of the firewall
    let sx = Math.max(0, world.pointer.x - w / 2);
    const barL = world.firewallX - world.firewallW / 2;
    const barR = world.firewallX + world.firewallW / 2;
    if (world.pointer.x < world.firewallX) sx = Math.min(sx, barL - w);
    else sx = Math.max(sx, barR);
    world.spawnWindow(sx, Math.max(40, world.pointer.y - h / 2), w, h, 'scratch.win', 265, WindowKind.PLAIN);
  });

  // fixed-step accumulator
  let last = performance.now();
  let acc = 0;
  function frame(now: number): void {
    acc += Math.min(0.1, (now - last) / 1000); // clamp long stalls
    last = now;
    while (acc >= CONFIG.dt) {
      stepWorld(world, CONFIG.dt);     // physics (unchanged, stable)
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
  const el = document.getElementById('stage') as HTMLCanvasElement | null;
  if (el) boot(el);
}
