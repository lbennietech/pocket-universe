// Pocket Universe: rendering
// Copyright (c) 2026 Luke Bennie <lukebennie@gmail.com>. All rights reserved.
//
// Drawing: trails, warp grid, zones, dust, bodies, sprites, the aim
// ghost, and render() for a whole frame.
//
// One of the src/*.js files that tools/build.py joins, in order, into a single
// shared scope inside index.html; names defined in the other files are in
// scope here. See docs/ARCHITECTURE.md for the layout.

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------
function drawTrail(b, alpha) {
  const tl = b.tl;
  if (tl < 2) return;
  const start = (b.th - tl + TRAIL) % TRAIL;
  const bands = 3;
  for (let s = 0; s < bands; s++) {
    const k0 = Math.floor(s * (tl - 1) / bands), k1 = Math.floor((s + 1) * (tl - 1) / bands);
    ctx.beginPath();
    for (let k = k0; k <= k1; k++) {
      const i = ((start + k) % TRAIL) * 2;
      const X = sx(b.trail[i]), Y = sy(b.trail[i + 1]);
      if (k === k0) ctx.moveTo(X, Y); else ctx.lineTo(X, Y);
    }
    if (s === bands - 1) ctx.lineTo(sx(b.x), sy(b.y));
    ctx.strokeStyle = `rgba(${b.rgbStr},${alpha * (s + 1) / bands})`;
    ctx.stroke();
  }
}

let GX = new Float32Array(0), GY = new Float32Array(0);
function drawWarp() {
  const wells = bodies.filter(b => b.m >= 2000);
  const waves = effects.filter(f => f.kind === 'wave');
  const gs = Math.pow(2, Math.round(Math.log2(46 / cam.z)));
  const gx0 = Math.floor(wx(-60) / gs) * gs, gy0 = Math.floor(wy(-60) / gs) * gs;
  const cols = Math.ceil((wx(VW + 60) - gx0) / gs) + 1, rows = Math.ceil((wy(VH + 60) - gy0) / gs) + 1;
  const n = cols * rows;
  if (n > 9000) return;
  if (GX.length < n) { GX = new Float32Array(n); GY = new Float32Array(n); }
  const ww = 40 / cam.z;
  for (let r = 0; r < rows; r++) {
    const y = gy0 + r * gs;
    for (let c = 0; c < cols; c++) {
      const x = gx0 + c * gs;
      let dx = 0, dy = 0;
      for (let k = 0; k < wells.length; k++) {
        const w = wells[k];
        const ex = w.x - x, ey = w.y - y, d = Math.sqrt(ex * ex + ey * ey) + 0.001;
        const pull = Math.min(0.8 * d, 0.35 * w.m / (d + 40));
        dx += ex / d * pull; dy += ey / d * pull;
      }
      for (let k = 0; k < waves.length; k++) {
        const f = waves[k];
        const ex = x - f.x, ey = y - f.y, d = Math.sqrt(ex * ex + ey * ey) + 0.001;
        const q = (d - f.rad) / ww;
        if (q < -3 || q > 3) continue;
        const amp = (f.size / cam.z) * (f.life / f.max) * Math.exp(-q * q) * Math.sin(q * 4);
        dx += ex / d * amp; dy += ey / d * amp;
      }
      const i = r * cols + c;
      GX[i] = sx(x + dx); GY[i] = sy(y + dy);
    }
  }
  ctx.beginPath();
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      if (c === 0) ctx.moveTo(GX[i], GY[i]); else ctx.lineTo(GX[i], GY[i]);
    }
  }
  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < rows; r++) {
      const i = r * cols + c;
      if (r === 0) ctx.moveTo(GX[i], GY[i]); else ctx.lineTo(GX[i], GY[i]);
    }
  }
  ctx.strokeStyle = 'rgba(127,182,255,0.15)';
  ctx.lineWidth = 1;
  ctx.stroke();
}

