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
 *   top of the slider   (block steps) deterministic; no tunnelling at 450 or
 *                       900 km/s; Binary keeps its planets within 5% of their
 *                       orbits and energy within 0.1% for 300 years
 *   limits              far throws and the original system aren't culled,
 *                       losses are reported in one counted notice, and a new
 *                       dust cloud always appears, even with the pool full
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
    P.setRate(P.RATE_MAX);
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

    // and through real frames across the slider: real time, slow, default and
    // 200 (12 years in 600 frames). The top of the slider has its own check
    // (15) on Binary: the calm system is chaotic over decades, and even fixed
    // steps of DT to DT/8 see its first merger anywhere from 80 to 230 years.
    const rateDrifts = [];
    let rateMerged = 0;
    for (const r of [P.RATE_MIN, 0.05, 4, 200]) {
      calmSystem(P, 7);
      P.setRate(r);
      const e0 = energy(P.bodies), n = P.bodies.length;
      P.tick(600);
      rateDrifts.push(Math.abs((energy(P.bodies) - e0) / e0));
      rateMerged += n - P.bodies.length;
    }
    check('stable across the speed slider', rateDrifts.every(d => d <= 1e-3) && !rateMerged && finite(P.bodies),
      { drifts: rateDrifts.map(d => d.toExponential(2)), merged: rateMerged });

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

    // 8. A heavy supernova still leaves a nebula: ejecta speeds keep pace with
    // the remnant's escape speed, so some of it escapes (PHYS-002)
    const nebula = [];
    for (const mSun of [20, 200]) {
      P.loadScene('empty');
      P.seed(3);
      const star = P.makeBody(0, 0, 0, 0, mSun * P.MSUN, 'star');
      P.addBody(star);
      P.settle();
      P.supernova(star);
      P.settle();
      P.physics(2000, P.DT);
      const D = P.dustState, far = 40 * star.r;
      let out = 0;
      for (let i = 0; i < D.n; i++) if (Math.hypot(D.x[i] - star.x, D.y[i] - star.y) > far) out++;
      nebula.push(out);
    }
    check('a supernova leaves a nebula at any mass', nebula.every(n => n >= 150),
      { escapedAt20: nebula[0], escapedAt200: nebula[1], of: 520 });

    // 9. A planet merger that crosses 13 M♃ repaints the survivor as a brown dwarf (PHYS-004)
    P.loadScene('empty');
    P.seed(4);
    const half = P.DWARF * 0.6;
    const pa = P.makeBody(0, 0, 0, 0, half, 'planet', 'rust');
    P.addBody(pa);
    P.addBody(P.makeBody(1, 0, 0, 0, half * 0.9, 'planet', 'ocean'));
    P.settle();
    P.physics(5, P.DT);
    const merged = P.bodies.length === 1 ? P.bodies[0] : null;
    check('a merger into a brown dwarf repaints it', merged && merged.style === 'dwarf' && P.kindName(merged) === 'Brown dwarf',
      { bodies: P.bodies.length, style: merged && merged.style, name: merged && P.kindName(merged) });

    // 10. Even the smallest star's habitable zone lies outside it, clear of a
    // life-sized planet touching its surface (PHYS-005)
    const hzClear = [];
    for (const f of [1, 1.25, 1.75, 3, 6]) {
      const s = P.makeBody(0, 0, 0, 0, P.IGNITE * f, 'star');
      const inner = 0.95 * Math.sqrt(s.lum) * P.AU, contact = s.cr + P.radiusFor(P.LIFE_MIN, 'planet') * 1.4;
      hzClear.push([+(s.m / P.MSUN).toFixed(2), +inner.toFixed(1), +contact.toFixed(1)]);
    }
    check('red dwarf habitable zones lie outside the star', hzClear.every(([, inner, contact]) => inner > contact),
      { massInnerContact: hzClear });

    // 11. A comet sheds a finite amount of dust, then goes dormant (PHYS-003)
    P.loadScene('empty');
    P.seed(6);
    P.addBody(P.makeBody(0, 0, 0, 0, P.MSUN, 'star'));
    const cr = 0.8 * P.AU, comet = P.makeComet(cr, 0, 0, P.circV(P.MSUN, cr), 0.5);
    P.addBody(comet);
    P.settle();
    P.setRate(200);
    const span = 1.5 * P.COMET_ICE * P.SHED_DT;   // 1.5× the time to shed the whole budget
    while (P.simTime < span) P.tick(60);
    check('a comet stops shedding when its ice runs out',
      !comet.icy && !comet.dead && P.dust <= P.COMET_ICE,
      { icy: comet.icy, dead: comet.dead, dust: P.dust, budget: P.COMET_ICE, name: P.kindName(comet) });

    // 12. The Formation disk builds planets, not brown dwarfs (PHYS-001). The
    // old disk had a brown dwarf by year 10; the tuned one stays under 13 M♃.
    P.stopLoop();
    P.seed(1);
    P.loadScene('formation');
    P.setRate(P.sceneRate('formation'));
    while (P.simTime < 20 * P.YEAR) P.tick(60);
    const biggest = P.bodies.reduce((m, b) => b.kind === 'planet' && b.m > m ? b.m : m, 0);
    check('the Formation scene grows planets, not brown dwarfs, by year 20', biggest > 0 && biggest <= P.DWARF,
      { biggestMJ: +(biggest / P.DWARF * 13).toFixed(2), limitMJ: 13 });

    // 13. Block steps at the top of the slider (PERF-010). Same seed and frames,
    // identical state, with a different amount of play before each run
    // Cradle, and Mayhem for its mid-frame mergers, supernovae and disruptions
    const topRun = (scene, before) => {
      window.__puBuild('small', 9);
      P.tick(before);
      P.seed(8);
      P.loadScene(scene);
      P.setRate(P.RATE_MAX);
      P.tick(47);
      return stateHash(P);
    };
    for (const scene of ['cradle', 'mayhem']) {
      const t1 = topRun(scene, 0), t2 = topRun(scene, 11);
      check(`deterministic at the top of the slider (${scene})`, t1 === t2,
        { length: t1.length, firstDifference: t1 === t2 ? null : [...t1].findIndex((c, i) => c !== t2[i]) });
    }

    // Block steps kick paired bodies at different times, so their pulls don't
    // cancel exactly; the leftover momentum is removed, or Eight walks away
    P.seed(1);
    P.loadScene('eight');
    P.setRate(P.RATE_MAX);
    const com = () => { let m = 0, x = 0, y = 0; for (const b of P.bodies) { m += b.m; x += b.m * b.x; y += b.m * b.y; } return [x / m, y / m]; };
    const c0 = com();
    P.tick(60);
    const c1 = com(), comMove = Math.hypot(c1[0] - c0[0], c1[1] - c0[1]);
    check('Eight stays put at the top of the slider', comMove < 50 && P.bodies.length === 3,
      { centreMoved: +comMove.toFixed(2), simYears: +(P.simTime / P.YEAR).toFixed(1) });

    // Debris born inside a frame (a star torn apart on a fly-by past a 10 M☉
    // hole) keeps sensible speeds at any rate: no grain over 3,000 km/s, and
    // the stream isn't swallowed by the star it came from (all but a few survive)
    const fastest = [];
    for (const yrs of [30, 1000]) {
      P.loadScene('empty');
      P.seed(2);
      const M = 10 * P.MSUN, hole = P.makeBody(0, 0, 0, 0, M, 'bh');
      P.addBody(hole);
      // a parabolic orbit whose closest approach is 0.8 of the tidal radius
      const rp = 0.8 * 2.2 * P.radiusFor(P.MSUN, 'star') * Math.cbrt(10), r0 = 1500, mu = M + P.MSUN;
      const vt = Math.sqrt(2 * mu * rp) / r0, vr = Math.sqrt(2 * mu / r0 - vt * vt);
      P.addBody(P.makeBody(-r0, 0, vr, vt, P.MSUN, 'star'));
      P.settle();
      P.setRate(yrs * P.YEAR);
      let f = 0;
      while (P.bodies.length > 1 && f++ < 600) P.tick(1);
      P.tick(20);
      const D = P.dustState;
      let vmax = 0;
      for (let i = 0; i < D.n; i++) vmax = Math.max(vmax, Math.hypot(D.vx[i] - hole.vx, D.vy[i] - hole.vy));
      fastest.push([yrs, P.bodies.length, D.n, Math.round(vmax * kms)]);
    }
    check('tidal debris keeps sensible speeds at 30 and 1,000 yr/s', fastest.every(([, n, d, v]) => n === 1 && d >= 250 && v <= 3000),
      { yrPerSecBodiesDustFastestKms: fastest });

    // 14. No tunnelling at high warp: a whole approach fits in one frame, so
    // the steps must shrink as the planet closes in on the star
    let warpHits = 0, warpTries = 0;
    for (const kmsSpeed of [450, 900]) {
      for (const f of offsets) {
        P.loadScene('empty');
        P.seed(5);
        const star = P.makeBody(0, 0, 0, 0, P.IGNITE * 1.25, 'star');
        P.addBody(star);
        const reach = star.cr + P.radiusFor(12, 'planet') * 1.4;
        P.addBody(P.makeBody(-4000, f * reach, kmsSpeed / kms, 0, 12, 'planet'));
        P.settle();
        P.setRate(P.RATE_MAX);
        P.tick(3);
        warpTries++;
        if (P.bodies.length === 1) warpHits++;
      }
    }
    check('no tunnelling at the top of the slider (450 and 900 km/s)', warpHits === warpTries,
      { hits: warpHits, tries: warpTries, simYears: +(P.simTime / P.YEAR).toFixed(1) });

    // 15. Stable at the top of the slider: Binary keeps its four planets on
    // their orbits, with bounded energy, for 300 simulated years
    P.seed(1);
    P.loadScene('binary');
    P.setRate(P.RATE_MAX);
    const hub = () => {
      let m = 0, x = 0, y = 0, vx = 0, vy = 0;
      for (const s of P.bodies) if (s.kind !== 'planet') { m += s.m; x += s.m * s.x; y += s.m * s.y; vx += s.m * s.vx; vy += s.m * s.vy; }
      return { m, x: x / m, y: y / m, vx: vx / m, vy: vy / m };
    };
    const sma = b => {
      const s = hub(), mu = s.m + b.m, rx = b.x - s.x, ry = b.y - s.y, vx = b.vx - s.vx, vy = b.vy - s.vy;
      const e = (vx * vx + vy * vy) / 2 - mu / Math.hypot(rx, ry);
      return e < 0 ? -mu / (2 * e) : Infinity;
    };
    const bin0 = P.bodies.filter(b => b.kind === 'planet').map(b => [b, sma(b)]);
    const eb0 = energy(P.bodies);
    let binFrames = 0;
    while (P.simTime < 300 * P.YEAR && binFrames++ < 600) P.tick(1);
    const binDa = Math.max(...bin0.map(([b, a]) => b.dead ? Infinity : Math.abs(sma(b) / a - 1)));
    const binDE = Math.abs(energy(P.bodies) / eb0 - 1);
    check('Binary is stable at the top of the slider', P.simTime >= 300 * P.YEAR && binDa <= 0.05 && binDE <= 1e-3 && finite(P.bodies),
      { simYears: +(P.simTime / P.YEAR).toFixed(1), frames: binFrames, maxDaOverA: +binDa.toFixed(4), dE: binDE.toExponential(2) });

    // 16. When a busy scene can't keep up with the slider, the readout shows
    // the speed it achieves, and goes back to the set speed when it can
    const label = document.getElementById('speedLabel');
    P.seed(1);
    P.loadScene('feast');
    P.setRate(P.RATE_MAX);
    P.tick(24);
    const lagging = label.textContent;
    P.setRate(P.RATE_DEFAULT);
    P.tick(24);
    const keeping = label.textContent;
    check('the speed readout shows the achieved rate when it lags', /^≈/.test(lagging) && !/^≈/.test(keeping),
      { lagging, keeping });

    // 17. A planet thrown out to a distant orbit, still on screen at the widest
    // zoom (160 AU, drifting out at ~4 km/s), isn't culled
    P.seed(1);
    P.loadScene('cradle');
    P.setRate(P.RATE_DEFAULT);
    const far = P.makeBody(160 * P.AU, 0, 1, 0, 12, 'planet');
    P.addBody(far);
    P.settle();
    P.tick(600);
    check('a planet thrown far out, within the widest view, survives', P.bodies.includes(far),
      { distAU: +(Math.hypot(far.x, far.y) / P.AU).toFixed(1), frames: 600 });

    // 18. A heavy star placed far away, flying off, never culls the original
    // system; at top speed the newcomer is the one that goes (after its grace)
    // (a lone Sun: one body each, so before the fix the heavier newcomer won)
    P.seed(1);
    P.loadScene('empty');
    const sun0 = P.makeBody(0, 0, 0, 0, P.MSUN, 'star');
    P.addBody(sun0);
    P.settle();
    P.tick(30);   // the Sun is the main group
    const heavyStar = P.makeBody(200 * P.AU, 0, 4, 0, 5 * P.MSUN, 'star');
    P.addBody(heavyStar);
    P.settle();
    P.setRate(P.RATE_MAX);
    let sunLost = -1;
    for (let f = 0; f < 600 && sunLost < 0; f++) { P.tick(1); if (!P.bodies.includes(sun0)) sunLost = f; }
    const feedText = () => [...document.querySelectorAll('#feed li span')].map(s => s.textContent);
    check('a heavy star placed far away never culls the original system',
      sunLost < 0 && !P.bodies.includes(heavyStar) && feedText().some(t => /star was flung into interstellar space/.test(t)),
      { sunLostAtFrame: sunLost, newcomerKept: P.bodies.includes(heavyStar), feed: feedText() });

    // 19. Losses are counted in one notice, not dropped: three small placed
    // planets dropped on the Sun, then three rogue planets flung away
    P.seed(1);
    P.loadScene('cradle');
    document.getElementById('feed').textContent = '';
    const sun1 = P.bodies.find(b => b.kind === 'star');
    for (let k = 0; k < 3; k++) {
      const b = P.makeBody(sun1.x + 2 * k, sun1.y + 3, sun1.vx, sun1.vy, 1, 'planet');
      b.placed = true;
      P.addBody(b);
    }
    P.settle();
    P.setRate(P.RATE_DEFAULT);
    P.tick(1);
    const fell = feedText().filter(t => /^3 planets fell into stars$/.test(t)).length;
    for (let k = 0; k < 3; k++) P.addBody(P.makeBody((500 + k * 20) * P.AU, 0, 30, 0, 1, 'planet'));
    P.settle();
    P.tick(240);
    const flung = feedText().filter(t => /^3 planets were flung into interstellar space$/.test(t)).length;
    check('merges and losses are counted in one notice each', fell === 1 && flung === 1, { feed: feedText() });

    // 20. A new dust cloud always appears, even with the dust pool full: the
    // oldest grains make way, deterministically
    const fullPool = () => {
      P.seed(4);
      P.loadScene('galaxies');
      const R = P.seededRand(9);
      while (P.dust < P.MAX_T) P.addTracer((R() - 0.5) * 4000, (R() - 0.5) * 4000, 0, 0, 1);
      for (let i = 0; i < 3000; i++) P.addTracer(5000 + (R() - 0.5) * 100, (R() - 0.5) * 100, 0, 0, 2);
      const D = P.dustState;
      let inCloud = 0;
      for (let i = 0; i < D.n; i++) if (Math.abs(D.x[i] - 5000) <= 50 && Math.abs(D.y[i]) <= 50) inCloud++;
      const n = D.n;
      P.tick(40);
      return { n, inCloud, hash: stateHash(P) };
    };
    const d1 = fullPool(), d2 = fullPool();
    check('a new dust cloud appears in full even when the dust pool is full',
      d1.inCloud === 3000 && d1.n === P.MAX_T && d1.hash === d2.hash,
      { cap: P.MAX_T, dust: d1.n, cloudGrains: d1.inCloud, deterministic: d1.hash === d2.hash });

    return checks;
  };
})();
