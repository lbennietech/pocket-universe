// Pocket Universe: life
// Copyright (c) 2026 Luke Bennie <lukebennie@gmail.com>. All rights reserved.
//
// Worlds that stay in a habitable zone grow life, then a civilization,
// then launch probes.
//
// One of the src/*.js files that tools/build.py joins, in order, into a single
// shared scope inside index.html; names defined in the other files are in
// scope here. See docs/ARCHITECTURE.md for the layout.

// ---------------------------------------------------------------------------
// Life: worlds that stay in the habitable zone long enough grow life, then a
// civilization, then start launching probes.
// ---------------------------------------------------------------------------
function updateLife(dt, maxProbes = 8) {
  for (const b of bodies) {
    if (b.kind !== 'planet') continue;
    const F = fluxAt(b.x, b.y).F;
    b.flux = F;
    if (b.icy) continue;
    if (b.m < LIFE_MIN || b.m > DWARF) {
      if (b.life) lifeLost(b, b.m > DWARF ? 'crushed as its world grew into a brown dwarf' : 'lost');
      continue;
    }
    if (F >= HZ_LO && F <= HZ_HI) {
      b.hz += dt;
      const stageNow = b.hz >= LIFE_T[2] ? 3 : b.hz >= LIFE_T[1] ? 2 : b.hz >= LIFE_T[0] ? 1 : 0;
      if (stageNow > b.life) {
        b.life = stageNow;
        if (stageNow === 1) { pushEvent('Life appeared on a planet in the habitable zone', 'life'); }
        else if (stageNow === 2) { pushEvent('A civilization arose. Its cities light the night side.', 'life'); }
        else { pushEvent('A civilization went spacefaring and is launching probes', 'life'); }
      }
    } else {
      const harsh = F < 0.12 || F > 3.5;
      b.hz = harsh ? 0 : b.hz - dt * 6;
      if (b.hz <= 0) {
        b.hz = 0;
        if (b.life) {
          const noun = b.life >= 2 ? 'A civilization' : 'Life on a planet';
          pushEvent(F < HZ_LO ? `${noun} froze as its world drifted away from its star` : `${noun} boiled away as its world drifted too close to its star`, 'lost');
          b.life = 0;
        }
      }
    }
    for (let k = b.life >= 3 && T.n < MAX_T ? Math.min(maxProbes, dt / (0.25 * YEAR)) : 0; k > 0; k--) {
      if (rand() >= Math.min(1, k)) continue;
      const a = rand() * Math.PI * 2, sp = 3 + rand() * 4;
      addTracer(b.x + Math.cos(a) * b.r * 1.6, b.y + Math.sin(a) * b.r * 1.6,
        b.vx + Math.cos(a) * sp, b.vy + Math.sin(a) * sp, PROBE_COLOR);
    }
  }
}

function shedComets() {
  if (T.n > MAX_T - 800) return;
  for (const b of bodies) {
    if (!b.icy) continue;
    const { F, best } = fluxAt(b.x, b.y);
    if (!best || F < 0.4) continue;
    const dx = b.x - best.x, dy = b.y - best.y, d = Math.hypot(dx, dy) || 1;
    addTracer(b.x, b.y, b.vx + dx / d * 0.8 + gauss() * 0.3, b.vy + dy / d * 0.8 + gauss() * 0.3, rand() < 0.5 ? 4 : 8);
    // a spent comet is just a dark, barren nucleus: no more tails or dust
    if (--b.ice <= 0) { b.icy = false; b.rgb = null; b.style = 'ash'; refresh(b); }
  }
}
