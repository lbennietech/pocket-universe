/*
 * Pocket Universe: physics invariant tests
 * Copyright (c) 2026 Luke Bennie <lukebennie@gmail.com>. All rights reserved.
 *
 * Injected (with bench/scenes.js) by run_tests.py. window.__puInvariants()
 * runs every check synchronously through the test hook and returns a list of
 * { name, pass, detail }. Tolerances, chosen for the game's leapfrog
 * integrator (second order, symplectic, with the game's softening EPS2).
 * Every constant and formula comes from the test hook, never a local copy:
 *   energy drift        ≤ 0.1% over 10,000 steps at the largest step DT
 *   momentum            ≤ 1e-9 of Σ m|v| (only rounding error should remain)
 *   tunnelling          must collide at up to 450 km/s (a hard normal throw)
 *   step-size stability ≤ 0.1% drift at DT, DT/4 and DT/16 over the same time
 */
(() => {
  function energy(bodies) {
    const EPS2 = window.__pu.EPS2;
    let K = 0, U = 0;
    for (let i = 0; i < bodies.length; i++) {
      const a = bodies[i];
      K += 0.5 * a.m * (a.vx * a.vx + a.vy * a.vy);
      for (let j = i + 1; j < bodies.length; j++) {
        const b = bodies[j], dx = b.x - a.x, dy = b.y - a.y;
        U -= a.m * b.m / Math.sqrt(dx * dx + dy * dy + EPS2);
      }
    }
    return K + U;
  }
  function momentum(bodies) {
    let px = 0, py = 0, scale = 0;
    for (const b of bodies) {
      px += b.m * b.vx; py += b.m * b.vy;
      scale += b.m * Math.hypot(b.vx, b.vy);
    }
    return { px, py, scale };
  }
  const finite = bodies => bodies.every(b => isFinite(b.x + b.y + b.vx + b.vy + b.m));
  function stateHash(P) {
    // exact bits of every body's state, plus every dust (tracer) particle's state
    const D = P.dustState;
    const parts = [P.bodies.length, D.n, P.simTime];
    for (const b of P.bodies) parts.push(b.x, b.y, b.vx, b.vy, b.m);
    for (let i = 0; i < D.n; i++) parts.push(D.x[i], D.y[i], D.vx[i], D.vy[i]);
    return parts.map(v => v.toString(36)).join(',');
  }

  // A calm closed system: a Sun and eight planets on well-separated circular
  // orbits (0.5 to 4 AU), so nothing merges and energy should be conserved.
  function calmSystem(P, seed) {
    P.stopLoop();
    P.loadScene('empty');
    P.seed(seed);
    const M = P.MSUN, AU = P.AU;
    P.addBody(P.makeBody(0, 0, 0, 0, M, 'star'));
    const radii = [0.5, 0.8, 1.1, 1.5, 2.0, 2.6, 3.2, 4.0];
    radii.forEach((rAU, i) => {
      const r = rAU * AU, a = i * 2.39996, v = P.circV(M, r);
      P.addBody(P.makeBody(Math.cos(a) * r, Math.sin(a) * r, -Math.sin(a) * v, Math.cos(a) * v, 5 + i, 'planet'));
    });
    // zero the total momentum so the system stays put
    let mx = 0, my = 0, mt = 0;
    for (const b of P.bodies) { mx += b.m * b.vx; my += b.m * b.vy; mt += b.m; }
    for (const b of P.bodies) { b.vx -= mx / mt; b.vy -= my / mt; }
    P.settle();
  }

  window.__puInvariants = function () {
    const P = window.__pu, checks = [];
    const check = (name, pass, detail) => checks.push({ name, pass: !!pass, detail });
    const kms = P.KMS;   // one velocity unit in km/s

    // 1. Determinism: same seed, same frames, identical state
    // 97 frames (not a multiple of the 6- and 30-frame cadences), with a
    // different amount of play before each run, so leftover frame counters show up
    const runSeeded = before => {
      window.__puBuild('small', 9);
      P.tick(before);
      window.__puBuild('medium', 42);
      P.setRate(40);
      P.tick(97);
      return stateHash(P);
    };
    const h1 = runSeeded(0), h2 = runSeeded(13);
    check('deterministic: same seed and frames give an identical state', h1 === h2,
      { length: h1.length, firstDifference: h1 === h2 ? null : [...h1].findIndex((c, i) => c !== h2[i]) });

    // 2 and 3. Energy and momentum over 10,000 steps at the largest step
    calmSystem(P, 7);
    const E0 = energy(P.bodies), p0 = momentum(P.bodies), n0 = P.bodies.length;
    P.physics(10000, P.DT);
    const E1 = energy(P.bodies), p1 = momentum(P.bodies);
    const drift = Math.abs((E1 - E0) / E0);
    check('energy drift ≤ 0.1% over 10,000 steps', P.bodies.length === n0 && drift <= 1e-3,
      { drift: drift.toExponential(2), bodies: P.bodies.length });
    const dp = Math.hypot(p1.px - p0.px, p1.py - p0.py) / p0.scale;
    check('momentum conserved to rounding error', dp <= 1e-9, { relativeChange: dp.toExponential(2) });

    // 4. Numerical sanity under stress: a dense swarm plus a 1,000 M☉ black hole at top speed
    window.__puBuild('collision-pileup', 3);
    P.addBody(P.makeBody(-3000, 0, 60, 0, 1000 * P.MSUN, 'bh'));
    P.settle();
    P.setRate(200);
    P.tick(600);
    check('no NaN or Infinity after a stress run', finite(P.bodies),
      { bodies: P.bodies.length, simYears: +(P.simTime / P.YEAR).toFixed(2) });

    // 5. Tunnelling: a planet at 450 km/s must hit a small star, whatever the offset
    const speed = 450 / kms;
    let hits = 0;
    const offsets = [0, 0.25, 0.5, 0.75, 0.9];
    for (const f of offsets) {
      P.loadScene('empty');
      P.seed(5);
      const star = P.makeBody(0, 0, 0, 0, P.IGNITE * 1.25, 'star');
      P.addBody(star);
      const reach = star.cr + P.radiusFor(12, 'planet') * 1.4;
      P.addBody(P.makeBody(-4000, f * reach, speed, 0, 12, 'planet'));
      P.settle();
      for (let i = 0; i < 2000 && P.bodies.length > 1; i++) P.physics(1, P.DT);
      if (P.bodies.length === 1) hits++;
    }
    check('no tunnelling at 450 km/s', hits === offsets.length, { hits, tries: offsets.length, speedKms: 450 });

    // 6. Step-size stability: same span of time at three step sizes
    const drifts = [];
    for (const k of [1, 4, 16]) {
      calmSystem(P, 7);
      const e0 = energy(P.bodies);
      P.physics(2000 * k, P.DT / k);
      drifts.push(Math.abs((energy(P.bodies) - e0) / e0));
    }
    check('stable at DT, DT/4 and DT/16', drifts.every(d => d <= 1e-3) && finite(P.bodies),
      { drifts: drifts.map(d => d.toExponential(2)) });

    // and through real frames across the slider: slowest, default and fastest
    const rateDrifts = [];
    for (const r of [0.05, 4, 200]) {
      calmSystem(P, 7);
      P.setRate(r);
      const e0 = energy(P.bodies);
      P.tick(600);
      rateDrifts.push(Math.abs((energy(P.bodies) - e0) / e0));
    }
    check('stable across the speed slider', rateDrifts.every(d => d <= 1e-3) && finite(P.bodies),
      { drifts: rateDrifts.map(d => d.toExponential(2)) });

    // 7. Every scene starts with (near) zero net momentum, so its center of
    // mass stays put instead of drifting off-screen over time (CODE-010).
    const sceneDrifts = [];
    for (const key of ['galaxies', 'cradle', 'feast', 'eight', 'formation', 'binary', 'mayhem']) {
      P.seed(11);
      P.loadScene(key);
      const p = momentum(P.bodies);
      sceneDrifts.push([key, p.scale ? Math.hypot(p.px, p.py) / p.scale : 0]);
    }
    check('every scene starts with net momentum near zero', sceneDrifts.every(([, d]) => d <= 1e-6),
      { drifts: sceneDrifts.map(([k, d]) => `${k}: ${d.toExponential(2)}`) });

    return checks;
  };
})();
