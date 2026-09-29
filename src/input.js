// Pocket Universe: input
// Copyright (c) 2026 Luke Bennie <lukebennie@gmail.com>. All rights reserved.
//
// Mouse, touch and keyboard handling.
//
// One of the src/*.js files that tools/build.py joins, in order, into a single
// shared scope inside index.html; names defined in the other files are in
// scope here. See docs/ARCHITECTURE.md for the layout.

// ---------------------------------------------------------------------------
// Input
//   Mouse: drag to move the view, click to inspect, scroll to zoom, and hold
//          Ctrl (⌘ on a Mac) and drag to throw.
//   Touch: drag to move, tap to inspect, pinch to zoom, and touch and hold to
//          place, then drag to throw. While placing, a second finger pinches
//          the new object bigger or smaller.
// ---------------------------------------------------------------------------
const LONG_PRESS = 380;       // ms a finger rests before it starts placing
const SLOP = 8;               // px a touch can wander and still count as a tap or hold
const pointers = new Map();
let gesture = null, pan = null, hover = null, modDown = false;

function startGesture() {
  const p = [...pointers.values()];
  const mx = (p[0].x + p[1].x) / 2, my = (p[0].y + p[1].y) / 2;
  gesture = { d0: Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y) || 1, z0: cam.z, wx: wx(mx), wy: wy(my) };
  cam.target = null;
}
function startResize(id) {
  const a = pointers.get(aim.id), b = pointers.get(id);
  if (!a || !b) return;
  freezeGrowth();
  // cube for bodies whose radius goes with ∛m, square for the rest, so the
  // ghost grows roughly in step with the fingers
  const k = tool === 'planet' || tool === 'comet' ? 3 : 2;
  aim.resize = { id, d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, lm0: aim.lm, k };
}
function checkLongPress() {
  if (!pan || !pan.touch || pan.moved || gesture || pointers.size !== 1) return;
  if (performance.now() - pan.t0 < LONG_PRESS) return;
  const id = pan.id, p = pointers.get(id);
  pan = null;
  if (!p) return;
  startAim(id, p.x, p.y, false);
  try { navigator.vibrate && navigator.vibrate(12); } catch (err) { /* no haptics */ }
}

function updateCursor() {
  let c = 'grab';
  if (gesture || (pan && pan.moved)) c = 'grabbing';
  else if (aim || modDown) c = 'crosshair';
  else if (hover && bodyAt(hover.x, hover.y)) c = 'pointer';
  if (canvas.style.cursor !== c) canvas.style.cursor = c;
}
function setMod(v) {
  if (v === modDown) return;
  modDown = v;
  updateCursor();
}

canvas.addEventListener('pointerdown', e => {
  canvas.setPointerCapture(e.pointerId);
  const X = e.offsetX, Y = e.offsetY;
  const mouse = e.pointerType === 'mouse';
  pointers.set(e.pointerId, { x: X, y: Y });
  if (!mouse && pointers.size === 2) {
    if (aim) startResize(e.pointerId);
    else { pan = null; startGesture(); }
    return;
  }
  if (pointers.size > 1 || gesture) return;
  if (mouse && e.button === 0 && (e.ctrlKey || e.metaKey)) {
    startAim(e.pointerId, X, Y, e.shiftKey);
    return;
  }
  pan = { id: e.pointerId, x: X, y: Y, sx: X, sy: Y, t0: performance.now(), moved: false, tap: !mouse || e.button === 0, touch: !mouse };
});

canvas.addEventListener('pointermove', e => {
  const X = e.offsetX, Y = e.offsetY;
  if (e.pointerType === 'mouse') { hover = { x: X, y: Y }; modDown = e.ctrlKey || e.metaKey; }
  if (!pointers.has(e.pointerId)) { updateCursor(); return; }
  // a mouse moving with no button down missed its pointerup: drop the drag
  if (e.pointerType === 'mouse' && e.buttons === 0) {
    endPointer(new PointerEvent('pointercancel', { pointerId: e.pointerId }));
    return;
  }
  pointers.set(e.pointerId, { x: X, y: Y });
  if (gesture) {
    if (pointers.size < 2) return;
    const p = [...pointers.values()];
    const mx = (p[0].x + p[1].x) / 2, my = (p[0].y + p[1].y) / 2;
    const d = Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y) || 1;
    cam.z = clampZoom(gesture.z0 * d / gesture.d0);
    cam.x = gesture.wx - (mx - VW / 2) / cam.z;
    cam.y = gesture.wy - (my - VH / 2) / cam.z;
    return;
  }
  if (aim) {
    if (e.pointerId === aim.id) {
      aim.cx = X; aim.cy = Y; aim.shift = e.shiftKey;
      if (aim.grow && Math.hypot(X - aim.sx, Y - aim.sy) > SLOP) freezeGrowth();
    }
    if (aim.resize) {
      const a = pointers.get(aim.id), b = pointers.get(aim.resize.id);
      if (a && b) aim.lm = aim.resize.lm0 + aim.resize.k * Math.log((Math.hypot(a.x - b.x, a.y - b.y) || 1) / aim.resize.d0);
    }
    return;
  }
  if (pan && pan.id === e.pointerId) {
    if (!pan.moved) {
      if (Math.hypot(X - pan.sx, Y - pan.sy) < (pan.touch ? SLOP : 4)) return;
      pan.moved = true;
      cam.target = null;
      setFollow(false);
      dragTip();
      updateCursor();
    }
    cam.x -= (X - pan.x) / cam.z;
    cam.y -= (Y - pan.y) / cam.z;
    pan.x = X; pan.y = Y;
  }
});

function endPointer(e) {
  pointers.delete(e.pointerId);
  const up = e.type === 'pointerup';
  if (gesture) {
    if (pointers.size >= 2) startGesture();
    else {
      gesture = null;
      // the finger still down carries on moving the view once it moves
      const [id, p] = [...pointers.entries()][0] || [];
      if (p) pan = { id, x: p.x, y: p.y, sx: p.x, sy: p.y, t0: 0, moved: false, tap: false, touch: false };
    }
  } else if (aim) {
    if (aim.resize && e.pointerId === aim.resize.id) aim.resize = null;
    else if (e.pointerId === aim.id) { if (up) spawn(); else aim = null; }
  } else if (pan && pan.id === e.pointerId) {
    const p = pan;
    pan = null;
    if (up && p.tap && !p.moved) {
      const b = bodyAt(e.offsetX, e.offsetY);
      if (b) select(b);
      else if (selected) deselect();
    }
  }
  updateCursor();
}
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);
// if the browser drops a pointerup (say the button was released in another
// window), end the drag instead of leaving it stuck
canvas.addEventListener('lostpointercapture', e => {
  if (pointers.has(e.pointerId)) endPointer(new PointerEvent('pointercancel', { pointerId: e.pointerId }));
});
canvas.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse') hover = null; });
canvas.addEventListener('contextmenu', e => e.preventDefault());
canvas.addEventListener('wheel', e => {
  e.preventDefault();
  const dy = e.deltaY * (e.deltaMode === 1 ? 33 : 1);
  if (aim) {
    freezeGrowth();
    aim.lm = aimLm() - dy * 0.0012;
    return;
  }
  zoomAt(e.offsetX, e.offsetY, cam.z * Math.exp(-dy * 0.0015));
}, { passive: false });
