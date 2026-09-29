// Pocket Universe: collisions
// Copyright (c) 2026 Luke Bennie <lukebennie@gmail.com>. All rights reserved.
//
// What happens when bodies meet: merges (resolveMerges, merge), tidal
// shredding near black holes (tidal, shred) and supernovae.
//
// One of the src/*.js files that tools/build.py joins, in order, into a single
// shared scope inside index.html; names defined in the other files are in
// scope here. See docs/ARCHITECTURE.md for the layout.

function resolveMerges() {
  for (let k = 0; k < pairs.length; k += 2) {
    let a = pairs[k], b = pairs[k + 1];
    if (a.dead || b.dead) continue;
    if (b.m > a.m) { const t = a; a = b; b = t; }
    merge(a, b);
  }
  bodies = bodies.filter(b => !b.dead);
}

function lifeNoun(b) { return b.life >= 2 ? 'A civilization' : 'A living world'; }
function lifeLost(b, how) {
  if (!b.life) return;
  pushEvent(`${lifeNoun(b)} was ${how}`, 'lost');
  b.life = 0;
  b.hz = 0;
}

function merge(a, b) {
  // a black hole never swallows a star whole: it shreds it and keeps 30%
  if (a.kind === 'bh' && b.kind === 'star') { shred(b, a); return; }
  if (b.kind === 'bh' && a.kind === 'star') { shred(a, b); return; }
  const m = a.m + b.m;
  const aHigher = RANK[a.kind] >= RANK[b.kind];
  const bigKind = aHigher ? a.kind : b.kind;
  const smallKind = aHigher ? b.kind : a.kind;
  const smallM = aHigher ? b.m : a.m;
  const bigM = aHigher ? a.m : b.m;
  const fxRgb = b.rgb;
  const bIcy = b.icy, aIcy = a.icy;

  // life on the body that disappears
  if (b.life) {
    lifeLost(b, bigKind === 'star' ? 'swallowed by a star' : bigKind === 'bh' ? 'swallowed by a black hole' : 'destroyed in a planetary collision');
  }

  a.x = (a.x * a.m + b.x * b.m) / m;
  a.y = (a.y * a.m + b.y * b.m) / m;
  a.vx = (a.vx * a.m + b.vx * b.m) / m;
  a.vy = (a.vy * a.m + b.vy * b.m) / m;
  a.ax = (a.ax * a.m + b.ax * b.m) / m;
  a.ay = (a.ay * a.m + b.ay * b.m) / m;
  a.m = m;
  if (b.kind === 'bh' && a.kind !== 'bh') a.disk = b.disk;
  a.kind = bigKind;
  a.icy = aIcy && bIcy;
  a.feed += 30;
  b.dead = true;
  b.into = a;
  if (selected === b) selected = a;

  const size = Math.max(a.r, b.r);
  addFx(a.x, a.y, Math.max(size, 2), fxRgb, 'ring', 45);
  if (smallKind !== 'planet' || smallM > 30 || b.placed) addFx(a.x, a.y, size * 1.4, fxRgb, 'flash', 30);

  // life on the survivor
  if (a.life && bigKind === 'planet') {
    if (bIcy) {
      a.hz += YEAR;
    } else if (b.m > 0.08 * (m - b.m)) {
      lifeLost(a, 'wiped out by a giant impact');
    }
  } else if (!a.life && bigKind === 'planet' && bIcy && !aIcy && a.m >= LIFE_MIN) {
    a.hz += 2 * YEAR;
    pushEvent('A comet delivered water and organics to a planet', 'life', 'pansp', 4000);
  }

  if (bigKind === 'planet' && m >= IGNITE) {
    lifeLost(a, 'consumed when its planet ignited into a star');
    a.kind = 'star';
    a.rgb = null;
    refresh(a);
    addFx(a.x, a.y, a.r * 3, a.rgb, 'flash', 80);
    addFx(a.x, a.y, a.r * 2, a.rgb, 'ring', 90);
    pushEvent(`A new star ignited at ${massLabel(m, 'star')}`, 'star');
    return;
  }
  if (a.kind !== 'planet') lifeLost(a, 'swallowed');
  // repaint a planet whose look no longer fits: it grew into a brown dwarf,
  // or a comet lost its ice to a rocky partner
  else if ((a.m > DWARF) !== (a.style === 'dwarf') || (aIcy && !a.icy)) a.rgb = null;
  refresh(a);

  // small scene bodies merge quietly, but anything the player placed is reported
  const placed = a.placed || b.placed, told = smallM >= 6 || placed;
  if (bigKind === 'planet') {
    if (bIcy && !aIcy) {
      if (smallM >= 0.2 || placed) tally('cp', 'planet', 'A comet struck a planet', '# comets struck planets');
    } else if (told) tally('pp', 'planet', 'Two planets collided and merged', '# planet collisions');
  } else if (bigKind === 'star' && smallKind === 'planet') {
    if (bIcy) tally('sc', 'star', 'A sungrazing comet plunged into a star', '# comets plunged into stars');
    else if (told) tally('sp', 'star', 'A planet fell into a star', '# planets fell into stars');
  } else if (bigKind === 'star') {
    pushEvent(`Two stars merged into one ${massLabel(m, 'star')} star`, 'star');
  } else if (smallKind === 'planet') {
    if (told && !bIcy) tally('bp', 'bh', 'A planet fell into a black hole', '# planets fell into black holes');
  } else {
    pushEvent(`Two black holes merged. Gravitational waves are rippling out.`, 'wave');
    addFx(a.x, a.y, a.r * 6, [180, 210, 255], 'ring', 140);
    addFx(a.x, a.y, a.r * 4, [180, 210, 255], 'flash', 60);
    addWave(a.x, a.y, 20, 200);
    a.feed += 300;
    if (!reduceMotion) shake = Math.max(shake, 6);
  }

  // Star mergers past 20 M☉ collapse. A giant that swallows a planet only
  // collapses if the meal tips it over the limit.
  if (a.kind === 'star' && m >= COLLAPSE && (smallKind === 'star' || bigM < COLLAPSE)) supernova(a);
}