function drawZones() {
  ctx.font = '500 10px "IBM Plex Mono", ui-monospace, monospace';
  for (const s of lights) {
    const sq = Math.sqrt(s.lum);
    const ri = 0.95 * sq * AU * cam.z, ro = 1.55 * sq * AU * cam.z;
    if (ro < 8 || ri > 3 * Math.max(VW, VH)) continue;
    const X = sx(s.x), Y = sy(s.y);
    if (X + ro < 0 || Y + ro < 0 || X - ro > VW || Y - ro > VH) continue;
    ctx.fillStyle = 'rgba(110,220,160,0.07)';
    ctx.beginPath();
    ctx.arc(X, Y, ro, 0, 6.283);
    ctx.arc(X, Y, ri, 0, 6.283, true);
    ctx.fill();
    ctx.strokeStyle = 'rgba(110,220,160,0.24)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(X, Y, ro, 0, 6.283); ctx.stroke();
    ctx.beginPath(); ctx.arc(X, Y, ri, 0, 6.283); ctx.stroke();
    if (ro - ri > 14) {
      ctx.fillStyle = 'rgba(127,224,176,0.8)';
      ctx.textAlign = 'center';
      // Keep the label out from under the readout HUD, which sits on top
      // of the canvas at the top of the screen (mainly a phone-width issue).
      const labelY = Math.max(Y - (ri + ro) / 2 + 3, Math.min(Y + ro - 3, hudBottom + 12));
      ctx.fillText('HABITABLE ZONE', X, labelY);
      ctx.textAlign = 'start';
    }
  }
}

function drawOrbit(b) {
  const p = primaryOf(b);
  if (!p) return;
  const o = orbitOf(b, p);
  if (!o.bound || o.e >= 0.999 || o.a * cam.z > 40000) return;
  const bb = o.a * Math.sqrt(1 - o.e * o.e);
  const cx = p.x - o.a * o.ex, cy = p.y - o.a * o.ey;
  ctx.setLineDash([4, 6]);
  ctx.strokeStyle = 'rgba(244,184,96,0.5)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.ellipse(sx(cx), sy(cy), o.a * cam.z, bb * cam.z, Math.atan2(o.ey, o.ex), 0, 6.283);
  ctx.stroke();
  ctx.setLineDash([]);
}

function drawTracers() {
  ctx.lineWidth = 1.3;
  ctx.lineCap = 'round';
  const pad = 20;
  const paths = [];
  for (let i = 0; i < T.n; i++) {
    const X = sx(T.x[i]), Y = sy(T.y[i]);
    if (X < -pad || Y < -pad || X > VW + pad || Y > VH + pad) continue;
    let PX = sx(T.px[i]), PY = sy(T.py[i]);
    const d = Math.abs(PX - X) + Math.abs(PY - Y);
    if (d < 0.6 || d > 150) { PX = X - 0.6; PY = Y; }
    const c = T.c[i];
    const path = paths[c] || (paths[c] = new Path2D());
    path.moveTo(PX, PY);
    path.lineTo(X, Y);
  }
  for (let c = 0; c < paths.length; c++) {
    if (!paths[c]) continue;
    ctx.strokeStyle = `rgba(${TRACER_RGB[c]},${c === PROBE_COLOR ? 1 : 0.8})`;
    ctx.stroke(paths[c]);
  }
  ctx.lineCap = 'butt';
}

function onScreen(X, Y, m) { return X > -m && Y > -m && X < VW + m && Y < VH + m; }

