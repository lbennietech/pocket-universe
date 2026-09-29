// Pocket Universe: main loop
// Copyright (c) 2026 Luke Bennie <lukebennie@gmail.com>. All rights reserved.
//
// The requestAnimationFrame loop and advance(): one frame of input
// timers, simulation steps, camera and drawing; plus the perf timers.
//
// One of the src/*.js files that tools/build.py joins, in order, into a single
// shared scope inside index.html; names defined in the other files are in
// scope here. See docs/ARCHITECTURE.md for the layout.

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------
// Optional timing for benchmarks. When perf.on is false (always, in normal
// play) the only cost is two boolean checks a frame.
const perf = { on: false, physics: 0, render: 0 };
let loopOn = true;
let lastTime = performance.now();
function frame(now) {
  if (!loopOn) return;
  requestAnimationFrame(frame);
  const elapsed = Math.max(0, Math.min(50, now - lastTime));
  lastTime = now;
  advance(elapsed);
}

// One frame of the game: input timers, simulation, camera and drawing.
function advance(elapsed) {
  frameN++;

  T.px.set(T.x.subarray(0, T.n));
  T.py.set(T.y.subarray(0, T.n));

  checkLongPress();
  if (hover && frameN % 10 === 0) updateCursor();

  const tPhys = perf.on ? performance.now() : 0;
  if (!paused) {
    // Advance simulated time by rate × real time, in substeps no longer
    // than DT. Slow speeds take one short step per frame, so motion stays
    // smooth; if a crowded scene would take too long, it runs slower instead.
    const want = rate * elapsed / 1000;
    let got = want;
    if (want > 4 * DT) got = block(want, 1.5e6);
    else {
      let sub = Math.max(1, Math.ceil(want / DT));
      const dt = want / sub;
      const n = bodies.length;
      const heavy = bodies.reduce((c, b) => c + (isHeavy(b) ? 1 : 0), 0);
      const work = n * (n - 1) / 2 + T.n * heavy + 1;
      sub = Math.min(sub, Math.max(1, Math.floor(1.1e6 / work)));
      got = sub * dt;
      trailS = 0;
      for (let s = 0; s < sub; s++) {
        step(dt);
        // trail points and comet dust follow simulated time
        for (const b of bodies) trailTo(b, simTime);
        if (simTime - shedClock >= SHED_DT) { shedComets(); shedClock += SHED_DT; }
      }
    }
    if (elapsed > 0) ach += (got * 1000 / elapsed - ach) * 0.1;
    lights = bodies.filter(b => b.kind === 'star');
    if (frameN % 6 === 0) { updateLife(simTime - lifeClock); lifeClock = simTime; }
    if (frameN % 30 === 0) cull();
    for (const b of bodies) {
      b.feed *= 0.97;
      b.spin += reduceMotion ? 0.008 : 0.035;
    }
    for (const f of effects) {
      f.life--;
      if (f.kind === 'wave') f.rad += 12 / cam.z;
    }
    effects = effects.filter(f => f.life > 0);
  }
  // the flash and shake settle even while paused
  flash *= 0.92;
  shake *= 0.9;
  if (selected && selected.dead) deselect();

  // the camera holds still while a throw is being aimed, so the arrow
  // always matches the throw
  if (aim) {
    /* hold */
  } else if (selected && follow) {
    followK = Math.min(1, followK + 0.05);
    const k = 0.08 + 0.92 * followK * followK;
    cam.x += (selected.x - cam.x) * k;
    cam.y += (selected.y - cam.y) * k;
  } else if (cam.target) {
    cam.x += (cam.target.x - cam.x) * 0.12;
    cam.y += (cam.target.y - cam.y) * 0.12;
    if (Math.hypot(cam.target.x - cam.x, cam.target.y - cam.y) < 0.5 / cam.z) cam.target = null;
  }

  const tRender = perf.on ? performance.now() : 0;
  render();
  if (perf.on) { perf.physics = tRender - tPhys; perf.render = performance.now() - tRender; }
  if (frameN % 8 === 0) { updateHud(); updateCard(); showRate(); }
  flushTallies();
}

let resizeRaf = 0;
addEventListener('resize', () => {
  cancelAnimationFrame(resizeRaf);
  resizeRaf = requestAnimationFrame(resize);
});
