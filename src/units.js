// Pocket Universe: units and constants
// Copyright (c) 2026 Luke Bennie <lukebennie@gmail.com>. All rights reserved.
//
// Units (G = 1, AU, years, km/s), physical thresholds and the tool,
// colour and name tables everything else builds on.
//
// One of the src/*.js files that tools/build.py joins, in order, into a single
// shared scope inside index.html; names defined in the other files are in
// scope here. See docs/ARCHITECTURE.md for the layout.

// ---------------------------------------------------------------------------
// Units. G = 1. 200 world units = 1 AU, 12,000 mass units = 1 solar mass.
// With those choices a 1 AU orbit around 1 M☉ takes ~162 time units = 1 year.
// ---------------------------------------------------------------------------
const AU = 200;
const MSUN = 12000;
const MJUP = MSUN / 1047.6;
const YEAR = 2 * Math.PI * Math.sqrt(AU ** 3 / MSUN);
const KMS = (1 / AU) / (1 / YEAR) * 4.74;      // 1 velocity unit in km/s
const IGNITE = 0.08 * MSUN;                     // hydrogen-burning limit
const DWARF = 13 * MJUP;                        // deuterium-burning limit: above this, a brown dwarf
const COLLAPSE = 20 * MSUN;                     // core collapse to a black hole
const HEAVY_TRACER_M = 400;                     // planets at or above this mass pull on dust like a star or hole does
const EPS2 = 16;                                // gravitational softening²
const DT = 0.085;
const MAX_T = 20000;                           // dust pool; when full, new grains replace the oldest
const TRAIL = 90;
const FAR = 80000;                              // 400 AU: past the view at the widest zoom
const GRACE = 180;                              // frames (3 s) a new body is safe from cull()
const RANK = { planet: 0, star: 1, bh: 2 };
const RATE_MIN = YEAR / 31557600, RATE_MAX = 1000 * YEAR;   // simulated time units per real second
const RATE_DEFAULT = 4;                         // about 9 days a second
const TRAIL_DT = 1.36;                          // least simulated time between trail points
const SHED_DT = 2;                              // simulated time between comet dust grains
const COMET_ICE = 1500;                         // dust grains a comet can shed before it's spent
const HZ_LO = 1 / (1.55 * 1.55), HZ_HI = 1 / (0.95 * 0.95);   // habitable flux range, Earth = 1
const LIFE_MIN = 10;                            // lighter worlds can't hold an atmosphere (in this toy)
const LIFE_T = [4 * YEAR, 14 * YEAR, 28 * YEAR];
const STAGE_NAME = ['None', 'Microbial', 'Civilization', 'Spacefaring'];

const canvas = document.getElementById('sky');
const ctx = canvas.getContext('2d');
const stage = document.getElementById('stage');
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const coarse = matchMedia('(pointer: coarse)').matches;
const MOD = /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent) ? '⌘' : 'Ctrl';

// Planet looks: base color, a second color for bands or surface patches,
// and whether the planet is banded like a gas giant.
const PLANET_STYLES = {
  ocean:   { name: 'Ocean world',  rgb: [58, 124, 222],  alt: [226, 238, 255] },
  teal:    { name: 'Ocean world',  rgb: [38, 172, 170],  alt: [206, 250, 236] },
  jungle:  { name: 'Jungle world', rgb: [86, 170, 90],   alt: [44, 112, 176] },
  desert:  { name: 'Desert world', rgb: [224, 178, 110], alt: [178, 116, 66] },
  rust:    { name: 'Rocky world',  rgb: [200, 96, 60],   alt: [124, 54, 38] },
  ash:     { name: 'Barren world', rgb: [156, 150, 146], alt: [98, 94, 92] },
  lava:    { name: 'Lava world',   rgb: [172, 62, 42],   alt: [255, 176, 64] },
  ice:     { name: 'Ice world',    rgb: [200, 234, 255], alt: [126, 184, 232] },
  lime:    { name: 'Exotic world', rgb: [174, 216, 82],  alt: [236, 250, 176] },
  gas:     { name: 'Gas giant',    rgb: [218, 180, 130], alt: [166, 102, 60],  bands: true },
  amber:   { name: 'Gas giant',    rgb: [240, 152, 66],  alt: [252, 224, 172], bands: true },
  violet:  { name: 'Gas giant',    rgb: [154, 108, 226], alt: [222, 176, 255], bands: true },
  rose:    { name: 'Gas giant',    rgb: [234, 126, 172], alt: [255, 204, 222], bands: true },
  neptune: { name: 'Ice giant',    rgb: [72, 122, 242],  alt: [154, 204, 255], bands: true },
  uranus:  { name: 'Ice giant',    rgb: [134, 222, 228], alt: [196, 248, 246], bands: true },
  dwarf:   { name: 'Brown dwarf',  rgb: [176, 66, 122],  alt: [236, 112, 140], bands: true }
};
const PLANET_KEYS = Object.keys(PLANET_STYLES).filter(k => k !== 'dwarf');
const ROCKY = ['rust', 'ash', 'lava', 'ice', 'desert'];
const ICE_RGB = [214, 236, 255];
const TRACER_RGB = [
  '246,207,142', '168,198,255', '224,169,156', '255,241,220', '159,224,208', '150,255,205',
  '255,120,200', '176,140,255', '110,220,255', '255,150,100', '200,240,120', '255,95,110',
  '255,190,80', '200,180,255'
];
// Dust clouds are drawn from one of these color families, like real nebulae.
const DUST_FAMILIES = [[6, 8, 3], [9, 7, 12], [11, 4, 3], [1, 13, 8], [10, 4, 0], [2, 12, 9], [7, 6, 13]];
const PROBE_COLOR = 5;                          // TRACER_RGB index used only for spacefaring probes
const NONPROBE = TRACER_RGB.map((_, i) => i).filter(i => i !== PROBE_COLOR);
const STAR_STOPS = [
  [0.08, [255, 72, 52]], [0.3, [255, 112, 62]], [0.7, [255, 166, 82]], [1.0, [255, 214, 122]],
  [1.6, [255, 244, 214]], [3.0, [234, 240, 255]], [8.0, [166, 196, 255]], [25, [120, 150, 255]],
  [80, [150, 124, 255]]
];
const BH_DISK = [[244, 184, 96], [255, 128, 160], [176, 140, 255], [110, 210, 255], [255, 150, 80]];