function drawComet(b, X, Y) {
  const { F, best } = fluxAt(b.x, b.y);
  const k = Math.cbrt(b.m / 0.5);
  if (!best) { drawSprite(COMA, X, Y, 10 * k, 0.6); return; }
  let ax = b.x - best.x, ay = b.y - best.y;
  const ad = Math.hypot(ax, ay) || 1;
  ax /= ad; ay /= ad;
  const len = AU * 0.35 * Math.min(3, Math.sqrt(F)) * Math.sqrt(k) * cam.z;
  if (len > 3) {
    const ex = X + ax * len, ey = Y + ay * len;
    let g = ctx.createLinearGradient(X, Y, ex, ey);
    g.addColorStop(0, 'rgba(170,210,255,0.8)');
    g.addColorStop(1, 'rgba(170,210,255,0)');
    ctx.strokeStyle = g;
    ctx.lineWidth = clamp(len * 0.03, 1, 3);
    ctx.beginPath(); ctx.moveTo(X, Y); ctx.lineTo(ex, ey); ctx.stroke();
    const v = Math.hypot(b.vx, b.vy) || 1;
    let tx = ax - 0.6 * b.vx / v, ty = ay - 0.6 * b.vy / v;
    const tl = Math.hypot(tx, ty) || 1;
    tx /= tl; ty /= tl;
    const dx2 = X + tx * len * 0.75, dy2 = Y + ty * len * 0.75;
    g = ctx.createLinearGradient(X, Y, dx2, dy2);
    g.addColorStop(0, 'rgba(255,228,190,0.55)');
    g.addColorStop(1, 'rgba(255,228,190,0)');
    ctx.strokeStyle = g;
    ctx.lineWidth = clamp(len * 0.06, 1.5, 6);
    ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(X, Y); ctx.quadraticCurveTo(X + ax * len * 0.4, Y + ay * len * 0.4, dx2, dy2); ctx.stroke();
    ctx.lineCap = 'butt';
  }
  drawSprite(COMA, X, Y, (10 + Math.min(30, F * 6)) * k, 0.9);
}

function drawLife(b, X, Y, R, lx, ly) {
  const t = performance.now() / 1000;
  if (b.life >= 2 && R >= 3.5 && (lx || ly)) {
    const base = Math.atan2(-ly, -lx);
    const s = Math.max(0.9, R * 0.09);
    for (let k = 0; k < 8; k++) {
      const h1 = hash(b.id, k), h2 = hash(b.id, k + 17);
      const ang = base + (h1 - 0.5) * 2.0, rr = R * (0.2 + 0.65 * h2);
      const a = reduceMotion ? 0.85 : 0.55 + 0.45 * Math.sin(t * (1.5 + h1 * 2) + k);
      ctx.fillStyle = `rgba(255,214,130,${a.toFixed(2)})`;
      ctx.fillRect(X + Math.cos(ang) * rr - s / 2, Y + Math.sin(ang) * rr - s / 2, s, s);
    }
  }
  ctx.lineWidth = 1;
  ctx.strokeStyle = b.life >= 2 ? 'rgba(244,184,96,0.8)' : 'rgba(127,224,176,0.75)';
  if (b.life === 1) ctx.setLineDash([2, 3]);
  ctx.beginPath(); ctx.arc(X, Y, R + 3, 0, 6.283); ctx.stroke();
  ctx.setLineDash([]);
  if (b.life >= 3) {
    const a = t * 2 + b.id;
    ctx.fillStyle = '#9fffd8';
    ctx.beginPath(); ctx.arc(X + Math.cos(a) * (R + 6), Y + Math.sin(a) * (R + 6), 1.3, 0, 6.283); ctx.fill();
  }
}

