# Pocket Universe: architecture

Copyright (c) 2026 Luke Bennie <lukebennie@gmail.com>. All rights reserved.

A browser gravity sandbox. There is no build step, no package manager and no runtime dependency beyond two Google Fonts. The same file runs from disk, from GitHub Pages and, trimmed by `tools/build_artifact.py`, as a claude.ai artifact.

## Files

| Path | What it is |
|---|---|
| `index.html` | The whole game: CSS, markup and one script (about 2,600 lines, 34 KB gzipped). |
| `tests/run_tests.py` | Test runner (Python 3.10+, standard library only). Loads a copy of the game in headless Chrome or Edge, runs the in-page checks and optionally saves screenshots. |
| `tests/harness.js` | The in-page checks: synthetic mouse, touch and keyboard input, plus regression checks. |
| `tools/build_artifact.py` | Rebuilds `pocket-universe.html` (gitignored), the copy published to claude.ai. |
| `.claude/agents/` | Review agents: `playtester`, `physics-reviewer`. |
| `CLAUDE.md` | Project guide and pre-push routine for Claude Code. |

## Code layout inside `index.html`

The script is a single IIFE in strict mode. Its sections, in order, are marked by banner comments:

1. **Units and constants**: G = 1, 200 units = 1 AU, 12,000 mass units = 1 M☉, `YEAR` ≈ 162 time units. Speed range, colour palettes, planet styles.
2. **State**: `bodies` (array of objects), `T` (dust in typed arrays, structure of arrays, capacity `MAX_T` = 8,000), camera, flags, simulated-time clocks.
3. **Helpers**: colour maths, labels, glow sprite cache.
4. **Bodies**: `radiusFor`, `refresh`, `makeBody`, dust add and remove, flux and orbit maths.
5. **Physics**: `accel` (all pairs, O(n²)), `stepTracers` (dust × heavy bodies), `step` (leapfrog kick-drift-kick), merges, tidal shredding, supernovae, `mainGroup` and `cull`, trails.
6. **Life**: habitable-zone timers, civilisations, probes, comet shedding.
7. **Scenes**: `SCENES` table (fit, blurb, `build()`), `loadScene`.
8. **Viewport, camera, backdrop**: resize, world↔screen transforms, zoom.
9. **Aiming**: tool mass ranges, hold-to-grow, `startAim`, `spawn`, trajectory `predict`.
10. **Input**: pointer events (mouse and touch paths), gestures, long-press, wheel, cursor.
11. **UI wiring**: hint and help, event feed, speed slider, toggles, inspector card, keyboard, HUD.
12. **Rendering**: trails, warp grid, habitable zones, dust, comets, planets (surfaces, shading, life), stars, black holes, effects, aim preview.
13. **Main loop**: `frame()` on `requestAnimationFrame`.
14. **Test hook**: `window.__pu`, created only when the test runner sets `window.__PU_TEST__`.

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
- `stepTracers()`: every dust particle × every heavy body (stars, black holes and planets of 400 units or more). Up to 8,000 particles.
- `drawTracers()`: one pass over the dust, building one `Path2D` per colour.
- `drawPlanet` / `drawSurface`: gradients and clipping per visible planet above 4 px.
- The work budget in `frame()` limits substeps to about 1.1 million pair-equivalents per frame. It counts operations, not measured time.
- Per-frame allocations: `bodies.filter` for lights, the effects filter, `Path2D` objects and gradient objects. There's no pooling.

## Determinism

Not deterministic today. The timestep follows real frame time, and scenes, planet styles, dust and effects use `Math.random`. Reproducible runs would need a seeded random-number generator and a fixed-step mode that only tests use.

## Test and build commands

```
python tests/run_tests.py            # 31 checks in headless Chrome, about 2 minutes
python tests/run_tests.py --screens  # also saves desktop and phone screenshots to tests/output/
python tools/build_artifact.py       # rebuild the claude.ai copy
```

There's no build. Deploy means pushing `main`, which GitHub Pages serves.
