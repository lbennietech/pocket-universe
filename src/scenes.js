// Pocket Universe: scenes
// Copyright (c) 2026 Luke Bennie <lukebennie@gmail.com>. All rights reserved.
//
// The scene builders (SCENES) and loadScene.
//
// One of the src/*.js files that tools/build.py joins, in order, into a single
// shared scope inside index.html; names defined in the other files are in
// scope here. See docs/ARCHITECTURE.md for the layout.

// ---------------------------------------------------------------------------
// Scenes
// ---------------------------------------------------------------------------
// Shift every body and dust particle so the whole system's centre of mass
// is at rest. Relative motion, and so every orbit, is unchanged.
function zeroMomentum() {
  let M = 0, px = 0, py = 0;
  for (const b of bodies) { M += b.m; px += b.m * b.vx; py += b.m * b.vy; }
  if (!M) return;
  boostAll(-px / M, -py / M);
}
function boostAll(ux, uy) {
  for (const b of bodies) { b.vx += ux; b.vy += uy; }
  for (let i = 0; i < T.n; i++) { T.vx[i] += ux; T.vy[i] += uy; }
}

function circV(M, r) {
  const d2 = r * r + EPS2;
  return Math.sqrt(M * r * r / (d2 * Math.sqrt(d2)));
}
function orbitBody(M, rAU, m, look, phase) {
  const r = rAU * AU, a = phase === undefined ? rand() * Math.PI * 2 : phase, v = circV(M, r);
  return makeBody(Math.cos(a) * r, Math.sin(a) * r, -Math.sin(a) * v, Math.cos(a) * v, m, 'planet', look);
}
function ellipticAt(cx, cy, cvx, cvy, mu, a, e, ang, sense) {
  const ra = a * (1 + e), va = Math.sqrt(mu * (1 - e) / (a * (1 + e)));
  const ux = Math.cos(ang), uy = Math.sin(ang);
  return { x: cx + ux * ra, y: cy + uy * ra, vx: cvx - sense * uy * va, vy: cvy + sense * ux * va };
}

// A spiral galaxy around a central black hole. `pal` holds tracer colors:
// [bulge, arm, arm, star-forming knot].
function galaxy(cx, cy, vx, vy, M, n, rmin, rmax, sense, pal, disk) {
  bodies.push(makeBody(cx, cy, vx, vy, M, 'bh', disk));
  const arm0 = rand() * Math.PI * 2;
  const bulge = rmin + (rmax - rmin) * 0.18;
  for (let i = 0; i < n; i++) {
    const r = rmin + Math.min(rmax - rmin, -Math.log(1 - rand()) * (rmax - rmin) * 0.38);
    let a, c;
    if (rand() < 0.6) {
      const arm = (rand() < 0.5 ? 0 : Math.PI);
      a = arm0 + arm + sense * r * 0.014 + gauss() * 0.32;
      c = rand() < 0.12 ? pal[3] : pal[1 + (rand() < 0.5 ? 0 : 1)];
    } else {
      a = rand() * Math.PI * 2;
      c = pal[r < bulge ? 0 : 1 + (rand() < 0.5 ? 0 : 1)];
    }
    const dx = Math.cos(a) * r, dy = Math.sin(a) * r;
    const v = circV(M, r);
    addTracer(cx + dx, cy + dy, vx - sense * v * dy / r, vy + sense * v * dx / r, c);
  }
}

