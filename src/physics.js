// Pocket Universe: physics
// Copyright (c) 2026 Luke Bennie <lukebennie@gmail.com>. All rights reserved.
//
// Gravity and time-stepping: the leapfrog (kick-drift-kick) integrator for
// bodies, symplectic Euler dust, and the PERF-010 block time-step scheme
// (block, forceOn, dustOn) used at high speeds.
//
// One of the src/*.js files that tools/build.py joins, in order, into a single
// shared scope inside index.html; names defined in the other files are in
// scope here. See docs/ARCHITECTURE.md for the layout.

// ---------------------------------------------------------------------------
// Physics: leapfrog (kick-drift-kick) for massive bodies, symplectic Euler for
// massless dust, which only feels bodies heavy enough to matter.
// ---------------------------------------------------------------------------
const pairs = [];
function accel() {
  const n = bodies.length;
  for (let i = 0; i < n; i++) { bodies[i].ax = 0; bodies[i].ay = 0; }
  pairs.length = 0;
  for (let i = 0; i < n; i++) {
    const a = bodies[i];
    let ax = a.ax, ay = a.ay;
    const x = a.x, y = a.y, m = a.m, cr = a.cr;
    for (let j = i + 1; j < n; j++) {
      const b = bodies[j];
      const dx = b.x - x, dy = b.y - y;
      const r2 = dx * dx + dy * dy;
      const d2 = r2 + EPS2;
      const inv = 1 / (d2 * Math.sqrt(d2));
      ax += b.m * inv * dx; ay += b.m * inv * dy;
      b.ax -= m * inv * dx; b.ay -= m * inv * dy;
      const rr = cr + b.cr;
      if (r2 < rr * rr) pairs.push(a, b);
    }
    a.ax = ax; a.ay = ay;
  }
}

let HX = new Float64Array(256), HY = new Float64Array(256), HM = new Float64Array(256), HR = new Float64Array(256);
let HB = [];
const capR = b => (b.kind === 'bh' ? 2.2 : 1) * b.r;   // dust inside this is swallowed
function stepTracers(dt) {
  if (!T.n) return;
  HB = bodies.filter(isHeavy);
  const hn = HB.length;
  if (hn > HX.length) {
    HX = new Float64Array(hn * 2); HY = new Float64Array(hn * 2);
    HM = new Float64Array(hn * 2); HR = new Float64Array(hn * 2);
  }
  for (let k = 0; k < hn; k++) {
    const b = HB[k];
    HX[k] = b.x; HY[k] = b.y; HM[k] = b.m;
    HR[k] = capR(b) ** 2;
  }
  const X = T.x, Y = T.y, VX = T.vx, VY = T.vy;
  for (let i = 0; i < T.n; i++) {
    const x = X[i], y = Y[i];
    let ax = 0, ay = 0, hit = -1;
    for (let k = 0; k < hn; k++) {
      const dx = HX[k] - x, dy = HY[k] - y;
      const r2 = dx * dx + dy * dy;
      if (r2 < HR[k]) { hit = k; break; }
      const d2 = r2 + EPS2;
      const f = HM[k] / (d2 * Math.sqrt(d2));
      ax += f * dx; ay += f * dy;
    }
    if (hit >= 0) {
      HB[hit].feed += 1.5;
      removeTracer(i); i--;
      continue;
    }
    const vx = VX[i] + ax * dt, vy = VY[i] + ay * dt;
    VX[i] = vx; VY[i] = vy;
    X[i] = x + vx * dt; Y[i] = y + vy * dt;
  }
}

function step(dt) {
  const h = dt * 0.5;
  for (const b of bodies) {
    b.vx += b.ax * h; b.vy += b.ay * h;
    b.x += b.vx * dt; b.y += b.vy * dt;
  }
  accel();
  for (const b of bodies) { b.vx += b.ax * h; b.vy += b.ay * h; }
  if (pairs.length) resolveMerges();
  tidal();
  stepTracers(dt);
  simTime += dt;
  fresh = false;
}