// Close up, gas giants show bands and rocky worlds show surface patches
// (continents, seas, ice or magma), all shaded from the brightest star.
function drawSurface(b, X, Y, R) {
  ctx.save();
  ctx.beginPath(); ctx.arc(X, Y, R, 0, 6.283); ctx.clip();
  ctx.fillStyle = `rgb(${b.rgbStr})`;
  ctx.fillRect(X - R, Y - R, R * 2, R * 2);
  ctx.fillStyle = `rgba(${b.altStr},${b.bands ? 0.42 : 0.55})`;
  if (b.bands) {
    ctx.translate(X, Y);
    ctx.rotate(b.tilt);
    for (let k = 0; k < 6; k++) {
      const y0 = (hash(b.id, k) * 2 - 1) * R, h = R * (0.06 + 0.16 * hash(b.id, k + 9));
      ctx.fillRect(-R, y0 - h / 2, R * 2, h);
    }
  } else {
    for (let k = 0; k < 5; k++) {
      const a = hash(b.id, k) * 6.283, d = R * 0.75 * hash(b.id, k + 5), s = R * (0.2 + 0.32 * hash(b.id, k + 11));
      ctx.beginPath(); ctx.arc(X + Math.cos(a) * d, Y + Math.sin(a) * d, s, 0, 6.283); ctx.fill();
    }
  }
  ctx.restore();
}
function drawPlanet(b, X, Y, R) {
  if (b.icy) {
    ctx.fillStyle = '#eef6ff';
    ctx.beginPath(); ctx.arc(X, Y, Math.max(1.1, R), 0, 6.283); ctx.fill();
    return;
  }
  let lx = 0, ly = 0, best = 0;
  for (const s of lights) {
    const dx = s.x - b.x, dy = s.y - b.y, d2 = dx * dx + dy * dy + 1;
    const w = s.lum / d2;
    if (w > best) { best = w; const d = Math.sqrt(d2); lx = dx / d; ly = dy / d; }
  }
  if (R >= 4) drawSurface(b, X, Y, R);
  else {
    ctx.fillStyle = `rgb(${b.rgbStr})`;
    ctx.beginPath(); ctx.arc(X, Y, R, 0, 6.283); ctx.fill();
  }
  if (R >= 2.4 && best) {
    const g = ctx.createRadialGradient(X + lx * R * 0.45, Y + ly * R * 0.45, R * 0.1, X, Y, R * 1.05);
    g.addColorStop(0, 'rgba(255,255,255,0.3)');
    g.addColorStop(0.42, 'rgba(255,255,255,0)');
    g.addColorStop(1, 'rgba(6,8,16,0.9)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(X, Y, R, 0, 6.283); ctx.fill();
  }
  if (b.life) drawLife(b, X, Y, R, lx, ly);
}

function drawBlackHole(b, X, Y) {
  const R = visR(b);
  const heat = Math.min(1, b.feed / 120);
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = '#000';
  ctx.beginPath(); ctx.arc(X, Y, R, 0, 6.283); ctx.fill();
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineWidth = Math.max(1, R * 0.16);
  ctx.strokeStyle = `rgba(${b.ringStr},${0.5 + heat * 0.45})`;
  ctx.beginPath(); ctx.arc(X, Y, R * 1.3, 0, 6.283); ctx.stroke();
  // accretion arcs: a wide faint halo, a mid band and a bright thin core,
  // so they glow and fade at the edges instead of reading as flat bands
  ctx.lineCap = 'round';
  const glow = 0.6 + heat * 0.9;
  for (let k = 0; k < 2; k++) {
    const a = b.spin + k * Math.PI;
    for (const [w, al, col] of [[0.75, 0.06, b.rgbStr], [0.42, 0.12, b.rgbStr], [0.14, 0.34, b.ringStr]]) {
      ctx.lineWidth = Math.max(1, R * w);
      ctx.strokeStyle = `rgba(${col},${Math.min(1, al * glow).toFixed(3)})`;
      ctx.beginPath(); ctx.arc(X, Y, R * 2, a, a + 1.3); ctx.stroke();
    }
  }
  ctx.lineCap = 'butt';
}

function drawSprite(sprite, X, Y, S, alpha) {
  ctx.globalAlpha = alpha;
  ctx.drawImage(sprite, X - S / 2, Y - S / 2, S, S);
  ctx.globalAlpha = 1;
}

function drawSelection() {
  if (!selected) return;
  const b = selected;
  const X = sx(b.x), Y = sy(b.y);
  const R = Math.max(6, visR(b)) + 7, L = Math.min(8, R * 0.6);
  ctx.strokeStyle = 'rgba(244,184,96,0.95)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  for (const [ux, uy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    const cx = X + ux * R, cy = Y + uy * R;
    ctx.moveTo(cx, cy - uy * L); ctx.lineTo(cx, cy); ctx.lineTo(cx - ux * L, cy);
  }
  ctx.stroke();
}

