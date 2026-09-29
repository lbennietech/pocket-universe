// Pocket Universe: UI wiring
// Copyright (c) 2026 Luke Bennie <lukebennie@gmail.com>. All rights reserved.
//
// The HUD readout, inspector card, dock buttons, speed slider, hint and
// event feed.
//
// One of the src/*.js files that tools/build.py joins, in order, into a single
// shared scope inside index.html; names defined in the other files are in
// scope here. See docs/ARCHITECTURE.md for the layout.

// ---------------------------------------------------------------------------
// UI wiring
// ---------------------------------------------------------------------------
const $ = id => document.getElementById(id);
const feed = $('feed');
const hint = $('hint');
const card = $('card'), cTitle = $('cTitle'), cGlyph = $('cGlyph'), cStats = $('cStats'), cNote = $('cNote'), cFollow = $('cFollow'), cSupernova = $('cSupernova');
const rTime = $('rTime'), rBodies = $('rBodies'), rDust = $('rDust'), rHeavy = $('rHeavy'), rLife = $('rLife');
const scaleLabel = $('scaleLabel'), scaleBar = $('scaleBar');
const toolBtns = [...document.querySelectorAll('[data-tool]')];
const speedIn = $('speed'), speedOut = $('speedLabel');

hint.innerHTML = coarse
  ? 'Touch and hold to place a <b id="hintTool">planet</b>, then drag to throw it.<small>Hold longer to make it bigger · Drag to move · Tap to inspect · ? for help</small>'
  : `Hold <b>${MOD}</b> and drag to throw a <b id="hintTool">planet</b>.<small>Hold still first to make it bigger · Drag to move · Click to inspect · ? for help</small>`;

// The hint leaves after the first throw, or after 20 seconds; the ? button
// (or H) brings it back along with the scene's description.
let hintTimer = setTimeout(() => hint.classList.add('gone'), 20000);
// Where there's no room beside the title, the hint goes just under the
// readout, measured, so a readout line that wraps can't run into it.
function placeHint() {
  // While the inspector is open on a narrow screen the brand (and its
  // readout) are hidden, so measuring it would put the hint at the top of
  // the stage, on top of the scene picker. The hint is hidden by CSS in
  // that state anyway, so just leave its position alone.
  if (VW > 1100 || topBar.classList.contains('inspecting')) { hint.style.top = ''; return; }
  hint.style.top = Math.round(document.querySelector('.brand').getBoundingClientRect().bottom - stage.getBoundingClientRect().top + 10) + 'px';
}
function showHelp() {
  placeHint();
  hint.classList.remove('gone');
  clearTimeout(hintTimer);
  hintTimer = setTimeout(() => hint.classList.add('gone'), 12000);
  // Empty space's blurb says there's nothing here yet; once something has
  // been placed that's no longer true, so don't repeat it.
  if (sceneKey !== 'empty' || !spawned) pushEvent(SCENES[sceneKey].blurb, 'info', 'blurb', 1500);
}
// Most people try a plain drag first. The first time that moves the view
// before anything has been thrown, explain how to throw.
let dragTipShown = false;
function dragTip() {
  if (spawned || dragTipShown) return;
  dragTipShown = true;
  pushEvent(coarse ? 'Dragging moves the view. To throw, touch and hold first, then drag.'
    : `Dragging moves the view. To throw something, hold ${MOD} while you drag.`, 'info');
}

const lastEv = {};
function pushEvent(text, tone, key, gap) {
  const now = performance.now();
  if (key) {
    if (lastEv[key] && now - lastEv[key] < gap) return;
    lastEv[key] = now;
  }
  const li = document.createElement('li');
  const dot = document.createElement('i');
  dot.className = 't-' + tone;
  const span = document.createElement('span');
  span.textContent = text;
  li.append(dot, span);
  feed.appendChild(li);
  while (feed.children.length > 4) feed.firstElementChild.remove();
  setTimeout(() => li.classList.add('out'), tone === 'info' ? 10000 : 6500);
  setTimeout(() => li.remove(), tone === 'info' ? 10900 : 7400);
}
// Frequent events are counted, not dropped: the first shows at the end of
// its frame, and any more within a second are shown together.
const tallies = {};
function tally(key, tone, one, many) {
  const t = tallies[key] || (tallies[key] = { n: 0, tone, one, many, at: -1e9 });
  t.n++; t.one = one;   // a lone event reads as the latest one
}
function flushTallies() {
  for (const k in tallies) {
    const t = tallies[k];
    if (!t.n || frameN - t.at < 60) continue;
    pushEvent(t.n > 1 ? t.many.replace('#', t.n) : t.one, t.tone);
    t.n = 0; t.at = frameN;
  }
}

