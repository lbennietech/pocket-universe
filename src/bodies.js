// Pocket Universe: bodies
// Copyright (c) 2026 Luke Bennie <lukebennie@gmail.com>. All rights reserved.
//
// Making bodies, comets and dust clouds: radius from mass, colours,
// kinds and names, and adding dust tracers.
//
// One of the src/*.js files that tools/build.py joins, in order, into a single
// shared scope inside index.html; names defined in the other files are in
// scope here. See docs/ARCHITECTURE.md for the layout.

// ---------------------------------------------------------------------------
// Bodies
// ---------------------------------------------------------------------------
// Sizes are exaggerated so a glance tells light from heavy: planets grow with
// the cube root of mass, stars and black holes with the square root. Like real
// brown dwarfs, planets barely grow past 13 M♃, and red dwarfs shrink slowly
// below 0.5 M☉, so the smallest star is still bigger than the biggest planet.
function radiusFor(m, kind) {
  if (kind === 'bh') return 2.7 * Math.sqrt(m / MSUN);
  if (kind === 'star') {
    const s = m / MSUN;
    return s >= 0.5 ? 14 * Math.sqrt(s) : 14 * Math.SQRT1_2 * Math.pow(s / 0.5, 0.25);
  }
  return m <= 150 ? 0.9 * Math.cbrt(m) : 0.9 * Math.cbrt(150) * Math.pow(m / 150, 0.1);
}
// On-screen glow diameter for a body drawn with radius R px. Big bodies get
// proportionally less halo so giants don't wash out the screen.
function glowSize(R, kind) {
  return kind === 'bh' ? Math.max(30, R * (4 + 70 / (R + 6))) : Math.max(18, R * (3 + 96 / (R + 10)));
}
function styleFor(m, pref) {
  if (m > DWARF) return 'dwarf';
  if (m < 2 && !ROCKY.includes(pref)) return pick(ROCKY);
  return pref || pick(PLANET_KEYS);
}
function paintPlanet(b) {
  b.style = styleFor(b.m, b.style);
  const s = PLANET_STYLES[b.style];
  b.rgb = s.rgb.slice();
  b.alt = s.alt;
  b.bands = !!s.bands;
  b.tilt = (rand() - 0.5) * 0.7;
}
// Bodies massive enough to pull on dust the way a star or black hole does:
// any non-planet, or a planet-mass body at or above HEAVY_TRACER_M.
function isHeavy(b) { return b.kind !== 'planet' || b.m >= HEAVY_TRACER_M; }
// Luminosity (L☉) and surface temperature (K) for a star of s solar masses.
// L ∝ M^3.5 fits the upper main sequence; like their radii, red dwarfs below
// 0.5 M☉ dim and cool more gently, which keeps even the smallest star's
// habitable zone outside the star itself.
const lumFor = s => s >= 0.5 ? Math.pow(s, 3.5) : 0.5 ** 3.5 * Math.pow(s / 0.5, 1.8);
const tempFor = s => 5778 * (s >= 0.5 ? Math.pow(s, 0.54) : 0.5 ** 0.54 * Math.pow(s / 0.5, 0.23));
function refresh(b) {
  fresh = false;
  b.r = radiusFor(b.m, b.kind);
  if (b.kind === 'star') b.rgb = starRGB(b.m);
  else if (b.kind === 'bh') b.rgb = b.disk || (b.disk = pick(BH_DISK).slice());
  else if (!b.rgb) paintPlanet(b);
  b.rgbStr = b.rgb.join(',');
  b.altStr = (b.alt || b.rgb).join(',');
  b.core = `rgb(${lighten(b.rgb, 0.62)})`;
  b.hot = `rgb(${lighten(b.rgb, 0.9)})`;
  b.limb = `rgb(${lighten(b.rgb, 0.12)})`;
  b.ringStr = lighten(b.rgb, 0.6);
  b.sprite = glowSprite(b.rgb);
  b.cr = b.r * (b.kind === 'planet' ? 1.4 : b.kind === 'bh' ? 1.6 : 1);
  b.lum = b.kind === 'star' ? lumFor(b.m / MSUN) : 0;
  if (b.kind !== 'planet') b.icy = false;
}
// `look` is an RGB array (a fixed color, or a black hole's disk color) or
// the name of a planet style.
function makeBody(x, y, vx, vy, m, kind, look) {
  const color = Array.isArray(look) ? look : null;
  const b = {
    id: nextId++, x, y, vx, vy, ax: 0, ay: 0, m, kind,
    rgb: kind === 'planet' ? color : null, disk: kind === 'bh' ? color : null,
    style: typeof look === 'string' ? look : null,
    trail: new Float32Array(TRAIL * 2), th: 0, tl: 0, tc: -1e9, t0: 0, tn: 0, q: 0, act: 0,
    dead: false, into: null, placed: false, born: frameN, pr: null, pp: 0, pd: 0, spin: rand() * 6.283, feed: 0,
    icy: false, hz: 0, life: 0, flux: 0
  };
  refresh(b);
  return b;
}
function makeComet(x, y, vx, vy, m) {
  const b = makeBody(x, y, vx, vy, m, 'planet', ICE_RGB.slice());
  b.icy = true;
  b.ice = COMET_ICE;
  return b;
}
// When the pool is full, new grains reuse its slots round-robin, so a new
// cloud, ejecta or debris always appears (at the cost of whatever grains
// held those slots, not necessarily the oldest).
let recyc = 0;
function addTracer(x, y, vx, vy, c) {
  let i = T.n;
  if (i < MAX_T) T.n++;
  else { i = recyc; recyc = (recyc + 1) % MAX_T; }
  T.x[i] = T.px[i] = x; T.y[i] = T.py[i] = y;
  T.vx[i] = vx; T.vy[i] = vy; T.c[i] = c; T.q[i] = -1; T.b[i] = gNow;
}
function removeTracer(i) {
  const j = --T.n;
  if (i === j) return;
  T.x[i] = T.x[j]; T.y[i] = T.y[j]; T.vx[i] = T.vx[j]; T.vy[i] = T.vy[j];
  T.px[i] = T.px[j]; T.py[i] = T.py[j]; T.c[i] = T.c[j]; T.q[i] = T.q[j]; T.b[i] = T.b[j];
}
function addFx(x, y, size, rgb, kind, life) {
  effects.push({ x, y, size, rgb: Array.isArray(rgb) ? rgb.join(',') : rgb, kind, life, max: life, rad: 0 });
}
function addWave(x, y, strength, life) {
  effects.push({ x, y, size: strength, rgb: '150,190,255', kind: 'wave', life, max: life, rad: 0 });
}