// Stars and planets that stray inside a black hole's tidal radius get torn
// into a stream of debris before they can fall in.
function tidal(dry) {
  let any = false;
  for (const h of bodies) {
    if (h.kind !== 'bh' || h.dead) continue;
    for (const b of bodies) {
      if (b === h || b.dead || b.kind === 'bh' || (b.m > h.m && b.kind !== 'star')) continue;
      const dx = b.x - h.x, dy = b.y - h.y;
      const rt = 2.2 * b.r * Math.cbrt(h.m / b.m);
      if (dx * dx + dy * dy < rt * rt) { if (dry) return true; shred(b, h); any = true; }
    }
  }
  if (any) bodies = bodies.filter(b => !b.dead);
}

function shred(b, h) {
  b.dead = true;
  b.into = h;
  const isStar = b.kind === 'star';
  const n = isStar ? Math.round(clamp(280 * Math.cbrt(b.m / MSUN), 150, 520)) : b.icy ? 30 : 80;
  const dx = b.x - h.x, dy = b.y - h.y, d = Math.hypot(dx, dy) || 1;
  const ux = dx / d, uy = dy / d;
  const rv = Math.hypot(b.vx - h.vx, b.vy - h.vy);
  for (let i = 0; i < n; i++) {
    const u = (rand() * 2 - 1) * b.r * 1.3;
    const w = gauss() * b.r * 0.35;
    addTracer(b.x + ux * u - uy * w, b.y + uy * u + ux * w,
      b.vx + gauss() * rv * 0.03, b.vy + gauss() * rv * 0.03,
      pick(isStar ? [3, 3, 0, 12, 11] : b.icy ? [4, 8] : [2, 9, 12]));
  }
  // The hole carries on at the pair's centre-of-mass velocity: the close-pass
  // swing is undone (so it doesn't drift off), and the 70% that becomes debris
  // takes its share of the momentum with it. Acceleration likewise keeps only
  // outside forces, since the star's pull on the hole is gone.
  const pm = h.m + b.m;
  h.vx = (h.m * h.vx + b.m * b.vx) / pm;
  h.vy = (h.m * h.vy + b.m * b.vy) / pm;
  h.ax = (h.m * h.ax + b.m * b.ax) / pm;
  h.ay = (h.m * h.ay + b.m * b.ay) / pm;
  lostX += 0.7 * b.m * h.vx; lostY += 0.7 * b.m * h.vy;
  h.m += b.m * 0.3;
  h.feed += isStar ? 260 : 60;
  refresh(h);
  addFx(b.x, b.y, b.r * 1.5, b.rgb, 'flash', 50);
  addFx(b.x, b.y, b.r, b.rgb, 'ring', 60);
  if (b.life) lifeLost(b, 'torn apart by a black hole');
  if (isStar) {
    pushEvent(`Tidal disruption: a black hole tore a ${massLabel(b.m, 'star')} star into a stream`, 'bh');
  } else if (!b.icy && (b.m >= 6 || b.placed)) {
    tally('tp', 'bh', 'A black hole tore a planet apart', 'Black holes tore # planets apart');
  }
  if (selected === b) selected = h;
}