// The object about to be placed, at screen point (X0, Y0). Returns its radius in px.
function drawGhost(X0, Y0, m) {
  if (tool === 'dust') {
    const R = cloudR(m) * cam.z * 0.5;
    ctx.setLineDash([2, 4]);
    ctx.lineWidth = 1;
    ctx.strokeStyle = `rgba(${TRACER_RGB[aim.fam[0]]},0.7)`;
    ctx.beginPath(); ctx.arc(X0, Y0, R, 0, 6.283); ctx.stroke();
    ctx.setLineDash([]);
    return R;
  }
  if (tool === 'comet') {
    const k = Math.cbrt(m / 0.5);
    ctx.globalCompositeOperation = 'lighter';
    drawSprite(COMA, X0, Y0, 16 * k, 0.9);
    ctx.globalCompositeOperation = 'source-over';
    return 2 * k;
  }
  const rgb = tool === 'star' ? starRGB(m) : tool === 'bh' ? [140, 180, 255] : PLANET_STYLES[aimStyle(m)].rgb;
  const R = Math.max(tool === 'bh' ? 2.5 : 1.8, radiusFor(m, tool) * cam.z);
  ctx.globalCompositeOperation = 'lighter';
  if (tool !== 'planet') drawSprite(glowSprite(rgb), X0, Y0, glowSize(R, tool), 0.8);
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = tool === 'bh' ? '#000' : `rgb(${lighten(rgb, tool === 'star' ? 0.5 : 0.1)})`;
  ctx.beginPath(); ctx.arc(X0, Y0, R, 0, 6.283); ctx.fill();
  if (tool === 'bh') {
    ctx.strokeStyle = 'rgba(255,222,180,0.9)';
    ctx.lineWidth = Math.max(1, R * 0.16);
    ctx.beginPath(); ctx.arc(X0, Y0, R * 1.3, 0, 6.283); ctx.stroke();
  }
  return R;
}

// A ring around the ghost that fills from the tool's lightest to heaviest.
function drawMeter(X0, Y0, r) {
  const [lo, hi] = lmRange();
  const f = (aimLm() - lo) / (hi - lo || 1);
  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(233,228,216,0.14)';
  ctx.beginPath(); ctx.arc(X0, Y0, r, 0, 6.283); ctx.stroke();
  ctx.strokeStyle = aim.grow ? 'rgba(244,184,96,0.95)' : 'rgba(244,184,96,0.65)';
  ctx.beginPath(); ctx.arc(X0, Y0, r, -Math.PI / 2, -Math.PI / 2 + f * 6.283); ctx.stroke();
}

function drawTag(X0, Y0, R, label) {
  ctx.font = '500 11px "IBM Plex Mono", ui-monospace, monospace';
  const tw = ctx.measureText(label).width;
  let LX = X0 + R + 12, LY = Y0 - R - 8;
  if (LX + tw > VW - 16) LX = X0 - R - 12 - tw;
  if (LY < 20) LY = Y0 + R + 18;
  LX = clamp(LX, 16, VW - 16 - tw);
  LY = clamp(LY, 20, VH - 12);
  ctx.fillStyle = 'rgba(4,5,10,0.7)';
  ctx.fillRect(LX - 6, LY - 12, tw + 12, 18);
  ctx.fillStyle = '#e9e4d8';
  ctx.fillText(label, LX, LY + 1);
}

// Holding Ctrl with the mouse over the sky shows where a throw would start.
function drawPreview() {
  const d = TOOLS[tool];
  const X0 = hover.x, Y0 = hover.y;
  const R = tool === 'dust' ? cloudR(d.base) * cam.z * 0.5 : Math.max(5, tool === 'comet' ? 2 : radiusFor(d.base, tool) * cam.z);
  ctx.setLineDash([3, 4]);
  ctx.lineWidth = 1.2;
  ctx.strokeStyle = 'rgba(244,184,96,0.75)';
  ctx.beginPath(); ctx.arc(X0, Y0, R, 0, 6.283); ctx.stroke();
  ctx.setLineDash([]);
  drawTag(X0, Y0, R, `Drag to throw a ${d.name}`);
}

