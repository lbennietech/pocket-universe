// Pocket Universe: start-up
// Copyright (c) 2026 Luke Bennie <lukebennie@gmail.com>. All rights reserved.
//
// Sizes the canvas, loads the first scene and starts the loop. Runs last.
//
// One of the src/*.js files that tools/build.py joins, in order, into a single
// shared scope inside index.html; names defined in the other files are in
// scope here. See docs/ARCHITECTURE.md for the layout.

resize();
setRate(RATE_DEFAULT);
loadScene('galaxies');
updateHud();
placeHint();
addEventListener('resize', () => requestAnimationFrame(placeHint));
// the readout grows as life and heavier bodies appear; keep the hint below it
if (window.ResizeObserver) new ResizeObserver(placeHint).observe(document.querySelector('.brand'));
requestAnimationFrame(frame);
