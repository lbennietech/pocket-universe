# Pocket Universe: architecture

Copyright (c) 2026 Luke Bennie <lukebennie@gmail.com>. All rights reserved.

A browser gravity sandbox. There is no package manager and no runtime dependency beyond two Google Fonts. The source is split by area into `src/`, and `tools/build.py` (plain Python, standard library only) joins it into one self-contained `index.html`. That built file is committed at the repo root, so it runs from disk, from GitHub Pages (which serves `main` as is, with no CI) and, trimmed by `tools/build_artifact.py`, as a claude.ai artifact.

## Files

| Path | What it is |
|---|---|
| `src/` | The game's source: `shell.html` (head, markup and the script wrapper), `style.css` and 17 script files (see "Code layout" below). Edit these. |
| `index.html` | The built game: `src/` joined into one file (about 3,070 lines, 40.6 KB gzipped). Generated, so don't edit it; it's committed because GitHub Pages serves it. |
| `tools/build.py` | Builds `index.html` from `src/` (`--check`, `--check-ref <commit>`, `--where <line>`). The other tools call its `ensure()` so nobody runs a stale build. |
| `tests/run_tests.py` | Playwright (Python) test runner: in-page checks in Chromium, Firefox and WebKit, real mouse input, emulated Pixel 7 and iPhone 13, physics invariants, screenshots. |
| `tests/harness.js` | In-page input checks (synthetic mouse, touch and keyboard) and regression checks. |
| `tests/invariants.js` | Physics invariants: determinism, energy and momentum conservation, NaN under stress, tunnelling, step-size stability. |
| `bench/run_bench.py`, `bench/scenes.js` | Benchmarks on seeded scenes, desktop and a real phone screen. Each metric is the median of 5 interleaved runs (3 for `long-run`), plus a memory soak. The 5% regression gate (`--compare`) is a same-session A/B against the upstream `index.html`. The committed baseline (`bench/baseline.json`) keeps budgets and history, tagged with its method and scenario hash. |
| `tools/build_artifact.py` | Rebuilds `pocket-universe.html` (gitignored), the copy published to claude.ai, from a freshly built `index.html`. |
| `tools/serve.py` | Local server on port 8765 for the Playwright browser tool (`.mcp.json`). It rebuilds `index.html` from `src/` whenever the page is requested and `src/` has changed. |
| `.claude/agents/` | Review and audit agents (playtester, physics-reviewer, perf-profiler, ux-reviewer, game-designer, efficiency-auditor, code-quality-reviewer, triage). |
| `.claude/skills/` | `/audit` and `/iterate`. |
| `.claude/hooks/`, `.claude/settings.json` | Automatic checks: a rebuild and quick load check after edits, a stale-build check before `git commit`, the build, tests and benchmark gate before `git push`, and a guard on the baseline. |
| `BACKLOG.md` | Prioritised improvements from audits. |
| `CLAUDE.md` | Project guide and pre-push routine for Claude Code. |

## Code layout: `src/`

`tools/build.py` builds `index.html` like this:

