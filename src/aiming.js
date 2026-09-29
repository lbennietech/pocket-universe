// Pocket Universe: aiming
// Copyright (c) 2026 Luke Bennie <lukebennie@gmail.com>. All rights reserved.
//
// Placing and throwing new objects: the aim state, mass growth while
// holding, and launching.
//
// One of the src/*.js files that tools/build.py joins, in order, into a single
// shared scope inside index.html; names defined in the other files are in
// scope here. See docs/ARCHITECTURE.md for the layout.

// ---------------------------------------------------------------------------
// Aiming: press to place, hold still to add mass, drag to set velocity.
// Mass grows exponentially from the tool's base toward its maximum, so a long
// hold makes something far heavier than a tap. Dragging locks the mass in;
// the scroll wheel, or pinching with a second finger, fine-tunes it.
// ---------------------------------------------------------------------------
const TOOLS = {
  planet: { base: 12, min: 0.1, max: 940, name: 'planet' },
  comet: { base: 0.5, min: 0.05, max: 8, name: 'comet' },
  star: { base: MSUN, min: IGNITE, max: 100 * MSUN, name: 'star' },
  bh: { base: 5 * MSUN, min: 3 * MSUN, max: 1000 * MSUN, name: 'black hole' },
  dust: { base: 150, min: 20, max: 3000, name: 'dust cloud' }
};
const GROW_DELAY = 0.15;      // s a press lasts before it starts to grow
const GROW_TIME = 4;          // s of holding to go from base mass to maximum
let aim = null;
let aimHeavy = [];

// Aim mass is tracked as a log offset from the tool's base mass.
function lmRange() {
  const d = TOOLS[tool];
  return [Math.log(d.min / d.base), Math.log(d.max / d.base)];
}
function aimLm() {
  const [lo, hi] = lmRange();
  if (!aim.grow) return clamp(aim.lm, lo, hi);
  const t = Math.max(0, (performance.now() - aim.t0) / 1000 - GROW_DELAY);
  return clamp(aim.lm + t * hi / GROW_TIME, lo, hi);
}
function freezeGrowth() {
  if (!aim.grow) return;
  aim.lm = aimLm();
  aim.grow = false;
}
function aimMass() {
  const m = TOOLS[tool].base * Math.exp(aimLm());
  return tool === 'dust' ? Math.round(m) : m;
}
const assistOn = () => orbitAssist || (aim && aim.shift);
function assistSign(dx, dy) {
  const ddx = aim.cx - aim.sx, ddy = aim.cy - aim.sy;
  if (Math.hypot(ddx, ddy) <= 6) return 1;
  return ddx * -dy + ddy * dx >= 0 ? 1 : -1;
}
function aimVel() {
  const p = aim.primary;
  if (assistOn() && p && !p.dead) {
    const dx = aim.wx - p.x, dy = aim.wy - p.y, r = Math.hypot(dx, dy) || 1;
    const extra = tool === 'dust' ? 0 : aimMass();
    const v = circV(p.m + extra, r), s = assistSign(dx, dy);
    return { x: p.vx - s * v * dy / r, y: p.vy + s * v * dx / r };
  }
  const k = 0.06 / Math.sqrt(cam.z);
  return { x: (aim.cx - aim.sx) * k, y: (aim.cy - aim.sy) * k };
}
const cloudR = count => (20 + Math.sqrt(count) * 3) / cam.z;

function startAim(id, X, Y, shift) {
  const Wx = wx(X), Wy = wy(Y);
  let primary = null, bw = 0;
  for (const b of bodies) {
    const dx = b.x - Wx, dy = b.y - Wy, w = b.m / (dx * dx + dy * dy + 1);
    if (w > bw) { bw = w; primary = b; }
  }
  aim = {
    id, sx: X, sy: Y, cx: X, cy: Y, wx: Wx, wy: Wy, t0: performance.now(), shift, primary,
    grow: true, lm: 0, resize: null, style: pick(PLANET_KEYS), rocky: pick(ROCKY), fam: pick(DUST_FAMILIES)
  };
  aimHeavy = bodies.slice().sort((a, b) => b.m - a.m).slice(0, 40);
  updateCursor();
}

