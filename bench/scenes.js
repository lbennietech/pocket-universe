/*
 * Pocket Universe: benchmark scenes
 * Copyright (c) 2026 Luke Bennie <lukebennie@gmail.com>. All rights reserved.
 *
 * Injected into the page by run_bench.py and tests/run_tests.py. Scenes are
 * data (a spec per name) built from a seed, so every run starts identical.
 * window.__puBuild(name, seed) empties the universe, seeds the game's rand()
 * and builds the scene through the test hook.
 */
(() => {
  const SPECS = {
    // name: star mass (M☉), planets, dust, disk radius range (AU), extra options
    small: { star: 1, planets: 100, dust: 2000, r0: 0.6, r1: 5 },
    medium: { star: 1, planets: 300, dust: 8000, r0: 0.6, r1: 6 },
    large: { star: 1, planets: 1000, dust: 4000, r0: 0.6, r1: 8 },
    // a dense, slow swarm of stars and planets: constant merging
    'collision-pileup': { pileup: true, stars: 40, planets: 260, dust: 3000, radius: 4 },
    // a quieter system run for thousands of steps to watch memory
    'long-run': { star: 1, planets: 300, dust: 6000, r0: 0.8, r1: 6 }
  };

  window.__puBenchSpecs = SPECS;
  window.__puBuild = function (name, seed = 1) {
    const P = window.__pu, spec = SPECS[name];
    if (!spec) throw new Error('unknown bench scene ' + name);
    P.stopLoop();
    P.loadScene('empty');
    P.seed(seed);
    // the layout has its own stream (the game's generator, seeded differently),
    // and the units and circular speed come from the game, never a local copy
    const R = P.seededRand(seed * 7919 + 17);
    const AU = P.AU, MSUN = P.MSUN, circV = P.circV;

    if (spec.pileup) {
      const Rw = spec.radius * AU;
      const place = (m, kind) => {
        const r = Rw * Math.sqrt(R()), a = R() * Math.PI * 2;
        P.addBody(P.makeBody(Math.cos(a) * r, Math.sin(a) * r, 16 * (R() - 0.5), 16 * (R() - 0.5), m, kind));
      };
      for (let i = 0; i < spec.stars; i++) place(MSUN * (0.3 + R() * 2), 'star');
      for (let i = 0; i < spec.planets; i++) place(3 + R() * 40, 'planet');
      for (let i = 0; i < spec.dust; i++) {
        const r = Rw * 1.3 * Math.sqrt(R()), a = R() * Math.PI * 2;
        P.addTracer(Math.cos(a) * r, Math.sin(a) * r, 4 * (R() - 0.5), 4 * (R() - 0.5), (R() * 5) | 0);
      }
      P.settle();
      return;
    }

    const M = spec.star * MSUN;
    P.addBody(P.makeBody(0, 0, 0, 0, M, 'star'));
    for (let i = 0; i < spec.planets; i++) {
      const r = AU * (spec.r0 + R() * (spec.r1 - spec.r0)), a = R() * Math.PI * 2, v = circV(M, r);
      P.addBody(P.makeBody(Math.cos(a) * r, Math.sin(a) * r, -Math.sin(a) * v, Math.cos(a) * v, 2 + R() * 10, 'planet'));
    }
    for (let i = 0; i < spec.dust; i++) {
      const r = AU * (spec.r0 * 0.8 + R() * (spec.r1 * 1.1 - spec.r0 * 0.8)), a = R() * Math.PI * 2, v = circV(M, r);
      P.addTracer(Math.cos(a) * r, Math.sin(a) * r, -Math.sin(a) * v, Math.cos(a) * v, (R() * 5) | 0);
    }
    P.settle();
  };
})();