// Block steps (high speeds): each body steps a power-of-two share of the
// frame, from its shortest free-fall or fly-by time. forceOn(): pull on the
// active bodies, q = 1/step², contacts; a body steps at most 8× longer than a
// main attractor that swings about (a binary), so it can't resonate with it.
const EF = 1 / (0.03 * 0.03), EV = 1 / (0.1 * 0.1), ED = 1 / (0.3 * 0.3);   // 1/η² for free fall, fly-by, dust
function forceOn(A, na) {
  const n = bodies.length;
  pairs.length = 0;
  for (let k = 0; k < na; k++) { const a = A[k]; a.ax = a.ay = a.q = a.pp = 0; a.act = k + 1; a.pr = null; }
  for (let k = 0; k < na; k++) {
    const a = A[k], x = a.x, y = a.y, vx = a.vx, vy = a.vy, m = a.m, cr = a.cr, ka = k + 1;
    let ax = a.ax, ay = a.ay, q = a.q, pp = a.pp;
    for (let j = 0; j < n; j++) {
      const b = bodies[j], bk = b.act;
      if (bk && bk <= ka) continue;
      const dx = b.x - x, dy = b.y - y;
      const r2 = dx * dx + dy * dy, d2 = r2 + EPS2;
      const s = Math.sqrt(d2), i2 = 1 / d2, inv = i2 / s;
      const ux = b.vx - vx, uy = b.vy - vy;
      let w = (m + b.m) * inv * EF;
      const f = (ux * ux + uy * uy) * i2 * EV;
      if (f > w) w = f;
      if (w > q) q = w;
      ax += b.m * inv * dx; ay += b.m * inv * dy;
      if (b.m * i2 > pp) { pp = b.m * i2; a.pr = b; a.pd = s; }
      if (bk) {
        b.ax -= m * inv * dx; b.ay -= m * inv * dy;
        if (w > b.q) b.q = w;
        if (m * i2 > b.pp) { b.pp = m * i2; b.pr = a; b.pd = s; }
      }
      const rr = cr + b.cr;
      if (r2 < rr * rr) pairs.push(a, b);
    }
    a.ax = ax; a.ay = ay; a.q = q; a.pp = pp;
  }
  for (let k = 0; k < na; k++) {
    const a = A[k], p = a.pr;
    a.act = 0;
    if (p && p.q > a.q * 64 && Math.hypot(p.ax, p.ay) * EF > 0.01 * a.pd * p.q) a.q = p.q / 64;
  }
}

let NT = 0, tk = 0, trailS = 0;
let anyBH = true;
function events() {
  const n0 = bodies.length;
  if (pairs.length) resolveMerges();
  if (anyBH) tidal();
  return bodies.length !== n0;
}
function openAll(A, na, t) {
  for (let k = 0; k < na; k++) {
    const b = A[k], need = 1 / (Math.sqrt(b.q) * tk);
    let st = 1;
    while (st * 2 <= need && t % (st * 2) === 0 && t + st * 2 <= NT) st *= 2;
    b.t0 = t; b.tn = t + st;
    b.vx += b.ax * st * tk / 2; b.vy += b.ay * st * tk / 2;
  }
}
function closeAll(t) {
  const h = tk / 2;
  for (const b of bodies) if (b.tn > t) { b.vx -= b.ax * (b.tn - t) * h; b.vy -= b.ay * (b.tn - t) * h; }
  forceOn(bodies, bodies.length);
  for (const b of bodies) {
    if (b.t0 < t) { b.vx += b.ax * (t - b.t0) * h; b.vy += b.ay * (t - b.t0) * h; }
    b.t0 = b.tn = t;
  }
}
function trailTo(b, now) {
  if (now - b.tc < Math.max(TRAIL_DT, Math.min(trailS, 2.3 / Math.sqrt(b.q)))) return;
  b.tc = now;
  const i = b.th * 2;
  b.trail[i] = b.x; b.trail[i + 1] = b.y;
  b.th = (b.th + 1) % TRAIL;
  if (b.tl < TRAIL) b.tl++;
}