// A touch that rests in place charges a ring, then turns into a placement.
function drawPress() {
  if (!pan || !pan.touch || pan.moved) return;
  const t = (performance.now() - pan.t0) / LONG_PRESS;
  const p = pointers.get(pan.id);
  if (t < 0.3 || !p) return;
  const k = Math.min(1, (t - 0.3) / 0.7);
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = `rgba(244,184,96,${(0.25 + 0.65 * k).toFixed(2)})`;
  ctx.beginPath(); ctx.arc(p.x, p.y, 34, -Math.PI / 2, -Math.PI / 2 + k * 6.283); ctx.stroke();
}

function drawAim() {
  if (!aim) {
    if (modDown && hover && !pan) drawPreview();
    drawPress();
    return;
  }
  const m = aimMass();
  const v = aimVel();
  const assist = assistOn() && aim.primary && !aim.primary.dead;
  const X0 = sx(aim.wx), Y0 = sy(aim.wy);
  const p = aim.primary && !aim.primary.dead ? aim.primary : null;

  // predicted path, in the frame of whatever it will orbit
  const pts = predict(aim.wx, aim.wy, v.x - (p ? p.vx : 0), v.y - (p ? p.vy : 0));
  const half = Math.floor(pts.length / 4) * 2;
  ctx.lineWidth = 1.3;
  ctx.setLineDash([3, 6]);
  for (let s = 0; s < 2; s++) {
    const a = s === 0 ? 0 : half, z = s === 0 ? half + 2 : pts.length;
    if (z - a < 4) continue;
    ctx.beginPath();
    for (let i = a; i < z; i += 2) {
      const X = sx(pts[i]), Y = sy(pts[i + 1]);
      if (i === a) ctx.moveTo(X, Y); else ctx.lineTo(X, Y);
    }
    ctx.strokeStyle = s === 0 ? 'rgba(244,184,96,0.85)' : 'rgba(244,184,96,0.35)';
    ctx.stroke();
  }
  ctx.setLineDash([]);

  // drag vector
  const dx = aim.cx - aim.sx, dy = aim.cy - aim.sy, dl = Math.hypot(dx, dy);
  if (dl > 6 && !assist) {
    ctx.strokeStyle = 'rgba(233,228,216,0.5)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(X0, Y0); ctx.lineTo(aim.cx, aim.cy); ctx.stroke();
    const ux = dx / dl, uy = dy / dl;
    ctx.beginPath();
    ctx.moveTo(aim.cx, aim.cy);
    ctx.lineTo(aim.cx - ux * 8 - uy * 4, aim.cy - uy * 8 + ux * 4);
    ctx.lineTo(aim.cx - ux * 8 + uy * 4, aim.cy - uy * 8 - ux * 4);
    ctx.closePath();
    ctx.fillStyle = 'rgba(233,228,216,0.6)';
    ctx.fill();
  }

  const R = drawGhost(X0, Y0, m);
  const ring = Math.max(R + 7, 12);
  drawMeter(X0, Y0, ring);
  let label = tool === 'dust' ? `${m.toLocaleString()} particles` : tool === 'comet' ? 'Comet' : massLabel(m, tool);
  if (assist) label += '  ·  circular orbit';
  else label += `  ·  ${(Math.hypot(v.x, v.y) * KMS).toFixed(1)} km/s`;
  drawTag(X0, Y0, ring, label);
}

