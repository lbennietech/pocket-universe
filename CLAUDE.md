# Pocket Universe

A browser gravity sandbox by Luke Bennie. Everything in the game lives in `index.html`: plain HTML, CSS and JavaScript on a 2D canvas, with no build step and no dependencies beyond Google Fonts. It's published at https://lbennietech.github.io/pocket-universe/ from the `main` branch.

## Files

- `index.html`: the game. Edit this one.
- `tests/run_tests.py`: plays the game in headless Chrome with scripted mouse, touch and keyboard input. `--screens` also saves desktop and phone screenshots to `tests/output/`, which git ignores. `tests/harness.js` holds the in-page checks.
- `tools/build_artifact.py`: rebuilds `pocket-universe.html`, the copy published as a private claude.ai artifact (https://claude.ai/artifact/QMJGjmuBKfrCHBa8WvXdK5). That file is ignored by git.
- `.claude/agents/`: the review agents described below.

## Before every push

1. Run `python tests/run_tests.py`. Every check must pass.
2. Run `/code-review` on the changes and fix what it finds.
3. Have the **playtester** agent check the change, including its screenshots.
4. If the change touches the simulation (gravity, collisions, sizes, masses, speed or time-stepping, dust, life rules or scenes), also have the **physics-reviewer** agent review it.
5. Run `python tools/build_artifact.py` and republish `pocket-universe.html` to the claude.ai artifact, so both copies match.

## Conventions

- New source files start with the copyright header used in `index.html`: `Copyright (c) 2026 Luke Bennie <lukebennie@gmail.com>. All rights reserved.`
- Git commits are authored as Luke Bennie <lukebennie@gmail.com>. That's set in this repo's git config.
- Controls must work on both desktop and touch. Desktop: drag to move, click to inspect, Ctrl (or ⌘) + drag to throw. Touch: drag to move, tap to inspect, pinch to zoom, touch and hold to throw.
- Keep `README.md` in step with the controls and features.