function supernova(a) {
  const M = a.m;
  lostX += 0.45 * M * a.vx; lostY += 0.45 * M * a.vy;
  anyBH = true;
  a.m = M * 0.55;
  a.kind = 'bh';
  refresh(a);
  a.feed = 400;
  const r0 = a.r * 3;
  // escape speed at r0 grows as M^¼ (r0 grows as √M), so ejecta speeds scale
  // with it: a heavy remnant still leaves a nebula instead of eating it all
  const k = Math.pow(M / COLLAPSE, 0.25);
  for (let i = 0; i < 520; i++) {
    const ang = rand() * Math.PI * 2;
    const fast = rand() < 0.7;
    const sp = k * (fast ? 70 + rand() * 70 : 12 + rand() * 30);
    addTracer(a.x + Math.cos(ang) * r0, a.y + Math.sin(ang) * r0,
      a.vx + Math.cos(ang) * sp, a.vy + Math.sin(ang) * sp,
      // a remnant glows in hydrogen red, oxygen teal and hot white, like the Crab Nebula
      pick(fast ? [3, 8, 6, 11] : [12, 11, 7]));
  }
  // shock wave pushes nearby dust outward
  const RS = 900;
  for (let i = 0; i < T.n; i++) {
    const dx = T.x[i] - a.x, dy = T.y[i] - a.y, d = Math.hypot(dx, dy);
    if (d > 1 && d < RS) {
      const k = 45 * (1 - d / RS) / d;
      T.vx[i] += dx * k; T.vy[i] += dy * k;
    }
  }
  // radiation sterilizes living worlds within 8 AU
  let dead = 0;
  for (const b of bodies) {
    if (!b.life) continue;
    if (Math.hypot(b.x - a.x, b.y - a.y) < 8 * AU) { b.life = 0; b.hz = 0; dead++; }
  }
  addFx(a.x, a.y, 60, [255, 240, 220], 'flash', 100);
  addFx(a.x, a.y, 40, [255, 200, 140], 'ring', 140);
  addWave(a.x, a.y, 10, 150);
  if (!reduceMotion) { flash = 0.5; shake = 14; }
  pushEvent(`Supernova: a ${massLabel(M, 'star')} star collapsed into a black hole`, 'nova');
  if (dead) pushEvent(`The supernova sterilized ${dead === 1 ? 'a living world' : dead + ' living worlds'}`, 'lost');
}
