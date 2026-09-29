// Pocket Universe: centre and culling
// Copyright (c) 2026 Luke Bennie <lukebennie@gmail.com>. All rights reserved.
//
// The centre of mass, the main group of bodies the view follows, and
// culling bodies that fly too far from it.
//
// One of the src/*.js files that tools/build.py joins, in order, into a single
// shared scope inside index.html; names defined in the other files are in
// scope here. See docs/ARCHITECTURE.md for the layout.

function centerOfMass() {
  let M = 0, cx = 0, cy = 0;
  for (const b of bodies) { M += b.m; cx += b.x * b.m; cy += b.y * b.m; }
  if (M > 0) return { x: cx / M, y: cy / M, m: M };
  if (T.n) {
    for (let i = 0; i < T.n; i++) { cx += T.x[i]; cy += T.y[i]; }
    return { x: cx / T.n, y: cy / T.n, m: 0 };
  }
  return { x: 0, y: 0, m: 0 };
}

// The main group is the most crowded neighbourhood of bodies, so one heavy
// runaway can't drag the reference point away from the system you're
// watching. The group around last time's centre body (or what it merged
// into) counts double, so a newcomer, however heavy, can't take over and get
// that system culled.
const NEAR = 7500;
let home = null;
function mainGroup() {
  const N2 = NEAR * NEAR;
  let h = home, best = null, bs = -1;
  while (h && h.into) h = h.into;
  for (const a of bodies) {
    let s = 0;
    for (const b of bodies) {
      const dx = b.x - a.x, dy = b.y - a.y;
      if (dx * dx + dy * dy < N2) s += 1 + b.m * 1e-9;
    }
    if (h && !h.dead && (a.x - h.x) ** 2 + (a.y - h.y) ** 2 < N2) s *= 2;
    if (s > bs) { bs = s; best = a; }
  }
  if (!best) return { ...centerOfMass(), vx: 0, vy: 0 };
  let M = 0, x = 0, y = 0, vx = 0, vy = 0;
  for (const b of bodies) {
    const dx = b.x - best.x, dy = b.y - best.y;
    if (dx * dx + dy * dy >= N2) continue;
    M += b.m; x += b.x * b.m; y += b.y * b.m; vx += b.vx * b.m; vy += b.vy * b.m;
  }
  return { x: x / M, y: y / M, vx: vx / M, vy: vy / M, m: M, best };
}

// A body is removed only when it's farther than FAR from the main group
// (and a planet or comet also from every star and black hole, so a distant
// system keeps its worlds) and moving away faster than everything's pull can
// hold. Anything past 20 FAR goes regardless. New and selected bodies are
// kept, so a throw is never lost the moment it leaves.
function cull() {
  const c = mainGroup();
  home = c.best;
  const R2 = FAR * FAR;
  // stars and holes first, so a planet whose star just went goes with it
  for (const pass of [true, false]) for (const b of bodies) {
    const dx = b.x - c.x, dy = b.y - c.y, r2 = dx * dx + dy * dy;
    const big = b.kind !== 'planet';
    if (big !== pass || r2 <= R2 || b === selected || frameN - b.born < GRACE) continue;
    if (r2 <= 400 * R2) {
      if (!big && bodies.some(s => s.kind !== 'planet' && !s.dead && (s.x - b.x) ** 2 + (s.y - b.y) ** 2 <= R2)) continue;
      const r = Math.sqrt(r2), dvx = b.vx - c.vx, dvy = b.vy - c.vy;
      let pot = b.m / r;   // its own mass counts too: two bodies pull each other back
      for (const o of bodies) if (o !== b) pot += o.m / (Math.hypot(o.x - b.x, o.y - b.y) + 1);
      if (dx * dvx + dy * dvy <= 0 || 0.5 * (dvx * dvx + dvy * dvy) <= pot) continue;
    }
    b.dead = true;
    if (b.life) lifeLost(b, 'flung into interstellar space');
    else if (b.kind === 'bh') tally('fb', 'bh', `A ${massLabel(b.m, 'bh')} black hole was flung into interstellar space`, '# black holes were flung into interstellar space');
    else if (big) tally('fs', 'star', `A ${massLabel(b.m, 'star')} star was flung into interstellar space`, '# stars were flung into interstellar space');
    else if (b.icy) tally('fc', 'planet', 'A comet was flung into interstellar space', '# comets were flung into interstellar space');
    else tally('fp', 'planet', 'A planet was flung into interstellar space', '# planets were flung into interstellar space');
  }
  if (bodies.some(b => b.dead)) { bodies = bodies.filter(b => !b.dead); fresh = false; }
  if (selected && selected.dead) deselect();
  // dust goes only when it's far from the main group and from every heavy body
  const heavy = bodies.filter(isHeavy);
  for (let i = 0; i < T.n; i++) {
    const dx = T.x[i] - c.x, dy = T.y[i] - c.y;
    if (dx * dx + dy * dy <= R2) continue;
    if (heavy.some(h => (T.x[i] - h.x) ** 2 + (T.y[i] - h.y) ** 2 <= R2)) continue;
    removeTracer(i); i--;
  }
}