const SCENES = {
  galaxies: {
    fit: 720,
    rate: 8,   // the encounter takes ~30s to peak at RATE_DEFAULT; start faster so the tidal tails pay off sooner
    blurb: 'Two galaxies on a collision course. The gold one spins with the encounter, so it gets torn into long tidal tails.',
    build() {
      galaxy(-450, -120, 3.75, 0, 30000, 2200, 22, 310, 1, [12, 0, 3, 11], [255, 190, 110]);
      galaxy(450, 120, -3.75, 0, 30000, 1900, 22, 260, -1, [13, 1, 8, 6], [150, 170, 255]);
    }
  },
  cradle: {
    fit: 430,
    zones: true,
    rate: 60,   // life normally takes ~162s at RATE_DEFAULT; start faster so it shows up in seconds
    blurb: 'A quiet Sun with two worlds inside its habitable zone, shown in green. Already running fast: give them time and see if life takes hold. Tap a planet to watch it. Or throw something heavy through the zone and see how fast paradise cools.',
    build() {
      bodies.push(makeBody(0, 0, 0, 0, MSUN, 'star'));
      bodies.push(orbitBody(MSUN, 0.45, 5, 'lava'));
      bodies.push(orbitBody(MSUN, 0.7, 9, 'desert'));
      bodies.push(orbitBody(MSUN, 1.02, 12, 'ocean'));
      bodies.push(orbitBody(MSUN, 1.46, 11, 'jungle'));
      bodies.push(orbitBody(MSUN, 3.0, 90, 'gas'));
      bodies.push(orbitBody(MSUN, 5.2, 35, 'uranus'));
      for (let i = 0; i < 700; i++) {
        const r = AU * (1.95 + rand() * 0.45), a = rand() * Math.PI * 2;
        const v = circV(MSUN, r) * (1 + gauss() * 0.02);
        addTracer(Math.cos(a) * r, Math.sin(a) * r, -Math.sin(a) * v, Math.cos(a) * v, pick([2, 12, 9]));
      }
      const c = ellipticAt(0, 0, 0, 0, MSUN, 3.4 * AU, 0.86, rand() * Math.PI * 2, 1);
      bodies.push(makeComet(c.x, c.y, c.vx, c.vy, 0.5));
      zeroMomentum();
    }
  },
  feast: {
    fit: 1000,
    blurb: 'A 10 M☉ black hole with stars on plunging orbits. Stars that pass too close get torn into streams before they fall in. Turn on Warp to see the well.',
    build() {
      const M = 10 * MSUN;
      bodies.push(makeBody(0, 0, 0, 0, M, 'bh'));
      const orbits = [[300, 0.9, 1], [420, 0.93, 0.6], [520, 0.8, 1.6], [640, 0.95, 0.9], [760, 0.88, 2.2], [380, 0.7, 0.5], [880, 0.96, 1.2], [560, 0.92, 0.4]];
      for (const [a, e, s] of orbits) {
        const o = ellipticAt(0, 0, 0, 0, M, a, e, rand() * Math.PI * 2, rand() < 0.7 ? 1 : -1);
        bodies.push(makeBody(o.x, o.y, o.vx, o.vy, s * MSUN, 'star'));
      }
      for (let i = 0; i < 900; i++) {
        const r = 40 + rand() * 220, a = rand() * Math.PI * 2, v = circV(M, r);
        addTracer(Math.cos(a) * r, Math.sin(a) * r, -Math.sin(a) * v, Math.cos(a) * v, pick([0, 0, 12, 3, 9, 6]));
      }
      zeroMomentum();   // otherwise the stars' net momentum walks the hole off-screen
    }
  },
  eight: {
    fit: 380,
    blurb: 'Three equal stars chasing each other around a figure eight. Cris Moore found this orbit in 1993; Chenciner and Montgomery proved it exists in 2000. Nudge just one of them and watch the whole braid unravel.',
    build() {
      const L = 260, m = MSUN, V = Math.sqrt(m / L);
      const p = [0.97000436, -0.24308753], v3 = [-0.93240737, -0.86473146];
      bodies.push(makeBody(p[0] * L, p[1] * L, -v3[0] / 2 * V, -v3[1] / 2 * V, m, 'star'));
      bodies.push(makeBody(-p[0] * L, -p[1] * L, -v3[0] / 2 * V, -v3[1] / 2 * V, m, 'star'));
      bodies.push(makeBody(0, 0, v3[0] * V, v3[1] * V, m, 'star'));
      for (let i = 0; i < 500; i++) {
        const r = AU * (1.9 + rand() * 0.8), a = rand() * Math.PI * 2, v = circV(3 * m, r);
        addTracer(Math.cos(a) * r, Math.sin(a) * r, -Math.sin(a) * v, Math.cos(a) * v, pick([4, 1, 7, 8]));
      }
    }
  },
  formation: {
    fit: 1000,
    rate: 60,   // planetesimal collisions and life are slow at RATE_DEFAULT; start faster to pay off sooner
    blurb: 'A young Sun inside a disk of rocky planetesimals. Already running fast: collisions slowly build planets, and the ones that land in the habitable zone might grow life. Watch it happen.',
    build() {
      const sun = makeBody(0, 0, 0, 0, MSUN, 'star');
      bodies.push(sun);
      // a light disk (about 25 M♃ in all), so mergers build planets that stay
      // under 13 M♃ instead of snowballing into brown dwarfs
      for (let i = 0; i < 200; i++) {
        const r = AU * (0.6 + rand() * 4.2);
        const a = rand() * Math.PI * 2;
        const m = 0.6 + rand() * 1.6;
        const v = circV(MSUN, r) * (1 + gauss() * 0.05);
        const vr = gauss() * 0.05 * v;
        const ux = Math.cos(a), uy = Math.sin(a);
        const b = makeBody(ux * r, uy * r, -uy * v + ux * vr, ux * v + uy * vr, m, 'planet');
        bodies.push(b);
      }
      for (let i = 0; i < 900; i++) {
        const r = AU * (0.4 + rand() * 5.2);
        const a = rand() * Math.PI * 2;
        const v = circV(MSUN, r) * (1 + gauss() * 0.03);
        addTracer(Math.cos(a) * r, Math.sin(a) * r, -Math.sin(a) * v, Math.cos(a) * v, pick([2, 4, 12, 9, 10]));
      }
      zeroMomentum();
    }
  },
  binary: {
    fit: 1700,
    blurb: 'Two stars orbit each other with four planets circling both, like Tatooine. Throw a third star in and see which pair survives.',
    build() {
      const m1 = 1.2 * MSUN, m2 = 0.8 * MSUN, Mt = m1 + m2, sep = 0.6 * AU;
      const vrel = Math.sqrt(Mt / sep);
      bodies.push(makeBody(-sep * m2 / Mt, 0, 0, -vrel * m2 / Mt, m1, 'star'));
      bodies.push(makeBody(sep * m1 / Mt, 0, 0, vrel * m1 / Mt, m2, 'star'));
      const planets = [[2.2, 4, 'rust'], [3.3, 12, 'teal'], [4.6, 30, 'amber'], [6.2, 8, 'neptune']];
      for (const [rAU, m, look] of planets) {
        const r = rAU * AU, a = rand() * Math.PI * 2, v = Math.sqrt(Mt / r);
        bodies.push(makeBody(Math.cos(a) * r, Math.sin(a) * r, -Math.sin(a) * v, Math.cos(a) * v, m, 'planet', look));
      }
      for (let i = 0; i < 800; i++) {
        const r = AU * (7.6 + gauss() * 0.35);
        const a = rand() * Math.PI * 2;
        const v = Math.sqrt(Mt / r) * (1 + gauss() * 0.01);
        addTracer(Math.cos(a) * r, Math.sin(a) * r, -Math.sin(a) * v, Math.cos(a) * v, pick([2, 3, 13, 7]));
      }
      zeroMomentum();   // the four planets' unbalanced momentum otherwise walks the pair off-screen
    }
  },
  mayhem: {
    fit: 900,
    blurb: 'Twelve heavy stars in a tight cluster. A star that grows past 20 M☉ collapses into a black hole.',
    build() {
      const placed = [];
      let tries = 0;
      while (placed.length < 12 && tries++ < 500) {
        const r = 700 * Math.sqrt(rand()), a = rand() * Math.PI * 2;
        const x = Math.cos(a) * r, y = Math.sin(a) * r;
        if (placed.some(p => Math.hypot(p.x - x, p.y - y) < 110)) continue;
        const m = MSUN * Math.exp(Math.log(1.5) + rand() * Math.log(9 / 1.5));
        placed.push({ x, y, m });
      }
      let M = 0;
      for (const p of placed) M += p.m;
      const vs = Math.sqrt(M / 700) * 0.45;
      for (const p of placed) {
        bodies.push(makeBody(p.x, p.y, gauss() * vs, gauss() * vs, p.m, 'star'));
      }
      for (let i = 0; i < 30; i++) {
        const r = 850 * Math.sqrt(rand()), a = rand() * Math.PI * 2;
        bodies.push(makeBody(Math.cos(a) * r, Math.sin(a) * r, gauss() * vs, gauss() * vs, 4 + rand() * 30, 'planet'));
      }
      zeroMomentum();
      for (let i = 0; i < 900; i++) {
        const r = 900 * Math.sqrt(rand()), a = rand() * Math.PI * 2;
        addTracer(Math.cos(a) * r, Math.sin(a) * r, gauss() * vs * 0.8, gauss() * vs * 0.8, pick(NONPROBE));
      }
    }
  },
  empty: {
    fit: 700,
    blurb: coarse ? 'Nothing here yet. Touch and hold anywhere to start a universe.' : `Nothing here yet. Hold ${MOD} and drag anywhere to start a universe.`,
    build() {}
  }
};

function loadScene(key, isRestart = false) {
  sceneKey = key;
  bodies = [];
  effects = [];
  T.n = recyc = 0;
  home = null;
  simTime = 0;
  frameN = 0;   // life and cull run on frame multiples; reset so seeded runs repeat exactly
  lifeClock = 0;
  shedClock = 0;
  flash = 0;
  shake = 0;
  aim = null;
  spawned = false;
  deselect();
  SCENES[key].build();
  accel();
  pairs.length = 0;
  lights = bodies.filter(b => b.kind === 'star');
  cam.x = 0; cam.y = 0; cam.target = null;
  // a hidden or collapsed page has no size yet; fall back to a sane zoom
  cam.z = VW && VH ? clampZoom(Math.min(VW, VH) * 0.46 / SCENES[key].fit) : 0.5;
  if (SCENES[key].zones && !showZones) toggleZones();
  if (!isRestart) setRate(SCENES[key].rate || RATE_DEFAULT);
  feed.textContent = '';
  for (const k in lastEv) delete lastEv[k];
  for (const k in tallies) delete tallies[k];
  pushEvent(SCENES[key].blurb, 'info', 'blurb', 1500);
  updateHud();
}
