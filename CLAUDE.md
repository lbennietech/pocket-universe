# Pocket Universe

A browser gravity sandbox by Luke Bennie: plain HTML, CSS and JavaScript on a 2D canvas, with no dependencies beyond Google Fonts and nothing to install. The source lives in `src/`, split by area (physics, collisions, rendering, input, ...), and `tools/build.py` (plain Python, no packages) joins it into the single self-contained `index.html` that's committed at the repo root and served as is (CODE-014, 2026-09-29). The one hard requirement is that the game stays playable at the GitHub Pages URL below. It's published at https://lbennietech.github.io/pocket-universe/ from the `main` branch. `docs/ARCHITECTURE.md` explains how the code is laid out and how a frame flows, and `docs/DEV_CYCLE.md` explains the audit and iterate workflow.

## Files

- `src/`: the game's source. Edit these. `shell.html` is the page (head and markup), `style.css` the styles, and the script is split into `units.js`, `state.js`, `helpers.js`, `bodies.js`, `physics.js` (gravity, integrator, block time steps, dust), `collisions.js` (merges, tidal shredding, supernovae), `cull.js`, `life.js`, `scenes.js`, `viewport.js`, `aiming.js`, `input.js`, `ui.js`, `render.js`, `loop.js`, `testhook.js` and `boot.js`. The script files share one scope (they're joined inside one function), so they're plain code, not modules. `docs/ARCHITECTURE.md` says what's in each. Cite code as `src/<file>:line` or by function name, never `index.html:line`.
- `index.html`: the built game, committed so GitHub Pages serves it. **Don't edit it**: it's generated from `src/` by `python tools/build.py`, and its line 2 is a stamp that catches hand edits. The tests, benchmarks, `tools/serve.py`, `tools/build_artifact.py` and the after-edit hook all rebuild it first when `src/` has changed, and stop with instructions if it was edited by hand. `python tools/build.py --where 1234` maps a line of `index.html` (from a stack trace, say) back to its `src/` file and line.
- `tools/build.py`: the build. `--check` fails if `index.html` isn't current with `src/`; `--check-ref HEAD` checks a commit. The order the script files run in is its `SCRIPTS` list: a new `src/` file must be added there, or the build fails.
- `tests/run_tests.py`: Playwright (Python) test runner. It plays the game in Chromium, Firefox and WebKit (Safari's engine) and on emulated phones, using scripted and real input, and runs the physics invariant tests. `--screens` also saves screenshots to `tests/output/` (gitignored), and `--quick` does a few-second load check. The checks themselves are `tests/harness.js` (in-page input checks) and `tests/invariants.js` (physics).
- `bench/run_bench.py`: performance benchmarks on seeded scenes. Each metric is the median of 5 runs interleaved across the scenes (3 for `long-run`). `--compare` is a same-session A/B: it times the upstream `index.html` (normally `origin/main`) and the working copy side by side, so drift between sessions cancels out. A `soak` run and `long-run` check heap growth. `bench/baseline.json` is the committed baseline (budgets and history), and `bench/results/latest.json` holds the latest run (gitignored).
- `tools/build_artifact.py`: rebuilds `pocket-universe.html`, the copy published as a private claude.ai artifact (https://claude.ai/artifact/QMJGjmuBKfrCHBa8WvXdK5). That file is ignored by git.
- `tools/serve.py`: serves the game at http://localhost:8765/ for the Playwright browser tool (MCP) that agents use. It starts the server if it isn't running and waits until it's ready.
- `.claude/agents/`: review and audit agents. `.claude/skills/`: `/audit` and `/iterate`. `.claude/hooks/` and `.claude/settings.json`: automatic checks. `.mcp.json`: the Playwright browser tool.
- `BACKLOG.md`: improvements found by audits, sorted by priority. Shipped items are in `BACKLOG_DONE.md`.

## Before every push

1. Run `python tests/run_tests.py`. Every check must pass.
2. Run `python bench/run_bench.py --compare` when the change could affect speed (about 6 minutes). The working copy must not be more than 5% slower than the upstream `index.html` timed in the same session.
3. Run `/code-review` on the changes and fix what it finds.
4. Have the **playtester** agent check the change.
5. If the change touches the simulation (gravity, collisions, sizes, masses, speed or time-stepping, dust, life rules or scenes), also have the **physics-reviewer** agent review it.
6. Run `python tools/build_artifact.py` and republish `pocket-universe.html` to the claude.ai artifact, so both copies match.

Commit `index.html` together with the `src/` change that produced it, and run the commit and the push as separate commands (the hook refuses both in one). A hook blocks `git commit` of this repository if the `index.html` being committed isn't current with the `src/` being committed, and blocks `git push` if any pushed commit's `index.html` isn't current with its `src/`, or if the tests or the benchmark comparison fail (see `.claude/hooks/`). Pushes of other repositories run from a session here, such as Coldstarter, aren't gated.

## Targets & design pillars

Every agent judges proposals and findings against these.

### Performance budgets

Measured by `bench/run_bench.py` in headless Chromium. The "phone" profile uses a real phone's screen (412×915 at 2.625× pixel density) and slows the CPU down 4×.

- **Everyday scene** (`medium`: 300 bodies plus 8,000 dust): 60 fps on a mid-range laptop (≤ 16.6 ms a frame on average, p95 ≤ 20 ms). On the phone profile, 30 fps (≤ 33 ms).
- **Stretch** (`large`: 1,000 bodies plus 4,000 dust): 60 fps on a laptop. It doesn't meet this yet; that's a backlog item, not a blocker.
- **No steady memory growth:** neither the `long-run` bench nor the `soak` (scene reloads, throws, supernovae, black holes) may grow the JS heap by more than 5 MB. Avoid new per-frame allocations in the physics and drawing hot paths.
- **Size:** the built `index.html` (what GitHub Pages serves, so what a player downloads) stays at or under 45 KB gzipped (34 KB when first set at 40 KB; raised to 45 KB on 2026-09-29 as an interim, because PERF-010 left ~0.03 KB of headroom and Luke's new requests, the vanishing-objects fix and the progression system, can't fit in that). Source headers in `src/` aren't shipped, so they don't count. If the game ever ships more than one file, the budget is their total. Lower the budget when it drops.

### Physics correctness

Checked by `tests/invariants.js`.

- **Deterministic:** the same seed and the same frames give an identical state.
- **Conservation:** energy drifts no more than 0.1% over 10,000 steps in a closed scene with no merges, and momentum no more than 1e-9 of its scale.
- **No NaN or Infinity,** even in stress scenes.
- **No tunnelling** at up to 450 km/s, the fastest a normal throw produces. Faster bodies can still pass through small stars; that's in the backlog.
- **Stable** across the whole speed-slider range.

### Design pillars

1. **Toys over goals.** A sandbox to play with, not levels to beat. New features add toys and scenes, not levels or gates.
   - **Progression that rewards play (Luke, 2026-09-29).** Luke wants a progression system as the game's core hook: tied to the physics, fed by the player's actions and performance in the gameplay loop, and genuinely compelling to come back to, with a save system so it persists. It rewards and deepens free sandbox play (unlocking toys, knowledge and effects), never gates the sandbox behind levels. `progression-designer` leads its design.
   - **The sandbox is the game; the pre-built scenes are a demo of it (Luke, 2026-09-28).** Empty space and free play, where a player builds their own organic scenario from the toys, is the heart of Pocket Universe. The named scenes (Cradle, Formation, Binary, Mayhem, ...) exist to show new players what the sandbox can do, not as the main content. When a change would improve one at the expense of the other, favour the free sandbox: e.g. a toy, a control or a piece of physics that makes player-built scenarios more capable or fun outweighs polish on a scripted scene, and any per-scene special-casing (like PERF-012's scene-dependent speed ceiling) is a bug to fix, not a feature to lean on.
2. **One click to chaos.** Something dramatic (collisions, supernovae, black holes) is always one action away.
3. **Readable at a glance.** Sizes, colours, trails, labels and the inspector make the physics understandable without reading a manual.
4. **Real-ish physics, works everywhere.** Real units and plausible behaviour, playable in the browser with no install, equally good on phone and desktop.

### Workflow

- **Audit:** `/audit` runs the benchmarks and invariant tests, sends six specialist agents over the whole game, and has `triage` update `BACKLOG.md`.
- **Iterate:** `/iterate` takes the next **batch** in `BACKLOG.md` (the one holding the top Ready item, or a batch or item you name) through the full pipeline once: implement, test, benchmark, review, playtest, commit, push and republish. `triage` groups Ready items into batches by category (`ui`, `tooling`, `sim`, `perf`, `solo`) and tier, so each batch gets the reviews it needs just once. See "Batches" in `docs/DEV_CYCLE.md`.
- **Autoiterate:** `/autoiterate` loops that same `/iterate` cycle batch after batch without waiting for Luke: intake of his new requests between batches, the full pipeline for each batch, and a stop only when the backlog is done, something needs his decision, or something is broken. Started as `/loop /autoiterate`, it also schedules its own wake-up at a session limit's reset and carries on. On any limit error, check the real clock (`date`) first: if the reset has passed, just resume.
- **Bench:** `python bench/run_bench.py` (run), `--compare` (same-session A/B against the upstream `index.html`, fails on a regression over 5%; it falls back to the baseline, with a warning, if the upstream can't run the current scenes), `--compare --against baseline` (against the stored baseline) and `--baseline` (record a new baseline, only when the numbers genuinely improved or the measuring method or scenarios changed). The baseline records its method and a hash of the scenario definitions, and comparing with it refuses a mismatch in either.
- **A/B experiments:** when a backlog item is a big architectural choice (for example a quadtree versus a uniform grid, Canvas2D versus WebGL, or physics on the main thread versus a Worker), create two git worktrees, one per approach. Implement both minimally, benchmark each, keep the winner, and record both results in the item's **Done** entry.
- **Unattended audits:** not set up. Luke chose not to run a nightly audit for now.

### Model & effort

- The session runs on Sonnet (the `sonnet` alias, now Sonnet 5.5) at **medium** effort, and compacts its context at 200K tokens; all three are set in `.claude/settings.json` (`model`, `effortLevel`, `autoCompactWindow`). Switch to Opus yourself for hard reasoning that isn't already covered by an implementer tier (see below) or by `physics-reviewer`/`perf-profiler`.
- Use `/effort high` for hard reasoning (integrator changes, collision edge cases, determinism bugs, spatial-structure rewrites, threading or architecture changes), then return to medium.
- Avoid xhigh and max: they're rarely worth it here and burn Pro usage limits fast.
- Each agent's frontmatter sets its own model, effort and `maxTurns` (a runaway guard set well above normal runs; if an agent hits it, resume it with SendMessage). The three implementers and `perf-profiler` also keep a one-hour prompt cache (`experimental: cacheTtl: 1h`), because they sit idle for longer than the default five minutes (benchmarks, and waiting for reviews before a fix round), and each expiry re-caches their whole context. Don't change these without a reason. If an agent misses things or wastes usage, adjust one level at a time.
- Opus is kept where it does the job in fewer turns and fewer fix rounds, and the rest run on Sonnet:
  - Opus at high: `implementer-deep`, used by `/iterate` for the integrator, time-stepping, collisions and merges, determinism, spatial structures, Workers or threading, and A/B experiments; and `progression-designer` (added 2026-09-29; designs progression, rewards and saves, the game's core hook, so Luke allowed high effort for it).
  - Opus at medium: `physics-reviewer`, `perf-profiler`, `implementer-opus`. The reviewers name `model: opus` explicitly rather than `inherit`, so they stay on Opus even when the session runs on a cheaper model. `implementer-opus` is used by `/iterate` for physics or perf area items, anything at effort 2 or more, and changes to the safety gates' logic (hooks, the build, the test runner's pass/fail logic).
  - Sonnet at medium: `ux-reviewer`, `game-designer`, `implementer`, `triage`, `docs-writer` (added 2026-09-29: writes the player guide, simulation reference, operations notes and threat model, and checks docs against the code in `/audit`; edits docs only). `implementer` is used by `/iterate` for everything else (ux, design, efficiency, code or docs items at effort 1). `triage` was raised from low on 2026-09-28: at low, its first batch grouping broke its own rules (it mixed tiers in one batch and left effort-3 items out of `solo`).
  - Sonnet at low: `efficiency-auditor`, `playtester`, `code-quality-reviewer` (lowered 2026-09-29: audit-only, and `triage` discards its findings without evidence anyway).
- `/iterate` runs one batch at a time on that batch's implementer tier. `triage` never mixes tiers in a batch. Luke can override the tier, for example "/iterate B3 on Opus", or run one item alone ("/iterate UX-104 solo"). Deep-tier items already get Opus at high effort during implementation, so they don't also need a separate high-effort physics pass from the main session. `/iterate` always names the `/code-review` level: `low` for `ui`, `docs` and `tooling`, `medium` for `sim`, `perf`, `solo` and safety-gate changes, `high` only for Deep items or when Luke asks.
- **Usage review (2026-09-29).** Luke is on a Pro plan and was hitting the session limit a couple of hours in, so the transcripts of every session and agent run so far were priced by model (API list prices as a proxy for plan usage). The findings behind the settings above:
  - The main session was about 47% of all usage. One session ran for a day and a half without compacting and grew to about 740K tokens, and every turn re-reads the whole context. Hence the 200K compaction window, and the "Keeping this session lean" rules in `/iterate`.
  - The one A/B experiment (PERF-010, two `implementer-deep` arms) was about 21%, mostly from re-caching its context after idle gaps. Hence the one-hour cache, one benchmark per arm, and `/autoiterate` asking Luke before starting a Deep or A/B batch.
  - Two `/code-review high` runs were about 7%; a `medium` review costs a fraction of that. Hence the named levels.
  - Opus 5.5 costs twice Sonnet per new token but the same per cached token, which is most of the bill, and Opus reviews and implementers finished in fewer turns. So moving agents from Opus to Sonnet saves little. Cutting effort was tried on 2026-09-28/29 and reverted: fix rounds after a weaker first pass cost more than the saving. The levers that matter are context size, idle cache expiry, duplicated work (reviewers re-running the whole suite) and fan-out.
  - `playtester` no longer re-runs the whole test suite (`/iterate` runs it once with `--screens` and passes the result), and it plays the batch's changes rather than all three personas every time. `/audit` doesn't send it separately; `ux-reviewer` covers the personas there.
  - Shipped items moved from `BACKLOG.md` to `BACKLOG_DONE.md`, since everything that reads the backlog paid for the whole history.
- Run `/audit` rarely, since it's the most expensive command. Work the existing backlog down with `/iterate` first; a focused audit ("/audit perf") sends only the agents that cover the focus.

### Documentation

Every change that alters behaviour updates the doc that describes it in the same commit: `docs/PLAYER_GUIDE.md` (players: controls, tools, inspector, speed, notices, progression), `docs/SIMULATION.md` (the physics and life rules), `docs/ARCHITECTURE.md` (code layout and frame flow), `docs/OPERATIONS.md` (build, deploy, verify, roll back), `docs/THREAT_MODEL.md` (entry points such as URLs and `localStorage`), `README.md` (the short version). Docs that don't exist yet are backlog items DOC-001..004. `docs-writer` writes them and checks them all in `/audit`.

## Conventions

- New source files start with the copyright header used in `index.html`: `Copyright (c) 2026 Luke Bennie <lukebennie@gmail.com>. All rights reserved.` In `src/`, that header (the comment lines up to the first blank line, saying what the file holds) is required by `tools/build.py` and isn't shipped.
- Git commits are authored as Luke Bennie <lukebennie@gmail.com>. That's set in this repo's git config.
- Controls must work on both desktop and touch. Desktop: drag to move, click to inspect, Ctrl (or ⌘) + drag to throw. Touch: drag to move, tap to inspect, pinch to zoom, touch and hold to throw.
- Keep `README.md` in step with the controls and features.
- Everything that shapes the simulation uses `rand()`, never `Math.random()`, so seeded runs stay repeatable.