const setPressed = (id, v) => $(id).setAttribute('aria-pressed', String(v));
function setTool(t) {
  tool = t;
  for (const b of toolBtns) b.setAttribute('aria-pressed', String(b.dataset.tool === t));
  const el = $('hintTool');
  if (el) el.textContent = TOOLS[t].name;
}
// The speed slider is logarithmic: every step changes the rate by the same
// percentage, from real time to a thousand years a second.
const SPEED_STEPS = 1000;
const rateToPos = r => Math.round(SPEED_STEPS * Math.log(r / RATE_MIN) / Math.log(RATE_MAX / RATE_MIN));
const posToRate = p => RATE_MIN * Math.pow(RATE_MAX / RATE_MIN, p / SPEED_STEPS);
function fmtRate(r) {
  const s = r / RATE_MIN, d = s / 86400, y = d / 365.25;   // simulated seconds, days, years a second
  const f = (v, u) => v.toFixed(v < 10 ? 1 : 0) + u;
  return s < 1.05 ? 'Real time' : s < 60 ? f(s, ' s/s') : s < 3600 ? f(s / 60, ' min/s') : d < 1 ? f(s / 3600, ' hr/s')
    : d < 60 ? f(d, ' days/s') : d < 365.25 ? (d / 30.44).toFixed(1) + ' mo/s' : y.toFixed(y < 10 ? 2 : y < 100 ? 1 : 0) + ' yr/s';
}
function showRate() {
  const txt = !paused && ach < rate * 0.9 ? '≈ ' + fmtRate(ach) : fmtRate(rate);
  if (speedOut.textContent !== txt) speedOut.textContent = txt;
}
function setRate(r, fromSlider) {
  ach = rate = clamp(r, RATE_MIN, RATE_MAX);
  const p = rateToPos(rate);
  if (!fromSlider) speedIn.value = p;
  speedIn.style.setProperty('--p', (100 * p / SPEED_STEPS) + '%');
  const txt = fmtRate(rate);
  speedOut.textContent = txt;
  speedIn.setAttribute('aria-valuetext', txt.replace('/s', ' per second'));
}
const nudgeRate = steps => setRate(posToRate(rateToPos(rate) + steps));
function togglePause() {
  paused = !paused;
  $('icoPause').hidden = paused;
  $('icoPlay').hidden = !paused;
  $('pause').setAttribute('aria-label', paused ? 'Play' : 'Pause');
  setPressed('pause', paused);
}
function toggleTrails() { showTrails = !showTrails; setPressed('trails', showTrails); }
function toggleWarp() { showWarp = !showWarp; setPressed('warp', showWarp); }
function toggleZones() { showZones = !showZones; setPressed('zones', showZones); }
function toggleAssist() { orbitAssist = !orbitAssist; setPressed('assist', orbitAssist); }

function setFollow(v) {
  follow = v && !!selected;
  followK = 0;
  cFollow.setAttribute('aria-pressed', String(follow));
  if (follow) cam.target = null;
}
const topBar = document.querySelector('.top');
function select(b) {
  selected = b;
  card.hidden = false;
  topBar.classList.add('inspecting');
  setFollow(true);
  updateCard();
}
function deselect() {
  selected = null;
  follow = false;
  card.hidden = true;
  topBar.classList.remove('inspecting');
}

