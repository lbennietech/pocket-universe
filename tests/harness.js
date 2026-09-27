/*
 * Pocket Universe: in-page test harness
 * Copyright (c) 2026 Luke Bennie <lukebennie@gmail.com>. All rights reserved.
 *
 * run_tests.py injects this into a copy of index.html. It drives the game with
 * synthetic mouse, touch and keyboard input and logs the results to the
 * console as base64 JSON on a line starting "PU_RESULTS".
 *
 *   ?mode=functional           input and simulation checks (the default)
 *   ?mode=visual&scene=<key>   set up a scene, pause it and wait for a screenshot
 */
(() => {
  const params = new URLSearchParams(location.search);
  const mode = params.get('mode') || 'functional';
  const c = document.getElementById('sky');
  c.setPointerCapture = () => {};   // synthetic pointers can't be captured
  const $ = id => document.getElementById(id);
  const P = () => window.__pu;
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const r2 = v => Math.round(v * 100) / 100;

  function pe(type, x, y, o = {}) {
    c.dispatchEvent(new PointerEvent(type, {
      bubbles: true, cancelable: true, clientX: x, clientY: y,
      pointerId: o.id || 1, pointerType: o.pt || 'mouse', button: o.button ?? 0,
      buttons: type === 'pointerup' ? 0 : 1, ctrlKey: !!o.ctrl, shiftKey: !!o.shift, isPrimary: true
    }));
  }
  const key = (k, type = 'keydown') => window.dispatchEvent(new KeyboardEvent(type, { key: k, bubbles: true }));
  const scr = b => [(b.x - P().cam.x) * P().cam.z + innerWidth / 2, (b.y - P().cam.y) * P().cam.z + innerHeight / 2];
  function loadScene(s) {
    $('scene').value = s;
    $('scene').dispatchEvent(new Event('change'));
  }
  function report(obj) {
    obj.errors = window.__errs || [];
    obj.viewport = `${innerWidth}x${innerHeight}`;
    console.log('PU_RESULTS ' + btoa(unescape(encodeURIComponent(JSON.stringify(obj)))));
  }

  async function functional() {
    const checks = [];
    const check = (name, pass, detail) => checks.push({ name, pass: !!pass, detail });

    await wait(300);
    loadScene('empty');
    await wait(100);
    check('starts empty at default speed', P().bodies.length === 0 && P().rate === 4,
      { bodies: P().bodies.length, rate: P().rate, label: $('speedLabel').textContent });

    // Mouse: plain left drag moves the view and places nothing
    const cx0 = P().cam.x;
    pe('pointerdown', 700, 450); pe('pointermove', 710, 450); pe('pointermove', 800, 450); pe('pointerup', 800, 450);
    check('mouse drag pans the view', P().cam.x - cx0 < -50 && P().bodies.length === 0,
      { camDx: r2(P().cam.x - cx0), bodies: P().bodies.length });

    // Mouse: Ctrl + drag throws; holding still grows it, dragging locks the mass
    pe('pointerdown', 400, 300, { ctrl: true });
    const started = !!P().aim;
    await wait(1150);
    const mHeld = P().aimMass();
    pe('pointermove', 400, 330, { ctrl: true });
    await wait(800);
    const mAfterDrag = P().aimMass();
    pe('pointerup', 400, 330, { ctrl: true });
    const pl = P().bodies[P().bodies.length - 1];
    check('ctrl-drag throws a planet', started && P().bodies.length === 1 && pl.kind === 'planet' && pl.vy > 0,
      { count: P().bodies.length, kind: pl && pl.kind, style: pl && pl.style, vy: pl && r2(pl.vy) });
    check('holding still grows mass, dragging locks it', mHeld > 18 && Math.abs(mAfterDrag - mHeld) < 1e-6,
      { mHeld: r2(mHeld), mAfterDrag: r2(mAfterDrag) });

    // Mouse: click selects, click on empty space closes the inspector
    const [px, py] = scr(pl);
    pe('pointerdown', px, py); pe('pointerup', px, py);
    const shown = !$('card').hidden, title = $('cTitle').textContent;
    pe('pointerdown', 1200, 150); pe('pointerup', 1200, 150);
    check('click inspects, empty click closes', shown && $('card').hidden, { title });

    // Long hold reaches the maximum; the wheel fine-tunes it down
    key('3');
    pe('pointerdown', 900, 500, { ctrl: true });
    await wait(4500);
    const mMax = P().aimMass();
    c.dispatchEvent(new WheelEvent('wheel', { deltaY: 300, clientX: 900, clientY: 500, bubbles: true, cancelable: true }));
    const mWheel = P().aimMass();
    pe('pointerup', 900, 500, { ctrl: true });
    check('star grows to 100 M☉, scroll trims it', Math.abs(mMax / 12000 - 100) < 0.5 && mWheel < mMax,
      { maxMsun: r2(mMax / 12000), afterWheelMsun: r2(mWheel / 12000) });

    // Escape cancels a throw
    key('1');
    const nEsc = P().bodies.length;
    pe('pointerdown', 300, 600, { ctrl: true });
    key('Escape');
    pe('pointerup', 300, 600, { ctrl: true });
    check('Esc cancels a throw', P().bodies.length === nEsc, { bodies: P().bodies.length });

    // Speed controls
    key(']'); key(']');
    const faster = P().rate;
    $('speedLabel').click();
    const reset = P().rate;
    $('speed').value = 0; $('speed').dispatchEvent(new Event('input'));
    const minLabel = $('speedLabel').textContent;
    $('speed').value = 1000; $('speed').dispatchEvent(new Event('input'));
    const maxLabel = $('speedLabel').textContent;
    $('speedLabel').click();
    check('speed keys, slider range and reset', faster > 5 && reset === 4 && /hr\/s/.test(minLabel) && /yr\/s/.test(maxLabel),
      { faster: r2(faster), reset, minLabel, maxLabel });

    // Touch: quick drag moves the view without placing
    const cy0 = P().cam.y;
    pe('pointerdown', 600, 400, { pt: 'touch', id: 11 });
    pe('pointermove', 600, 420, { pt: 'touch', id: 11 });
    pe('pointermove', 600, 500, { pt: 'touch', id: 11 });
    await wait(600);
    pe('pointerup', 600, 500, { pt: 'touch', id: 11 });
    check('touch drag pans the view', P().cam.y - cy0 < -50 && !P().aim, { camDy: r2(P().cam.y - cy0) });

    // Touch: long press starts a placement; a second finger pinches it bigger
    const nb = P().bodies.length;
    pe('pointerdown', 500, 250, { pt: 'touch', id: 21 });
    await wait(250);
    const early = !!P().aim;
    await wait(300);
    const late = !!P().aim;
    const m0 = P().aimMass();
    pe('pointerdown', 560, 250, { pt: 'touch', id: 22 });
    pe('pointermove', 620, 250, { pt: 'touch', id: 22 });
    const mPinch = P().aimMass();
    pe('pointerup', 620, 250, { pt: 'touch', id: 22 });
    pe('pointermove', 500, 280, { pt: 'touch', id: 21 });
    pe('pointerup', 500, 280, { pt: 'touch', id: 21 });
    check('touch-and-hold places after ~0.4 s', !early && late && P().bodies.length === nb + 1,
      { aimAt250ms: early, aimAt550ms: late, placed: P().bodies.length - nb });
    check('second-finger pinch resizes while placing', mPinch > m0 * 4, { m0: r2(m0), mPinch: r2(mPinch) });

    // Touch: tap inspects
    const tb = P().bodies[P().bodies.length - 1];
    const [tx, ty] = scr(tb);
    pe('pointerdown', tx, ty, { pt: 'touch', id: 31 }); pe('pointerup', tx, ty, { pt: 'touch', id: 31 });
    check('tap inspects', !$('card').hidden, { title: $('cTitle').textContent });

    // Touch: two-finger pinch zooms and places nothing
    const z0 = P().cam.z, n2 = P().bodies.length;
    pe('pointerdown', 600, 400, { pt: 'touch', id: 41 });
    pe('pointerdown', 700, 400, { pt: 'touch', id: 42 });
    pe('pointermove', 800, 400, { pt: 'touch', id: 42 });
    pe('pointerup', 800, 400, { pt: 'touch', id: 42 });
    pe('pointerup', 600, 400, { pt: 'touch', id: 41 });
    check('pinch zooms', Math.abs(P().cam.z / z0 - 2) < 0.05 && !P().aim && P().bodies.length === n2,
      { zoomRatio: r2(P().cam.z / z0) });

    // Simulated time advances at the chosen rate
    const t0 = P().simTime, w0 = performance.now();
    await wait(2000);
    const perSec = (P().simTime - t0) / ((performance.now() - w0) / 1000);
    check('sim runs at the slider rate', Math.abs(perSec / P().rate - 1) < 0.1, { simPerSec: r2(perSec), rate: P().rate });

    // Every scene loads and runs
    for (const s of ['galaxies', 'cradle', 'feast', 'eight', 'formation', 'binary', 'mayhem']) {
      loadScene(s);
      await wait(400);
      check(`scene "${s}" runs`, P().bodies.length > 0 && (window.__errs || []).length === 0,
        { bodies: P().bodies.length, dust: P().dust });
    }
    return { mode, checks };
  }

  // Ctrl-drag placement at screen point (x, y), held still for holdMs
  async function place(toolKey, x, y, holdMs, dx = 0, dy = 0) {
    key(toolKey);
    pe('pointerdown', x, y, { ctrl: true });
    await wait(holdMs);
    pe('pointermove', x + dx, y + dy, { ctrl: true });
    pe('pointerup', x + dx, y + dy, { ctrl: true });
  }

  async function visual() {
    const scene = params.get('scene') || 'galaxies';
    await wait(200);
    if (scene === 'showcase') {
      // one of everything, zoomed in, to judge sizes and colors
      loadScene('empty');
      await wait(100);
      key(' ');
      for (let i = 0; i < 7; i++) key('=');
      await place('3', 700, 430, 100);
      await place('3', 1180, 230, 2000);
      await place('4', 250, 250, 2600);
      for (let i = 0; i < 9; i++) await place('1', 180 + i * 125, 700, i * 480);
      await place('2', 520, 330, 800, 20, 0);
      await place('5', 1000, 560, 1500);
      key('Control', 'keyup');
      window.dispatchEvent(new Event('blur'));
      await wait(300);
    } else {
      loadScene(scene);
      if (params.get('zoom')) for (let i = 0; i < +params.get('zoom'); i++) key('=');
      await wait(+(params.get('run') || 2500));
      key(' ');
    }
    return { mode, scene };
  }

  (async () => {
    let out;
    try {
      out = mode === 'visual' ? await visual() : await functional();
    } catch (err) {
      out = { mode, crashed: String(err && err.stack || err) };
    }
    report(out);
  })();
})();
