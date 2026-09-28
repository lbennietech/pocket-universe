/*
 * Pocket Universe: in-page test harness
 * Copyright (c) 2026 Luke Bennie <lukebennie@gmail.com>. All rights reserved.
 *
 * run_tests.py injects this into the page. It drives the game with synthetic
 * mouse, touch and keyboard input and leaves its results in
 * window.__puResults. (Real browser input is tested from run_tests.py.)
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
  const scr = b => P().toScreen(b);
  function loadScene(s) {
    $('scene').value = s;
    $('scene').dispatchEvent(new Event('change'));
  }
  function report(obj) {
    obj.errors = window.__errs || [];
    obj.viewport = `${innerWidth}x${innerHeight}`;
    window.__puResults = obj;
  }

  async function functional() {
    const checks = [];
    const check = (name, pass, detail) => checks.push({ name, pass: !!pass, detail });

    await wait(300);
    loadScene('empty');
    await wait(100);
    check('starts empty at default speed', P().bodies.length === 0 && P().rate === P().RATE_DEFAULT,
      { bodies: P().bodies.length, rate: P().rate, label: $('speedLabel').textContent });

    // Slow-payoff scenes start faster than the global default, so life shows up sooner
    loadScene('cradle');
    await wait(100);
    const cradleRate = P().rate;
    $('speed').value = 900; $('speed').dispatchEvent(new Event('input'));
    const cradleManual = P().rate;
    loadScene('empty');
    await wait(100);
    check('cradle starts faster than the global default, and the slider still works after',
      cradleRate > P().RATE_DEFAULT && cradleManual > cradleRate && P().rate === P().RATE_DEFAULT,
      { cradleRate: r2(cradleRate), cradleManual: r2(cradleManual), resetRate: P().rate });

    // Restarting the same scene should keep the player's chosen speed, not
    // reset it to the scene's starting rate (a scene switch still should).
    loadScene('cradle');
    await wait(100);
    $('speed').value = 900; $('speed').dispatchEvent(new Event('input'));
    const beforeRestart = P().rate;
    $('restart').dispatchEvent(new Event('click'));
    await wait(100);
    check('restarting the same scene preserves a manually-set speed',
      P().rate === beforeRestart,
      { beforeRestart: r2(beforeRestart), afterRestart: r2(P().rate) });
    loadScene('empty');
    await wait(100);

    // Calling loadScene with the same key it's already on (as happens
    // coincidentally on the very first boot call) must NOT be mistaken for a
    // restart unless the caller explicitly says so — it should still apply
    // the scene's starting rate, not preserve a manually-set one.
    loadScene('cradle');
    await wait(100);
    $('speed').value = 900; $('speed').dispatchEvent(new Event('input'));
    const beforeReload = P().rate;
    P().loadScene('cradle');
    await wait(100);
    check('loading a scene that happens to match the current key, without an explicit restart flag, still applies its starting rate',
      beforeReload !== P().sceneRate('cradle') && P().rate === P().sceneRate('cradle'),
      { beforeReload: r2(beforeReload), afterReload: r2(P().rate) });
    loadScene('empty');
    await wait(100);

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
    const starMax = P().TOOLS.star.max, MSUN = P().MSUN;
    check('star grows to the maximum, scroll trims it', Math.abs(mMax / starMax - 1) < 0.005 && mWheel < mMax,
      { maxMsun: r2(mMax / MSUN), toolMaxMsun: r2(starMax / MSUN), afterWheelMsun: r2(mWheel / MSUN) });

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
    check('speed keys, slider range and reset', faster > P().RATE_DEFAULT && reset === P().RATE_DEFAULT && /hr\/s/.test(minLabel) && /yr\/s/.test(maxLabel),
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

    // --- regression checks for bugs found in the first full review ---

    // Esc cancels a throw even while Ctrl is still held
    loadScene('empty');
    await wait(100);
    key('1');
    pe('pointerdown', 500, 400, { ctrl: true });
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', ctrlKey: true, bubbles: true }));
    const aimAfterEsc = !!P().aim;
    pe('pointerup', 500, 400, { ctrl: true });
    check('Esc cancels a throw while Ctrl is held', !aimAfterEsc && P().bodies.length === 0,
      { aimAfterEsc, bodies: P().bodies.length });

    // The ? button brings the hint back
    $('hint').classList.add('gone');
    $('help').click();
    check('? button shows the hint again', !$('hint').classList.contains('gone'), {});

    // Pressing Help right after a scene loads must not show its blurb twice
    // (the scene load already announced it in the feed)
    loadScene('cradle');
    await wait(50);
    $('help').click();
    const blurbLis = [...document.querySelectorAll('#feed li span')].filter(s => s.textContent.startsWith('A quiet Sun'));
    check('help right after scene load does not duplicate the blurb', blurbLis.length === 1, { count: blurbLis.length });

    // Once something has been placed in Empty space, its "nothing here yet"
    // blurb shouldn't be repeated by Help
    loadScene('empty');
    await wait(50);
    key('1');
    pe('pointerdown', 500, 400, { ctrl: true });
    pe('pointerup', 500, 400, { ctrl: true });
    $('feed').innerHTML = '';
    $('help').click();
    const emptyBlurbLis = [...document.querySelectorAll('#feed li span')].filter(s => s.textContent.includes('Nothing here yet'));
    check('empty-space blurb is not repeated once something is placed', emptyBlurbLis.length === 0, { count: emptyBlurbLis.length });

    // The Follow toggle is a setting, not a tool: it should use the neutral
    // toggle styling (like Trails/Warp/Zones), not the tool-selection gold
    check('Follow toggle uses the neutral toggle style, not the tool gold',
      $('cFollow').classList.contains('toggle'), { classes: $('cFollow').className });

    // A mouse-clicked button gives up focus, so Space pauses instead of pressing it again
    $('restart').focus();
    $('restart').dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
    check('clicked buttons release focus', document.activeElement !== $('restart'),
      { active: document.activeElement && document.activeElement.id });

    // The planet preview keeps one style at small masses instead of flickering
    pe('pointerdown', 500, 400, { ctrl: true });
    const styles = new Set();
    for (let i = 0; i < 20; i++) styles.add(P().aimStyle(1));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', ctrlKey: true, bubbles: true }));
    pe('pointerup', 500, 400, { ctrl: true });
    check('small-planet preview keeps one style', styles.size === 1, { styles: [...styles] });

    // Brown dwarfs are always smaller than the smallest star
    const rBd = P().radiusFor(P().TOOLS.planet.max, 'planet'), rRd = P().radiusFor(P().IGNITE, 'star');
    check('biggest brown dwarf is smaller than smallest star', rBd < rRd, { brownDwarf: r2(rBd), redDwarf: r2(rRd) });

    // A black hole shredding a star keeps the pair's momentum
    loadScene('empty');
    await wait(100);
    key('4');
    await place('4', 700, 450, 0, 0, 0);
    await place('3', 500, 450, 0, 60, 0);
    // with only the two of them, their centre-of-mass velocity is constant;
    // after the shred the hole should move at exactly that velocity
    const mom = () => P().bodies.reduce((a, b) => [a[0] + b.m * b.vx, a[1] + b.m * b.vy, a[2] + b.m], [0, 0, 0]);
    const [px0, py0, m0all] = mom();
    const vcx = px0 / m0all, vcy = py0 / m0all;
    let tries = 0;
    while (P().bodies.length > 1 && tries++ < 60) await wait(100);
    const hole = P().bodies[0];
    const off = Math.hypot(hole.vx - vcx, hole.vy - vcy) / (Math.hypot(vcx, vcy) || 1);
    check("shredded star leaves the hole at the pair's centre-of-mass velocity", P().bodies.length === 1 && off < 0.02,
      { bodies: P().bodies.length, relativeError: r2(off) });

    // Pausing still lets the screen shake and flash die down
    const flashNow = P().flash;
    key(' ');
    await wait(600);
    const settled = P().flash <= flashNow * 0.2 + 0.01 && P().shake < 1;
    key(' ');
    check('shake and flash settle while paused', settled, { flash: r2(P().flash), shake: r2(P().shake) });

    // A runaway heavy black hole doesn't delete the solar system it leaves
    loadScene('cradle');
    await wait(100);
    for (let i = 0; i < 6; i++) key('-');          // zoom out so the corner is ~14 AU away
    await place('4', innerWidth - 60, 60, 1200, 300, -300);
    const sunId = P().bodies.find(b => b.kind === 'star').id;
    $('speed').value = 1000; $('speed').dispatchEvent(new Event('input'));
    await wait(5000);
    $('speedLabel').click();
    const sunKept = P().bodies.some(b => b.id === sunId);
    const bhGone = !P().bodies.some(b => b.kind === 'bh');
    check('a runaway black hole leaves the solar system alone', sunKept && bhGone && P().dust > 300,
      { sunKept, bhGone, bodies: P().bodies.length, dust: P().dust });

    // Throwing a heavy star into auto-orbit keeps the Sun's planets with the Sun
    loadScene('cradle');
    await wait(100);
    key(' ');
    for (let i = 0; i < 5; i++) key('-');
    key('o');
    await place('3', innerWidth / 2 + 300, innerHeight / 2, 2500);
    key('o');
    const sun = P().bodies.find(b => b.kind === 'star' && Math.abs(b.m - P().MSUN) < 1);
    const planets = P().bodies.filter(b => b.kind === 'planet' && !b.icy);
    const bound = planets.filter(b => {
      const dvx = b.vx - sun.vx, dvy = b.vy - sun.vy, r = Math.hypot(b.x - sun.x, b.y - sun.y);
      return 0.5 * (dvx * dvx + dvy * dvy) - (sun.m + b.m) / r < 0;
    }).length;
    const heavy = P().bodies.find(b => b.kind === 'star' && b !== sun);
    key(' ');
    check('auto-orbit throw of a heavy star keeps the planets bound to their Sun', bound === planets.length && heavy,
      { bound, planets: planets.length, thrownMsun: heavy && r2(heavy.m / P().MSUN) });

    // After a pinch, dragging the remaining finger moves the view and stops following
    const t = P().bodies[P().bodies.length - 1];
    const [bx, by] = scr(t);
    pe('pointerdown', bx, by, { pt: 'touch', id: 51 }); pe('pointerup', bx, by, { pt: 'touch', id: 51 });
    const following = P().follow;
    pe('pointerdown', 600, 400, { pt: 'touch', id: 52 });
    pe('pointerdown', 700, 400, { pt: 'touch', id: 53 });
    pe('pointermove', 720, 400, { pt: 'touch', id: 53 });
    pe('pointerup', 720, 400, { pt: 'touch', id: 53 });
    const camX = P().cam.x;
    pe('pointermove', 610, 400, { pt: 'touch', id: 52 });
    pe('pointermove', 750, 400, { pt: 'touch', id: 52 });
    await wait(200);
    pe('pointerup', 750, 400, { pt: 'touch', id: 52 });
    check('finger left after a pinch pans and stops following', following && !P().follow && P().cam.x < camX - 20,
      { wasFollowing: following, following: P().follow, camDx: r2(P().cam.x - camX) });

    // Every scene loads and runs
    for (const s of ['galaxies', 'cradle', 'feast', 'eight', 'formation', 'binary', 'mayhem']) {
      loadScene(s);
      await wait(400);
      check(`scene "${s}" runs`, P().bodies.length > 0 && (window.__errs || []).length === 0,
        { bodies: P().bodies.length, dust: P().dust });
    }

    // The star tile (the only 3-argument drawImage) is drawn unsmoothed, and
    // smoothing is back on for the scaled backdrop and glow sprites
    const proto = CanvasRenderingContext2D.prototype, realDraw = proto.drawImage;
    const seen = { tileSmooth: 0, tile: 0, spriteRough: 0, sprite: 0 };
    proto.drawImage = function (...a) {
      if (this.canvas === c) {
        if (a.length === 3) { seen.tile++; if (this.imageSmoothingEnabled) seen.tileSmooth++; }
        else { seen.sprite++; if (!this.imageSmoothingEnabled) seen.spriteRough++; }
      }
      return realDraw.apply(this, a);
    };
    await wait(200);
    proto.drawImage = realDraw;
    check('star tile drawn unsmoothed, sprites smoothed',
      seen.tile > 0 && seen.sprite > 0 && !seen.tileSmooth && !seen.spriteRough, seen);
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

  const start = async () => {
    let out;
    try {
      out = mode === 'visual' ? await visual() : await functional();
    } catch (err) {
      out = { mode, crashed: String(err && err.stack || err) };
    }
    report(out);
  };
  // run once the game has started
  if (document.readyState === 'complete') start(); else addEventListener('load', start);
})();