function updateCard() {
  if (!selected) return;
  const b = selected;
  const rows = [];
  let note = '';
  cTitle.textContent = kindName(b);
  cGlyph.className = 'glyph ' + (b.icy ? 'g-comet' : b.kind === 'star' ? 'g-star' : b.kind === 'bh' ? 'g-bh' : b.life ? 'g-life' : 'g-planet');
  // planets show their own colors in the inspector
  cGlyph.style.background = b.kind === 'planet' && !b.icy
    ? `radial-gradient(circle at 34% 32%, rgb(${lighten(b.rgb, 0.5)}), rgb(${b.rgbStr}) 55%, rgb(${b.altStr}) 100%)`
    : '';

  if (!b.icy) rows.push(['Mass', massLabel(b.m, b.kind)]);
  cSupernova.hidden = true;
  if (b.kind === 'star') {
    const s = b.m / MSUN, Tk = Math.round(tempFor(s) / 10) * 10;
    rows.push(['Class', `${spectral(Tk)} · ${Tk.toLocaleString()} K`]);
    rows.push(['Light', `${fmtNum(b.lum)} L☉`]);
    const hi = 0.95 * Math.sqrt(b.lum), ho = 1.55 * Math.sqrt(b.lum);
    // past the edge of the universe (400 AU) nothing can orbit there
    rows.push(['Habitable', hi * AU > FAR ? 'Too far out' : `${fmtNum(hi)}–${fmtNum(ho)} AU`]);
    note = s >= COLLAPSE / MSUN
      ? 'A very massive star. If it collides with another star, it collapses into a black hole in a supernova. Or trigger one now.'
      : s >= 8
      ? `A heavy star. Merge it past 20 M☉ and it collapses into a black hole in a supernova.`
      : `Planets between ${fmtNum(hi)} and ${fmtNum(ho)} AU get the right amount of light for liquid water.`;
    cSupernova.hidden = !(s >= COLLAPSE / MSUN);
  } else if (b.kind === 'bh') {
    const rs = 2.953 * b.m / MSUN;
    rows.push(['Horizon', `${rs.toFixed(1)} km radius`]);
    note = 'Nothing that crosses the bright ring comes back. Stars that pass within its tidal radius get shredded first.';
  } else if (b.icy) {
    note = 'An icy nucleus. Near a star it grows a blue ion tail that points straight away from the star, plus a curved dust tail. The dust it sheds spreads along its orbit, like the streams behind real meteor showers.';
  } else {
    const F = b.flux, Tk = Math.round(278.6 * Math.pow(Math.max(F, 1e-6), 0.25));
    rows.push(['Temp', `${Tk} K · ${Math.round(Tk - 273.15)} °C`]);
    const inZone = F >= HZ_LO && F <= HZ_HI;
    rows.push(['Zone', inZone ? 'Habitable' : F > HZ_HI ? 'Too hot' : 'Too cold']);
    rows.push(['Life', STAGE_NAME[b.life], b.life ? 'alive' : '']);
    if (b.m > DWARF) note = 'A brown dwarf: too heavy to count as a planet, too light to burn hydrogen like a star.';
    else if (b.m < LIFE_MIN) note = `Too light for life in this sandbox: worlds need at least ${massLabel(LIFE_MIN, 'planet')}.`;
    else if (b.life === 3) note = 'A spacefaring civilization. Watch for the green probes it launches.';
    else if (b.life === 2) note = 'A civilization. Zoom in to see its city lights on the night side.';
    else if (b.life === 1) note = `Simple life has taken hold. A civilization needs about ${Math.max(0, (LIFE_T[1] - b.hz) / YEAR).toFixed(1)} more years in the zone.`;
    else if (inZone) note = `Liquid water is possible here. Life needs about ${Math.max(0, (LIFE_T[0] - b.hz) / YEAR).toFixed(1)} more years in the zone.`;
    else note = F > HZ_HI ? 'Too much starlight: any water boils off.' : 'Too little starlight: any water freezes solid.';
  }

  const p = primaryOf(b);
  if (p) {
    const o = orbitOf(b, p);
    rows.push(['Orbits', o.bound ? `${kindName(p)} · ${massLabel(p.m, p.kind)}` : 'Nothing (escaping)']);
    rows.push(['Distance', `${(o.r / AU).toFixed(2)} AU`]);
    if (o.bound) {
      rows.push(['Period', fmtTime(o.P)]);
      rows.push(['Eccentricity', o.e.toFixed(2)]);
    }
    rows.push(['Speed', `${(o.v * KMS).toFixed(1)} km/s`]);
  } else {
    rows.push(['Orbits', 'Nothing']);
    rows.push(['Speed', `${(Math.hypot(b.vx, b.vy) * KMS).toFixed(1)} km/s`]);
  }
  cStats.innerHTML = rows.map(([k, v, cls]) => `<dt>${k}</dt><dd${cls ? ` class="${cls}"` : ''}>${v}</dd>`).join('');
  cNote.textContent = note;
}

for (const b of toolBtns) b.addEventListener('click', () => setTool(b.dataset.tool));
speedIn.addEventListener('input', () => setRate(posToRate(+speedIn.value), true));
speedOut.addEventListener('click', () => setRate(RATE_DEFAULT));
$('pause').addEventListener('click', togglePause);
$('trails').addEventListener('click', toggleTrails);
$('warp').addEventListener('click', toggleWarp);
$('zones').addEventListener('click', toggleZones);
$('assist').addEventListener('click', toggleAssist);
$('center').addEventListener('click', centerView);
$('restart').addEventListener('click', () => loadScene(sceneKey, true));
$('help').addEventListener('click', showHelp);
$('scene').addEventListener('change', e => { loadScene(e.target.value); e.target.blur(); });
cFollow.addEventListener('click', () => setFollow(!follow));
$('cClose').addEventListener('click', deselect);
cSupernova.addEventListener('click', () => {
  if (selected && selected.kind === 'star' && selected.m >= COLLAPSE) {
    supernova(selected);
    updateCard();
  }
});