- `src/shell.html` is the page: the `<head>`, the markup and the script wrapper. Its two marker lines are replaced by `src/style.css` (inside `<style>`) and by the script files (inside `<script>`).
- The script is a single IIFE in strict mode, opened and closed in `shell.html`. The script files are joined inside it, in the order of `SCRIPTS` in `tools/build.py`, one blank line apart, exactly as written (nothing is re-indented, so string contents can't change). So they all share one scope: a function or variable defined at the top level of one file is visible in every other, and nothing is imported or exported. Top-level code runs in file order, so a file may only *run* code that uses what earlier files defined (functions can refer to anything, since they run later).
- It's the same code the single file had, only moved: when the split landed, the built `index.html` matched the old one line for line, apart from the stamp line and the IIFE's two-space indent, which the source files dropped.
- Every `src/` file starts with a header: the copyright line and what the file holds, up to the first blank line. The build requires it and doesn't ship it.
- Line 2 of `index.html` is a stamp with a hash of the rest of the file. A stale build (`src/` changed since) is rebuilt automatically; a hand-edited `index.html` (hash mismatch) stops the build, tests and benchmarks with instructions, rather than being silently overwritten.
- A file in `src/` that isn't in `SCRIPTS` fails the build, so nothing is silently left out.
- Browser errors point at `index.html` lines; `python tools/build.py --where <line>` maps one back to `src/<file>:<line>`.

The script files, in the order they run (line counts include the header):

| File | Lines | What's in it |
|---|---|---|
| `units.js` | 85 | **Units and constants**: G = 1, 200 units = 1 AU, 12,000 mass units = 1 M☉, `YEAR` ≈ 162 time units. Speed range (`RATE_*`), time step `DT`, `MAX_T` (the dust cap, 20,000), thresholds (`IGNITE`, `COLLAPSE`, `DWARF`, `FAR`), colour palettes, planet styles. |
| `state.js` | 51 | **State**: `bodies` (array of objects), `T` (dust in typed arrays, structure of arrays, capacity `MAX_T`; when full, new grains replace the oldest), camera, flags, simulated-time clocks. |
| `helpers.js` | 104 | **Helpers**: `rand` and `seededRand`, colour maths, labels and formatting, glow sprite cache. |
| `bodies.js` | 150 | **Bodies**: `radiusFor`, `refresh`, `makeBody`, `makeComet`, dust add and remove (`addTracer`), effects, flux and orbit maths. |
| `physics.js` | 325 | **Gravity and time-stepping**: `accel` (all pairs, O(n²)), `stepTracers` (dust × heavy bodies), `step` (leapfrog kick-drift-kick), and the PERF-010 block time steps for high speeds (`forceOn`, `block`, `dustOn`, trails on the block grid). |
| `collisions.js` | 218 | **Collisions**: `resolveMerges`, `merge` (impacts, ignition, black holes), tidal shredding (`tidal`, `shred`), `supernova`. |
| `cull.js` | 90 | **Centre and culling**: `centerOfMass`, `mainGroup`, `cull` (removing far-off bodies). |
| `life.js` | 66 | **Life**: habitable-zone timers, civilisations, probes (`updateLife`), comet shedding (`shedComets`). |
| `scenes.js` | 245 | **Scenes**: `SCENES` table (fit, blurb, `build()`), `loadScene`. |
| `viewport.js` | 77 | **Viewport, camera, backdrop**: resize, world↔screen transforms, zoom. |
| `aiming.js` | 172 | **Aiming**: the `TOOLS` table and mass ranges, hold-to-grow, `startAim`, `spawn`, trajectory `predict`. |
| `input.js` | 168 | **Input**: pointer events (mouse and touch paths), gestures, long-press, wheel, cursor. |
| `ui.js` | 304 | **UI wiring**: hint and help, event feed, speed slider, toggles, inspector card, keyboard, HUD. |
| `render.js` | 555 | **Rendering**: trails, warp grid, habitable zones, dust, comets, planets (surfaces, shading, life), stars, black holes, effects, aim preview, `render()`. |
| `loop.js` | 106 | **Main loop**: `frame()` on `requestAnimationFrame`, `advance()` (one whole frame), the `perf` timers. |
| `testhook.js` | 40 | **Test hook**: `window.__pu`, created only when the test runner sets `window.__PU_TEST__`. |
| `boot.js` | 18 | **Start-up**: size the canvas, load the first scene, start the loop. |

Plus `shell.html` (147 lines) and `style.css` (321 lines). Where to look for a typical change: a constant is in `units.js`; how bodies move is `physics.js`; what happens when they meet is `collisions.js`; how it looks is `render.js` (and `style.css` for the HUD); a new toy or control touches `aiming.js`, `input.js` and `ui.js`; a new scene is `scenes.js`. Since the files share one scope, `grep -n "name" src/*.js` finds every use of a name.

Adding a file: give it the header, put it in `src/`, and add it to `SCRIPTS` in `tools/build.py` at the point in the run order where what its top-level code uses is already defined.

## How a frame flows

```
requestAnimationFrame → frame(now)
  checkLongPress()                     touch placement timer
  if not paused:
    want = rate × elapsed              simulated time to cover
    sub  = ceil(want / DT), capped by a work budget (pairs + dust × heavy)
    repeat sub times:
      step(dt)                         kick → drift → accel → kick → merges → tidal → dust
      record trail / shed comet dust on simulated-time clocks
    lights, life (every 6 frames), cull (every 30 frames)
    effect lifetimes
  flash and shake decay
  camera: hold while aiming, else follow the selection or glide to a target
  render()                             backdrop → warp → zones → trails → additive layer
                                       (dust, glows, comet tails, effects) → solid bodies
                                       → black holes → selection → aim preview
  HUD and inspector every 8 frames
```

Input events change state directly (camera, aim, selection). The simulation reads that state on the next frame.

## Hot paths

- `accel()`: all pairs of bodies, O(n²). Formation has about 280 bodies, so about 39,000 pairs per substep.
- `stepTracers()`: every dust particle × every heavy body (stars, black holes and planets of 400 units or more). Up to 20,000 particles.
- `drawTracers()`: one pass over the dust, building one `Path2D` per colour.
- `drawPlanet` / `drawSurface`: gradients and clipping per visible planet above 4 px.
- The work budget in `frame()` limits substeps to about 1.1 million pair-equivalents per frame. It counts operations, not measured time.
- Per-frame allocations: `bodies.filter` for lights, the effects filter, `Path2D` objects and gradient objects. There's no pooling.

## Determinism

Everything that shapes the simulation draws from `rand()`, which is `Math.random` in normal play. Tests and benchmarks seed it (`__pu.seed`), stop the real-time loop (`__pu.stopLoop`) and drive whole frames with a fixed elapsed time (`__pu.tick`), so a seed plus a number of frames always gives an identical state. Only visual noise (screen shake, the background star field) still uses `Math.random`.

## Test and build commands

```
python tests/run_tests.py            # everything, about 2 minutes
python tests/run_tests.py --screens  # also saves desktop and phone screenshots to tests/output/
python tests/run_tests.py --quick    # a few seconds: does the page load and run cleanly?
python bench/run_bench.py --compare  # benchmarks: upstream index.html against the working copy
python tools/build.py                # rebuild index.html from src/ (the commands above do it for you)
python tools/build.py --check        # is index.html current with src/? (--check-ref HEAD: in a commit)
python tools/build.py --where 1234   # which src/ file and line index.html:1234 came from
python tools/build_artifact.py       # rebuild the claude.ai copy
```

Setup, once per machine: `pip install playwright` and `python -m playwright install chromium firefox webkit`. The build needs only Python. Deploy means pushing `main` with the rebuilt `index.html` committed alongside its `src/` change; GitHub Pages serves it as is.
