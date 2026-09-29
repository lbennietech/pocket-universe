// Pocket Universe: viewport
// Copyright (c) 2026 Luke Bennie <lukebennie@gmail.com>. All rights reserved.
//
// Canvas size, the camera (world <-> screen), zoom and the backdrop.
//
// One of the src/*.js files that tools/build.py joins, in order, into a single
// shared scope inside index.html; names defined in the other files are in
// scope here. See docs/ARCHITECTURE.md for the layout.

// ---------------------------------------------------------------------------
// Viewport, camera, backdrop
// ---------------------------------------------------------------------------
let VW = 0, VH = 0, dpr = 1, backdrop = null, hudBottom = 0;
const starTile = document.createElement('canvas');
(function buildStarTile() {
  const S = 512;
  starTile.width = starTile.height = S;
  const g = starTile.getContext('2d');
  const tints = ['255,214,170', '180,205,255', '235,232,225', '235,232,225', '255,170,150', '200,180,255', '170,235,255', '255,236,180'];
  for (let i = 0; i < 260; i++) {
    const x = Math.random() * S, y = Math.random() * S, b = Math.random();
    const r = b > 0.97 ? 1.25 : b > 0.85 ? 0.85 : 0.55;
    const a = (0.2 + Math.random() * 0.5).toFixed(2);
    g.fillStyle = `rgba(${pick(tints)},${a})`;
    g.beginPath(); g.arc(x, y, r, 0, 6.283); g.fill();
  }
})();

function resize() {
  VW = stage.clientWidth; VH = stage.clientHeight;
  dpr = Math.min(2, window.devicePixelRatio || 1);
  // Cache how far down the readout HUD reaches, so drawZones() can keep its
  // labels from landing underneath it (recomputed here, not per frame).
  const readout = document.querySelector('.readout');
  hudBottom = readout.getBoundingClientRect().bottom - stage.getBoundingClientRect().top;
  canvas.width = Math.round(VW * dpr);
  canvas.height = Math.round(VH * dpr);
  backdrop = document.createElement('canvas');
  backdrop.width = canvas.width; backdrop.height = canvas.height;
  const g = backdrop.getContext('2d');
  g.scale(dpr, dpr);
  g.fillStyle = '#04050a';
  g.fillRect(0, 0, VW, VH);
  const neb = [
    [0.16, 0.28, 0.6, '64,90,190', 0.12], [0.84, 0.74, 0.55, '190,70,110', 0.08],
    [0.62, 0.12, 0.35, '40,160,170', 0.07], [0.36, 0.86, 0.42, '120,70,200', 0.08],
    [0.95, 0.18, 0.3, '220,120,60', 0.05]
  ];
  for (const [fx, fy, fr, c, a] of neb) {
    const R = Math.max(VW, VH) * fr;
    const gr = g.createRadialGradient(fx * VW, fy * VH, 0, fx * VW, fy * VH, R);
    gr.addColorStop(0, `rgba(${c},${a})`);
    gr.addColorStop(1, `rgba(${c},0)`);
    g.fillStyle = gr;
    g.fillRect(0, 0, VW, VH);
  }
}

const sx = x => (x - cam.x) * cam.z + VW / 2;
const sy = y => (y - cam.y) * cam.z + VH / 2;
const wx = X => (X - VW / 2) / cam.z + cam.x;
const wy = Y => (Y - VH / 2) / cam.z + cam.y;
// minimum on-screen radius, so small things stay visible when zoomed out
function visR(b) { return Math.max(b.kind === 'bh' ? 4 : b.kind === 'star' ? 1.8 : 2, b.r * cam.z); }

function zoomAt(px, py, z) {
  const X = wx(px), Y = wy(py);
  cam.z = clampZoom(z);
  cam.x = X - (px - VW / 2) / cam.z;
  cam.y = Y - (py - VH / 2) / cam.z;
  cam.target = null;
}
function centerView() {
  if (selected) { setFollow(true); return; }
  const c = mainGroup();
  cam.target = { x: c.x, y: c.y };
}
