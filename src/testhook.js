// Pocket Universe: test hook
// Copyright (c) 2026 Luke Bennie <lukebennie@gmail.com>. All rights reserved.
//
// window.__pu, the read-only view of game state that tests/ and bench/
// use. Only exists when the test runner sets window.__PU_TEST__.
//
// One of the src/*.js files that tools/build.py joins, in order, into a single
// shared scope inside index.html; names defined in the other files are in
// scope here. See docs/ARCHITECTURE.md for the layout.

// Read-only view of game state for the automated tests in tests/. Only the
// test runner sets __PU_TEST__, so normal play never exposes it.
if (window.__PU_TEST__) {
  window.__pu = {
    cam,
    get bodies() { return bodies; }, get aim() { return aim; }, get rate() { return rate; },
    get simTime() { return simTime; }, get dust() { return T.n; },
    get dustState() { return { n: T.n, x: T.x.subarray(0, T.n), y: T.y.subarray(0, T.n), vx: T.vx.subarray(0, T.n), vy: T.vy.subarray(0, T.n) }; },
    get flash() { return flash; }, get shake() { return shake; },
    get selected() { return selected; }, get follow() { return follow; },
    aimMass: () => aim ? aimMass() : 0,
    aimStyle: m => aim ? aimStyle(m) : null,
    // engine constants and maths, so tests and benchmarks never keep their own copies
    radiusFor, circV, seededRand, MSUN, IGNITE, COLLAPSE, DWARF, LIFE_MIN, COMET_ICE, SHED_DT, AU, YEAR, KMS, EPS2, DT, MAX_T, RATE_MIN, RATE_DEFAULT, RATE_MAX, TOOLS, perf,
    sceneRate: key => SCENES[key].rate || RATE_DEFAULT,
    toScreen: o => [sx(o.x), sy(o.y)],
    // counters for the memory soak
    get sprites() { return spriteCache.size; }, get effects() { return effects.length; },
    // repeatable runs: seed the generator, stop the real-time loop and drive
    // whole frames (or bare physics steps) from the test
    seed(n) { rand = seededRand(n); },
    stopLoop() { loopOn = false; },
    tick(frames = 1, elapsedMs = 1000 / 60) { for (let i = 0; i < frames; i++) advance(elapsedMs); },
    physics(steps, dt = DT) { for (let i = 0; i < steps; i++) step(dt); },
    setRate, loadScene, makeBody, makeComet, supernova, kindName, addTracer,
    addBody(b) { bodies.push(b); },
    settle() { lights = bodies.filter(o => o.kind === 'star'); accel(); pairs.length = 0; },
    get pairs() { return pairs.length; }
  };
}
