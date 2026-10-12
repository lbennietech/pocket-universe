// Pocket Universe: start-up
// Copyright (c) 2026 Luke Bennie <lukebennie@gmail.com>. All rights reserved.
//
// Sizes the canvas, loads the first scene and starts the loop. Runs last.
//
// One of the src/*.js files that tools/build.py joins, in order, into a single
// shared scope inside index.html; names defined in the other files are in
// scope here. See docs/ARCHITECTURE.md for the layout.

// ?embed shows the simulation alone, with no title, panels, dock or hint, for
// framing it inside another page; ?scene=<key> picks the opening scene.
const params = new URLSearchParams(location.search);
if (params.has('embed')) document.documentElement.classList.add('embed');
const firstScene = params.get('scene');
resize();
setRate(RATE_DEFAULT);
loadScene(Object.hasOwn(SCENES, firstScene) ? firstScene : 'galaxies');
updateHud();
placeHint();
addEventListener('resize', () => requestAnimationFrame(placeHint));
// the readout grows as life and heavier bodies appear; keep the hint below it
if (window.ResizeObserver) new ResizeObserver(placeHint).observe(document.querySelector('.brand'));
requestAnimationFrame(frame);