function fluxAt(x, y) {
  let F = 0, best = null, bw = 0;
  for (const s of lights) {
    const dx = s.x - x, dy = s.y - y;
    const d2 = (dx * dx + dy * dy) / (AU * AU) + 1e-4;
    const f = s.lum / d2;
    F += f;
    if (f > bw) { bw = f; best = s; }
  }
  return { F, best };
}
function primaryOf(b) {
  let best = null, bw = 0;
  for (const o of bodies) {
    if (o === b || o.dead || o.m <= b.m) continue;
    const dx = o.x - b.x, dy = o.y - b.y;
    const w = o.m / (dx * dx + dy * dy + 1);
    if (w > bw) { bw = w; best = o; }
  }
  return best;
}
function orbitOf(b, p) {
  const mu = p.m + b.m;
  const rx = b.x - p.x, ry = b.y - p.y, vx = b.vx - p.vx, vy = b.vy - p.vy;
  const r = Math.hypot(rx, ry) || 1e-6, v2 = vx * vx + vy * vy;
  const E = v2 / 2 - mu / r;
  const o = { r, v: Math.sqrt(v2), bound: E < 0 };
  if (!o.bound) return o;
  const rv = rx * vx + ry * vy;
  o.ex = ((v2 - mu / r) * rx - rv * vx) / mu;
  o.ey = ((v2 - mu / r) * ry - rv * vy) / mu;
  o.e = Math.hypot(o.ex, o.ey);
  o.a = -mu / (2 * E);
  o.P = 2 * Math.PI * Math.sqrt(o.a ** 3 / mu);
  return o;
}