function render() {
  const ox0 = shake > 0.3 ? (Math.random() - 0.5) * shake : 0;
  const oy0 = shake > 0.3 ? (Math.random() - 0.5) * shake : 0;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
  if (backdrop.width && backdrop.height) ctx.drawImage(backdrop, 0, 0, VW, VH);
  const S = 512;
  const ox = (((-cam.x * 0.03) % S) + S) % S - S;
  const oy = (((-cam.y * 0.03) % S) + S) % S - S;
  // Nearest-neighbour for the star tile: bilinear resampling at the fractional
  // parallax offset is costly on phones. Restored for the scaled glow sprites.
  ctx.imageSmoothingEnabled = false;
  for (let x = ox; x < VW; x += S) for (let y = oy; y < VH; y += S) ctx.drawImage(starTile, x, y);
  ctx.imageSmoothingEnabled = true;
  ctx.setTransform(dpr, 0, 0, dpr, ox0 * dpr, oy0 * dpr);

  if (showWarp) drawWarp();
  if (showZones) drawZones();

  if (showTrails) {
    ctx.lineWidth = 1;
    for (const b of bodies) {
      const a = b.icy ? 0.3 : b.kind === 'planet' ? (b.m < 10 ? 0.16 : 0.45) : b.kind === 'bh' ? 0.4 : 0.5;
      drawTrail(b, a);
    }
  }
  if (selected) drawOrbit(selected);

  // additive layer: dust, glows, tails, effects
  ctx.globalCompositeOperation = 'lighter';
  drawTracers();
  for (const b of bodies) {
    if (b.kind === 'planet') {
      if (!b.icy) continue;
      const X = sx(b.x), Y = sy(b.y);
      if (onScreen(X, Y, 300)) drawComet(b, X, Y);
      continue;
    }
    const X = sx(b.x), Y = sy(b.y);
    const R = visR(b);
    const size = glowSize(R, b.kind);
    if (!onScreen(X, Y, size)) continue;
    const a = b.kind === 'bh' ? 0.3 + Math.min(1, b.feed / 120) * 0.45 : 0.9;
    drawSprite(b.sprite, X, Y, size, a);
  }
  for (const f of effects) {
    const t = f.life / f.max;
    const X = sx(f.x), Y = sy(f.y);
    if (f.kind === 'ring') {
      const r = Math.max(5, f.size * cam.z) * (1 + 3.5 * (1 - t));
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = `rgba(${f.rgb},${(0.8 * t).toFixed(3)})`;
      ctx.beginPath(); ctx.arc(X, Y, r, 0, 6.283); ctx.stroke();
    } else if (f.kind === 'wave') {
      ctx.lineWidth = 1.2;
      for (let k = 0; k < 3; k++) {
        const r = (f.rad - k * 26 / cam.z) * cam.z;
        if (r <= 0) continue;
        ctx.strokeStyle = `rgba(${f.rgb},${(0.35 * t * (1 - k * 0.3)).toFixed(3)})`;
        ctx.beginPath(); ctx.arc(X, Y, r, 0, 6.283); ctx.stroke();
      }
    } else {
      const s = Math.min(Math.max(VW, VH) * 1.5, Math.max(20, f.size * cam.z * 6) * (1 + (1 - t)));
      drawSprite(glowSprite(f.rgb.split(',').map(Number)), X, Y, s, t);
    }
  }

  // solid bodies
  ctx.globalCompositeOperation = 'source-over';
  for (const b of bodies) {
    if (b.kind === 'bh') continue;
    const X = sx(b.x), Y = sy(b.y);
    const R = visR(b);
    if (!onScreen(X, Y, R + 10)) continue;
    if (b.kind === 'planet') drawPlanet(b, X, Y, R);
    else {
      if (R > 4) {
        // hot white center fading to the star's own color at the limb
        const g = ctx.createRadialGradient(X, Y, 0, X, Y, R);
        g.addColorStop(0, b.hot);
        g.addColorStop(0.55, b.core);
        g.addColorStop(1, b.limb);
        ctx.fillStyle = g;
      } else ctx.fillStyle = b.core;
      ctx.beginPath(); ctx.arc(X, Y, R, 0, 6.283); ctx.fill();
    }
  }
  for (const b of bodies) {
    if (b.kind !== 'bh') continue;
    const X = sx(b.x), Y = sy(b.y);
    if (!onScreen(X, Y, visR(b) * 2.5 + 10)) continue;
    drawBlackHole(b, X, Y);
  }
  ctx.globalCompositeOperation = 'source-over';

  drawSelection();
  drawAim();

  if (flash > 0.01) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = `rgba(255,236,210,${flash.toFixed(3)})`;
    ctx.fillRect(0, 0, VW, VH);
    ctx.globalCompositeOperation = 'source-over';
  }
}
