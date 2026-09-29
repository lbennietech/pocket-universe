// Pocket Universe: helpers
// Copyright (c) 2026 Luke Bennie <lukebennie@gmail.com>. All rights reserved.
//
// Seeded random numbers (rand), maths, mass and time labels, formatting
// and the event feed (pushEvent).
//
// One of the src/*.js files that tools/build.py joins, in order, into a single
// shared scope inside index.html; names defined in the other files are in
// scope here. See docs/ARCHITECTURE.md for the layout.

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
// All randomness that shapes the simulation goes through rand(). Normally it
// is Math.random; tests and benchmarks swap in a seeded generator so the
// same seed always builds and runs the same universe. Purely visual noise
// (screen shake, background stars) keeps using Math.random.
let rand = Math.random;
function seededRand(seed) {
  let t = seed >>> 0;
  return () => {   // mulberry32
    t = (t + 0x6D2B79F5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = arr => arr[(rand() * arr.length) | 0];
const hash =(a, b) => { const s = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453; return s - Math.floor(s); };
function gauss() {
  let u = 0, v = 0;
  while (!u) u = rand();
  while (!v) v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
function starRGB(m) {
  const s = Math.max(0.05, m / MSUN), L = Math.log(s), st = STAR_STOPS;
  if (s <= st[0][0]) return st[0][1].slice();
  for (let i = 1; i < st.length; i++) {
    if (s <= st[i][0]) {
      const a = Math.log(st[i - 1][0]), b = Math.log(st[i][0]);
      const t = (L - a) / (b - a);
      return st[i - 1][1].map((c, k) => Math.round(c + (st[i][1][k] - c) * t));
    }
  }
  return st[st.length - 1][1].slice();
}
const lighten = (rgb, t) => rgb.map(c => Math.round(c + (255 - c) * t)).join(',');

function massLabel(m, kind) {
  if (kind === 'planet') {
    const j = m / MJUP;
    if (j < 0.1) return (j * 317.8).toFixed(1) + ' M⊕';
    return j.toFixed(j < 10 ? 2 : 1) + ' M♃';
  }
  const s = m / MSUN;
  return s.toFixed(s < 10 ? 2 : 1) + ' M☉';
}
function kindName(b) {
  if (b.icy) return 'Comet';
  if (b.kind === 'planet') {
    if (b.m > DWARF) return 'Brown dwarf';
    if (b.life) return 'Living world';
    return b.style && b.style !== 'dwarf' ? PLANET_STYLES[b.style].name : 'Planet';
  }
  return b.kind === 'star' ? 'Star' : 'Black hole';
}
function fmtNum(v) {
  if (v >= 100) return Math.round(v).toLocaleString();
  if (v >= 1) return v.toFixed(2);
  return v.toPrecision(2);
}
function fmtTime(t) {
  const y = t / YEAR;
  if (y < 1000) return y.toFixed(1) + ' yr';
  if (y < 1e6) return (y / 1000).toFixed(2) + ' kyr';
  return (y / 1e6).toFixed(2) + ' Myr';
}
function spectral(Tk) {
  return Tk >= 30000 ? 'O' : Tk >= 10000 ? 'B' : Tk >= 7500 ? 'A' : Tk >= 6000 ? 'F' : Tk >= 5200 ? 'G' : Tk >= 3700 ? 'K' : 'M';
}

const spriteCache = new Map();
function glowSprite(rgb) {
  const key = rgb.map(c => c >> 3).join(',');
  let s = spriteCache.get(key);
  if (s) return s;
  s = document.createElement('canvas');
  s.width = s.height = 128;
  const g = s.getContext('2d');
  const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  const c = rgb.join(',');
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(0.08, `rgba(${c},0.95)`);
  gr.addColorStop(0.24, `rgba(${c},0.35)`);
  gr.addColorStop(0.55, `rgba(${c},0.08)`);
  gr.addColorStop(1, `rgba(${c},0)`);
  g.fillStyle = gr;
  g.fillRect(0, 0, 128, 128);
  spriteCache.set(key, s);
  return s;
}
const COMA = glowSprite([140, 245, 200]);