const ACT = [];
let HG = new Float64Array(0);
function grid(g) {
  for (let k = 0, o = g * HB.length * 4; k < HB.length; k++, o += 4) {
    const b = HB[k];
    HG[o] = b.x; HG[o + 1] = b.y; HG[o + 2] = b.dead ? 0 : b.m; HG[o + 3] = capR(b) ** 2;
  }
}
const P0 = new Float64Array(5), P1 = new Float64Array(5);
function momentum(P) {
  let x = 0, y = 0, m = 0, cx = 0, cy = 0;
  for (const b of bodies) { x += b.m * b.vx; y += b.m * b.vy; m += b.m; cx += b.m * b.x; cy += b.m * b.y; }
  P[0] = x; P[1] = y; P[2] = m; P[3] = cx; P[4] = cy;
  return P;
}
function block(D, B) {
  anyBH = true;
  if (!fresh) { forceOn(bodies, bodies.length); events(); }
  const p0 = momentum(P0);
  lostX = lostY = 0;
  HB.length = 0;
  for (const b of bodies) if (isHeavy(b)) HB.push(b);
  const hn = HB.length, n = bodies.length;
  let rate = 0, qb = 0, dr = 0;
  anyBH = false;
  for (const b of bodies) {
    const s = Math.sqrt(b.q);
    rate += s;
    if (s > qb) qb = s;
    if (b.kind === 'bh') anyBH = true;
  }
  rate = rate * (n + 10) + qb * (50 + 3 * n);
  for (let i = 0; i < T.n; i++) if (T.q[i] > 0) dr += Math.sqrt(T.q[i]);
  rate += dr * (hn + 8) / 2;
  const left = Math.max(B / 4, B - n * n);   // less the full evaluations
  if (rate * D > left) D = left / rate;
  NT = 2 ** clamp(Math.ceil(Math.log2(D / DT * 8)), 0, 22);
  tk = D / NT; trailS = D / 3;
  const GS = NT / Math.min(NT, 1024);
  if (HG.length < (NT / GS + 1) * hn * 4) HG = new Float64Array((NT / GS + 1) * hn * 8);
  grid(0);
  openAll(bodies, n, 0);
  let t = 0, work = 0, ev = false, tn = GS, probes = 1;
  for (const b of bodies) if (b.tn < tn) tn = b.tn;
  while (t < NT) {
    const dt = (tn - t) * tk;
    t = tn;
    tn = t - t % GS + GS;
    let na = 0;
    for (const b of bodies) {
      b.x += b.vx * dt; b.y += b.vy * dt;
      if (b.tn === t) ACT[na++] = b;
      else if (b.tn < tn) tn = b.tn;
    }
    gNow = t / GS;
    const now = simTime + t * tk;
    work += 50 + bodies.length * (na + 3) + na * 10;
    if (t % GS === 0) {
      if (work > B && t < NT) { closeAll(t); ev = events(); grid(t / GS); break; }
      grid(t / GS);
    }
    if (na) {
      forceOn(ACT, na);
      for (let k = 0; k < na; k++) {
        const b = ACT[k];
        b.vx += b.ax * (t - b.t0) * tk / 2; b.vy += b.ay * (t - b.t0) * tk / 2;
        b.t0 = t;
        trailTo(b, now);
      }
      ev = pairs.length > 0 || anyBH && tidal(true);
      if (ev) {
        // a merger or disruption: sync everyone first, so debris and merged
        // bodies get true velocities, then restart from here
        closeAll(t);
        work += n * n;
        ev = events();
        if (t % GS === 0) grid(t / GS);   // new debris mustn't see the old bodies
        if (t < NT) openAll(bodies, bodies.length, t);
        for (const b of bodies) if (b.tn > t && b.tn < tn) tn = b.tn;
      } else if (t < NT) {
        openAll(ACT, na, t);
        for (let k = 0; k < na; k++) if (ACT[k].tn < tn) tn = ACT[k].tn;
      }
    }
    if (now - shedClock >= SHED_DT) { shedComets(); shedClock = Math.max(shedClock + SHED_DT, now - 4 * SHED_DT); }
    if (now - lifeClock >= YEAR / 2) { updateLife(now - lifeClock, probes); probes = 0; lifeClock = now; }
  }
  ACT.length = 0;
  fresh = !ev;
  gNow = 0;
  dustOn(hn, t / GS, GS * tk, B);
  // Uneven kicks leave spurious momentum: remove it (not what debris took)
  // and, if nothing was lost, restore the centre of mass. A uniform shift.
  const p1 = momentum(P1), M = p1[2];
  if (M) {
    const ux = (p1[0] - p0[0] + lostX) / M, uy = (p1[1] - p0[1] + lostY) / M;
    const keep = !lostX && !lostY && Math.abs(M / p0[2] - 1) < 1e-9;
    const sx = keep ? (p0[3] + p0[0] * t * tk - p1[3]) / M : 0, sy = keep ? (p0[4] + p0[1] * t * tk - p1[4]) / M : 0;
    for (const b of bodies) { b.vx -= ux; b.vy -= uy; b.x += sx; b.y += sy; }
    for (let i = 0; i < T.n; i++) { T.vx[i] -= ux; T.vy[i] -= uy; T.x[i] += sx; T.y[i] += sy; }
  }
  simTime += t * tk;
  return t * tk;
}

