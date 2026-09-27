# Pocket Universe

A browser gravity sandbox by Luke Bennie. Everything in the game lives in `index.html`: plain HTML, CSS and JavaScript on a 2D canvas, with no build step and no dependencies beyond Google Fonts. It's published at https://lbennietech.github.io/pocket-universe/ from the `main` branch. `docs/ARCHITECTURE.md` explains how the code is laid out and how a frame flows, and `docs/DEV_CYCLE.md` explains the audit and iterate workflow.

## Files

- `index.html`: the game. Edit this one.
- `tests/run_tests.py`: Playwright (Python) test runner. It plays the game in Chromium, Firefox and WebKit (Safari's engine) and on emulated phones, using scripted and real input, and runs the physics invariant tests. `--screens` also saves screenshots to `tests/output/` (gitignored), and `--quick` does a few-second load check. The checks themselves are `tests/harness.js` (in-page input checks) and `tests/invariants.js` (physics).
- `bench/run_bench.py`: performance benchmarks on seeded scenes. `bench/baseline.json` is the committed baseline, and `bench/results/latest.json` holds the latest run (gitignored).
- `tools/build_artifact.py`: rebuilds `pocket-universe.html`, the copy published as a private claude.ai artifact (https://claude.ai/artifact/QMJGjmuBKfrCHBa8WvXdK5). That file is ignored by git.
- `tools/serve.py`: serves the game at http://localhost:8765/ for the Playwright browser tool (MCP) that agents use. It starts the server if it isn't running and waits until it's ready.
- `.claude/agents/`: review and audit agents. `.claude/skills/`: `/audit` and `/iterate`. `.claude/hooks/` and `.claude/settings.json`: automatic checks. `.mcp.json`: the Playwright browser tool.
- `BACKLOG.md`: improvements found by audits, sorted by priority.

## Before every push

1. Run `python tests/run_tests.py`. Every check must pass.
2. Run `python bench/run_bench.py --compare` when the change could affect speed. It must not regress by more than 5%.
3. Run `/code-review` on the changes and fix what it finds.
4. Have the **playtester** agent check the change.
5. If the change touches the simulation (gravity, collisions, sizes, masses, speed or time-stepping, dust, life rules or scenes), also have the **physics-reviewer** agent review it.
6. Run `python tools/build_artifact.py` and republish `pocket-universe.html` to the claude.ai artifact, so both copies match.

A hook blocks `git push` if the tests or the benchmark comparison fail (see `.claude/hooks/`).

## Targets & design pillars

Every agent judges proposals and findings against these.

### Performance budgets

Measured by `bench/run_bench.py` in headless Chromium. The "phone" profile slows the CPU down 4×.

- **Everyday scene** (`medium`: 300 bodies plus 8,000 dust): 60 fps on a mid-range laptop (≤ 16.6 ms a frame on average, p95 ≤ 20 ms). On the phone profile, 30 fps (≤ 33 ms).
- **Stretch** (`large`: 1,000 bodies plus 4,000 dust): 60 fps on a laptop. It doesn't meet this yet; that's a backlog item, not a blocker.
- **No steady memory growth:** the `long-run` bench may not grow the JS heap by more than 5 MB. Avoid new per-frame allocations in the physics and drawing hot paths.
- **Size:** `index.html` stays at or under 40 KB gzipped (34 KB when this was set). Lower the budget when it drops.

### Physics correctness

Checked by `tests/invariants.js`.

- **Deterministic:** the same seed and the same frames give an identical state.
- **Conservation:** energy drifts no more than 0.1% over 10,000 steps in a closed scene with no merges, and momentum no more than 1e-9 of its scale.
- **No NaN or Infinity,** even in stress scenes.
- **No tunnelling** at up to 450 km/s, the fastest a normal throw produces. Faster bodies can still pass through small stars; that's in the backlog.
- **Stable** across the whole speed-slider range.

### Design pillars

1. **Toys over goals.** A sandbox to play with, not levels to beat. New features add toys and scenes, not scores or objectives.
2. **One click to chaos.** Something dramatic (collisions, supernovae, black holes) is always one action away.
3. **Readable at a glance.** Sizes, colours, trails, labels and the inspector make the physics understandable without reading a manual.
4. **Real-ish physics, works everywhere.** Real units and plausible behaviour, in one file with no install, equally good on phone and desktop.

### Workflow

- **Audit:** `/audit` runs the benchmarks and invariant tests, sends six specialist agents over the whole game, and has `triage` update `BACKLOG.md`.
- **Iterate:** `/iterate` takes the next **batch** in `BACKLOG.md` (the one holding the top Ready item, or a batch or item you name) through the full pipeline once: implement, test, benchmark, review, playtest, commit, push and republish. `triage` groups Ready items into batches by category (`ui`, `tooling`, `sim`, `perf`, `solo`) and tier, so each batch gets the reviews it needs just once. See "Batches" in `docs/DEV_CYCLE.md`.
- **Bench:** `python bench/run_bench.py` (run), `--compare` (against the baseline, fails on a regression over 5%) and `--baseline` (record a new baseline, and only when the numbers genuinely improved).
- **A/B experiments:** when a backlog item is a big architectural choice (for example a quadtree versus a uniform grid, Canvas2D versus WebGL, or physics on the main thread versus a Worker), create two git worktrees, one per approach. Implement both minimally, benchmark each, keep the winner, and record both results in the item's **Done** entry.
- **Unattended audits:** not set up. Luke chose not to run a nightly audit for now.

### Model & effort

- The session default is Sonnet 5 at **medium** effort, set in `.claude/settings.json`. Switch to Opus yourself for hard reasoning that isn't already covered by an implementer tier (see below) or by `physics-reviewer`/`perf-profiler`.
- Use `/effort high` for hard reasoning (integrator changes, collision edge cases, determinism bugs, spatial-structure rewrites, threading or architecture changes), then return to medium.
- Avoid xhigh and max: they're rarely worth it here and burn Pro usage limits fast.
- Each agent's frontmatter sets its own model and effort. Don't change them without a reason. If an agent misses things or wastes usage, adjust one level at a time.
- Opus is kept for the agents whose work needs deep reasoning, and the rest run on Sonnet to save usage (set 2026-09-27, implementer tiers added 2026-09-27):
  - Opus at high: `implementer-deep`. Used by `/iterate` for the integrator, time-stepping, collisions and merges, determinism, spatial structures, Workers or threading, and A/B experiments.
  - Opus at medium: `physics-reviewer`, `perf-profiler`, `implementer-opus`. The reviewers name `model: opus` explicitly rather than `inherit`, so they stay on Opus even when the session runs on a cheaper model. `implementer-opus` is used by `/iterate` for physics or perf area items, or anything at effort 2 or more.
  - Sonnet at medium: `code-quality-reviewer`, `ux-reviewer`, `game-designer`, `implementer`, `triage`. `implementer` is used by `/iterate` for everything else (ux, design, efficiency or code items at effort 1). `triage` was raised from low on 2026-09-28: at low, its first batch grouping broke its own rules (it mixed tiers in one batch and left effort-3 items out of `solo`).
  - Sonnet at low: `efficiency-auditor`, `playtester`.
- `/iterate` runs one batch at a time on that batch's implementer tier. `triage` never mixes tiers in a batch. Luke can override the tier, for example "/iterate B3 on Opus", or run one item alone ("/iterate UX-104 solo"). Deep-tier items already get Opus at high effort during implementation, so they don't also need a separate high-effort physics pass from the main session.
- Run `/audit` rarely, since it's the most expensive command. Work the existing backlog down with `/iterate` first.

## Conventions

- New source files start with the copyright header used in `index.html`: `Copyright (c) 2026 Luke Bennie <lukebennie@gmail.com>. All rights reserved.`
- Git commits are authored as Luke Bennie <lukebennie@gmail.com>. That's set in this repo's git config.
- Controls must work on both desktop and touch. Desktop: drag to move, click to inspect, Ctrl (or ⌘) + drag to throw. Touch: drag to move, tap to inspect, pinch to zoom, touch and hold to throw.
- Keep `README.md` in step with the controls and features.
- Everything that shapes the simulation uses `rand()`, never `Math.random()`, so seeded runs stay repeatable.
