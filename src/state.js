// Pocket Universe: game state
// Copyright (c) 2026 Luke Bennie <lukebennie@gmail.com>. All rights reserved.
//
// The mutable state shared by every other file: bodies, dust (tracer
// arrays), the camera, simulation time and rate, selection and effects.
//
// One of the src/*.js files that tools/build.py joins, in order, into a single
// shared scope inside index.html; names defined in the other files are in
// scope here. See docs/ARCHITECTURE.md for the layout.

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let bodies = [];
let nextId = 1;
let effects = [];
let lights = [];
let simTime = 0;
let fresh = false;   // accelerations and step criteria are current
let gNow = 0;        // grid time a new grain is born at
let lostX = 0, lostY = 0;   // momentum carried off by debris
let ach = RATE_DEFAULT;   // achieved rate, smoothed
let lifeClock = 0;
let paused = false;
let rate = RATE_DEFAULT;
let shedClock = 0;
let showTrails = true;
let showWarp = false;
let showZones = false;
let orbitAssist = false;
let tool = 'planet';
let sceneKey = 'galaxies';
let flash = 0;
let shake = 0;
let frameN = 0;
let spawned = false;
let selected = null;
let follow = false;
let followK = 0;
const cam = { x: 0, y: 0, z: 1, target: null };
const ZOOM_MIN = 0.02, ZOOM_MAX = 12;
const clampZoom = z => clamp(z, ZOOM_MIN, ZOOM_MAX);

const T = {
  n: 0,
  x: new Float32Array(MAX_T), y: new Float32Array(MAX_T),
  vx: new Float32Array(MAX_T), vy: new Float32Array(MAX_T),
  px: new Float32Array(MAX_T), py: new Float32Array(MAX_T),
  c: new Uint8Array(MAX_T),
  q: new Float32Array(MAX_T), b: new Float64Array(MAX_T)   // block steps: 1/step², grid time of birth
};