addEventListener('keydown', e => {
  if (e.key === 'Control' || e.key === 'Meta') { setMod(true); return; }
  if (e.target.closest && e.target.closest('select')) return;
  if (e.target.tagName === 'BUTTON' && (e.key === ' ' || e.key === 'Enter')) return;
  // Esc and Space work even while Ctrl or ⌘ is held for a throw
  if (e.key === 'Escape') { if (aim) { aim = null; updateCursor(); } else deselect(); return; }
  if (e.key === ' ') { e.preventDefault(); togglePause(); return; }
  // AltGr counts as Ctrl+Alt on Windows, so let it through for [ and ]
  const altGr = e.getModifierState && e.getModifierState('AltGraph');
  if ((e.metaKey || e.ctrlKey || e.altKey) && !altGr) return;
  // Match the typed character first, so [ ] + - and letters work wherever a
  // layout puts them (AltGr, Dvorak and QWERTZ included). The physical key is
  // only a fallback for the digit row (AZERTY types & é " ' ( there) and for
  // letters on non-Latin layouts, never for a Latin letter that simply has no
  // shortcut, so Dvorak's P can't restart the scene.
  const ACTIONS = {
    '1': () => setTool('planet'), '2': () => setTool('comet'), '3': () => setTool('star'),
    '4': () => setTool('bh'), '5': () => setTool('dust'),
    '[': () => nudgeRate(-20), ']': () => nudgeRate(20),
    t: toggleTrails, g: toggleWarp, z: toggleZones, o: toggleAssist,
    f: centerView, r: () => loadScene(sceneKey, true), h: showHelp, '?': showHelp,
    '=': () => zoomAt(VW / 2, VH / 2, cam.z * 1.25), '+': () => zoomAt(VW / 2, VH / 2, cam.z * 1.25),
    '-': () => zoomAt(VW / 2, VH / 2, cam.z / 1.25), '_': () => zoomAt(VW / 2, VH / 2, cam.z / 1.25)
  };
  const DIGITS = { Digit1: '1', Digit2: '2', Digit3: '3', Digit4: '4', Digit5: '5' };
  const LETTERS = { KeyT: 't', KeyG: 'g', KeyZ: 'z', KeyO: 'o', KeyF: 'f', KeyR: 'r', KeyH: 'h' };
  const nonLatin = e.key.length === 1 && e.key.charCodeAt(0) > 0x7e;
  const act = ACTIONS[e.key.toLowerCase()] || ACTIONS[DIGITS[e.code]] || (nonLatin ? ACTIONS[LETTERS[e.code]] : null);
  if (act) act();
});
// A mouse click leaves a button focused, and the browser would then give it
// Space and Enter (Space would restart the scene after clicking Restart).
// Keyboard users keep their focus: their clicks have detail 0.
document.addEventListener('click', e => {
  const b = e.target.closest && e.target.closest('button');
  if (b && e.detail > 0) b.blur();
});
addEventListener('keyup', e => { if (e.key === 'Control' || e.key === 'Meta') setMod(false); });
addEventListener('blur', () => setMod(false));

function updateHud() {
  rTime.textContent = fmtTime(simTime);
  rBodies.textContent = bodies.length.toLocaleString();
  rDust.textContent = T.n.toLocaleString();
  let h = null, alive = 0, civ = 0;
  for (const b of bodies) {
    if (!h || b.m > h.m) h = b;
    if (b.life) alive++;
    if (b.life >= 2) civ++;
  }
  rHeavy.innerHTML = h ? `${kindName(h)} <span class="nowrap">· ${massLabel(h.m, h.kind)}</span>` : '—';
  rLife.textContent = alive ? `${alive} ${alive === 1 ? 'world' : 'worlds'}${civ ? ` · ${civ} civ.` : ''}` : 'None yet';
  rLife.classList.toggle('alive', alive > 0);

  const steps = [0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000];
  let pick = steps[0];
  for (const s of steps) if (s * AU * cam.z <= 140) pick = s;
  scaleBar.style.width = Math.round(pick * AU * cam.z) + 'px';
  scaleLabel.textContent = pick + ' AU';
}