// Block-step dust: each grain leapfrogs (drift-kick-drift) through the heavy
// bodies on the grid, interpolated, in power-of-two steps down to 1/256 of a
// spacing. A new grain starts with the shortest step.
function dustOn(hn, ng, gt, B) {
  const X = T.x, Y = T.y, VX = T.vx, VY = T.vy, w = hn * 4;
  let work = 0;
  for (let i = 0; i < T.n; i++) {
    let g = T.b[i], x = X[i], y = Y[i], vx = VX[i], vy = VY[i], q = T.q[i], s = 1, hit = -1;
    T.b[i] = 0;
    if (q < 0) q = 1e30;
    while (g % s) s /= 2;
    while (g < ng) {
      const need = 1 / (Math.sqrt(q) * gt), lo = (work += hn + 8) > 8 * B ? 1 : 1 / 256;
      while (s > lo && s > need) s /= 2;
      while (s * 2 <= need && g % (s * 2) === 0 && g + s * 2 <= ng) s *= 2;
      while (g + s > ng) s /= 2;
      const h = s * gt, gm = g + s / 2, g0 = Math.floor(gm), fr = gm - g0;
      x += vx * h / 2; y += vy * h / 2;
      let ax = 0, ay = 0;
      q = 0;
      // masses come from the next point: no pull from a star just torn apart
      for (let k = 0, o = g0 * w, e = fr ? w : 0; k < hn; k++, o += 4) {
        const m = HG[o + e + 2];
        if (!m) continue;
        const dx = HG[o] + (HG[o + w] - HG[o]) * fr - x, dy = HG[o + 1] + (HG[o + w + 1] - HG[o + 1]) * fr - y;
        const r2 = dx * dx + dy * dy;
        if (r2 < HG[o + e + 3]) { hit = k; break; }
        const d2 = r2 + EPS2;
        const f = m / (d2 * Math.sqrt(d2));
        ax += f * dx; ay += f * dy;
        if (f > q) q = f;
      }
      if (hit >= 0) break;
      q *= ED;
      vx += ax * h; vy += ay * h;
      x += vx * h / 2; y += vy * h / 2;
      g += s;
    }
    if (hit >= 0) {
      let h = HB[hit];
      while (h.into) h = h.into;
      h.feed += 1.5;
      removeTracer(i); i--;
      continue;
    }
    X[i] = x; Y[i] = y; VX[i] = vx; VY[i] = vy;
    if (q < 1e30) T.q[i] = q;
  }
}