// The planet style is settled when aiming starts (one choice for normal
// masses, one for small rocky ones), so the preview doesn't flicker and the
// planet you throw looks like the preview.
function aimStyle(m) {
  if (m > DWARF) return 'dwarf';
  if (m < 2 && !ROCKY.includes(aim.style)) return aim.rocky;
  return aim.style;
}

function spawn() {
  const a = aim;
  const m = aimMass();
  const v = aimVel();
  const assist = assistOn() && a.primary && !a.primary.dead;
  if (tool === 'dust') {
    const R = cloudR(m);
    const p = a.primary;
    const s = assist ? assistSign(a.wx - p.x, a.wy - p.y) : 1;
    if (T.n + m > MAX_T) pushEvent('The dust is at its limit, so the oldest dust made way for the new cloud', 'info', 'dustcap', 20000);
    for (let i = 0; i < m; i++) {
      const rr = Math.abs(gauss()) * R * 0.5, ang = rand() * Math.PI * 2;
      const x = a.wx + Math.cos(ang) * rr, y = a.wy + Math.sin(ang) * rr;
      if (assist) {
        const dx = x - p.x, dy = y - p.y, r = Math.hypot(dx, dy) || 1, vc = circV(p.m, r);
        addTracer(x, y, p.vx - s * vc * dy / r, p.vy + s * vc * dx / r, pick(a.fam));
      } else {
        addTracer(x, y, v.x + gauss() * 0.3, v.y + gauss() * 0.3, pick(a.fam));
      }
    }
  } else {
    const b = tool === 'comet' ? makeComet(a.wx, a.wy, v.x, v.y, m)
      : makeBody(a.wx, a.wy, v.x, v.y, m, tool, tool === 'planet' ? aimStyle(m) : undefined);
    b.placed = true;
    const p = a.primary;
    if (!assist && p && !p.dead && p.m > m) {
      // a throw that dives straight into its primary: point to Auto-orbit, rarely
      const o = orbitOf(b, p);
      if (o.bound && o.a * (1 - o.e) < p.cr + b.cr) {
        pushEvent(`That throw falls into the ${kindName(p).toLowerCase()}. Turn on Auto-orbit${coarse ? '' : ' (O)'} to throw into orbit.`, 'info', 'fallhint', 120000);
      }
    }
    let M0 = 0, px = 0, py = 0;
    if (assist) for (const o of bodies) { M0 += o.m; px += o.m * o.vx; py += o.m * o.vy; }
    bodies.push(b);
    if (assist && M0) {
      // A heavy body thrown into orbit would otherwise send the whole system
      // lurching. Boosting everything by the same amount keeps the system's
      // centre of mass where it was and leaves every orbit, including the
      // new one, intact.
      const M1 = M0 + m;
      boostAll(px / M0 - (px + m * b.vx) / M1, py / M0 - (py + m * b.vy) / M1);
    }
    if (b.kind === 'star') lights = bodies.filter(o => o.kind === 'star');
    accel();
    pairs.length = 0;
  }
  aim = null;
  if (!spawned) { spawned = true; hint.classList.add('gone'); }
}

function predict(x, y, vx, vy) {
  const pts = [x, y];
  const dt = DT * 2;
  const hs = aimHeavy.filter(b => !b.dead);   // skip bodies that merged while aiming
  for (let s = 0; s < 480; s++) {
    let ax = 0, ay = 0, hit = false;
    for (let k = 0; k < hs.length; k++) {
      const b = hs[k];
      const dx = b.x - x, dy = b.y - y, r2 = dx * dx + dy * dy;
      if (r2 < b.cr * b.cr) { hit = true; break; }
      const d2 = r2 + EPS2, f = b.m / (d2 * Math.sqrt(d2));
      ax += f * dx; ay += f * dy;
    }
    if (hit) break;
    vx += ax * dt; vy += ay * dt;
    x += vx * dt; y += vy * dt;
    if (s % 3 === 2) pts.push(x, y);
  }
  return pts;
}

function bodyAt(X, Y) {
  let best = null, bd = Infinity;
  for (const b of bodies) {
    const d = Math.hypot(sx(b.x) - X, sy(b.y) - Y);
    const lim = Math.max(visR(b) + 6, 14);
    if (d < lim && d < bd) { bd = d; best = b; }
  }
  return best;
}
