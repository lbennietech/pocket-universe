> **Archived. Historical record, not instructions.** Completed 2026-09-27. Several decisions differ from this plan (Playwright for Python instead of Node/npm, a 1,000-body stretch target instead of 5,000, a push-only test gate, no nightly audit). The current targets and workflow are in `CLAUDE.md`, and the decisions and what was built are in `docs/IMPROVEMENT_PROGRESS.md`. Don't implement this file.

# Improvement Loop Implementation Plan

> **For Claude Code:** This file is a work order. Read it fully, then implement it phase by phase in this project. Before each phase, inspect the existing repo and adapt to what's actually there (language, build tool, test runner, rendering approach, existing `.claude/` config). Do not overwrite existing agents, skills, hooks or CLAUDE.md content. Extend and merge. Commit at the end of each phase with a clear message. If something in this plan conflicts with the project's architecture, or a decision can't be inferred from the code, stop and ask rather than guessing. Check the current Claude Code docs (code.claude.com/docs/en) for the exact file formats of agents, skills, hooks and settings before writing them.  
>   
> **Model & effort:** this plan sets `model` and `effort` per agent (see Phase 5). Confirm the exact frontmatter field names in the current subagent and skill docs, and check that `claude --version` is 2.1.280 or newer. Effort levels for Opus 5.5 are low, medium (default), high, xhigh and max.

## Context

This is a browser-based 2D universe physics sandbox. There is already a per-change loop:

1. Run the tests  
2. Run `/code-review`  
3. The **playtester** agent checks the change, plus the **physics reviewer** agent if the simulation changed  
4. Fix anything important, then push and update the claude.ai copy

This plan adds three things:

- a way to **find** improvements across the whole game (not just review changes)  
- **hard numbers** for perf and physics correctness so "better" is measurable  
- **deterministic enforcement** via hooks

Facets in scope: UI/UX, gameplay, performance, code quality, and resource efficiency.

---

## Phase 0 — Survey (no code changes)

1. Map the project: entry points, game loop, physics step, renderer, input, UI, assets, build and test setup.  
2. List what already exists in `.claude/` (agents, skills, hooks, settings) and in `CLAUDE.md`.  
3. Write a short summary to `docs/ARCHITECTURE.md` (create or update). Cover the module layout, how a frame flows (input → physics → render), where hot paths likely are, and the test and build commands.  
4. Report back to the user with the summary plus any decisions you need from them before continuing.

---

## Phase 1 — CLAUDE.md targets

Add a section to `CLAUDE.md` so every agent judges against the same standard. Propose sensible defaults based on Phase 0 and ask the user to confirm them.

\#\# Targets & design pillars

\#\#\# Performance budgets

\- 60 fps (≤16.6 ms/frame) at 5,000 bodies on a mid-range laptop

\- Physics step ≤ 8 ms at 5,000 bodies

\- No per-frame heap allocations in the hot loop (GC pauses \< 2 ms)

\- Production bundle ≤ \<X\> KB gzipped (set from current size, then ratchet down)

\#\#\# Physics correctness

\- Deterministic: same seed \+ same inputs ⇒ identical state

\- Energy/momentum drift within tolerance over 10k steps (see invariant tests)

\- No NaN/Infinity, no tunnelling at max supported velocity

\#\#\# Design pillars

\- (Fill in with user, e.g. "toys over goals", "one click to chaos", "readable at a glance")

\#\#\# Workflow

\- Audit: \`/audit\` → BACKLOG.md

\- Iterate: \`/iterate\` → implements top backlog item through the full pipeline

\- Bench: \`\<bench command\>\`; baseline at \`bench/baseline.json\`

\#\#\# Model & effort

\- Session default: Opus 5.5 at \*\*medium\*\* effort

\- Use \`/effort high\` for hard reasoning tasks (integrator changes, collision edge cases, determinism bugs, spatial-structure rewrites, threading/architecture changes), then return to medium

\- Avoid xhigh/max: rarely worth it here, and they burn Pro usage limits fast

\- Per-agent model/effort is set in each agent's frontmatter; don't change it without a reason

---

## Phase 2 — Benchmarks (`bench/`)

Build a headless benchmark harness.

1. **Seeded scenes**, defined as data. Scenes must be reproducible from a seed. Suggested set:  
   - `small`: 500 bodies  
   - `medium`: 5,000 bodies  
   - `large`: 20,000 bodies  
   - `collision-pileup`: dense cluster, heavy collision load  
   - `long-run`: 1,000 bodies for 10k+ steps (stability and memory growth)  
2. **Metrics per scene:** mean, p95 and max ms/frame, physics step time, render time (if measurable headless), heap used at start and end, GC pause count and duration if available.  
3. **Runner:** use Playwright (or Puppeteer if already present) to load the real build in headless Chromium and collect metrics via `performance.now()` instrumentation and CDP where useful. Where the physics can be run in Node without the DOM, also add a pure-physics bench for speed.  
4. **Output:** write JSON results to `bench/results/latest.json`.  
5. **Compare:** add a script that diffs `latest.json` against `bench/baseline.json` and exits non-zero if any key metric regresses by more than **5%** (make the threshold configurable). Print a readable table.  
6. **Baseline:** run it once and commit `bench/baseline.json`.  
7. Add npm scripts (or the project equivalent): `bench`, `bench:compare`, `bench:baseline`.

Instrument the game loop with lightweight timing hooks if they don't exist. They must be zero or near-zero cost when disabled.

---

## Phase 3 — Physics invariant tests

Add tests alongside the existing suite. Tolerances should be tuned to the integrator in use; document the chosen values in the tests.

- **Determinism:** run the same seeded scene twice for N steps and assert the states are bit-identical (or identical within float epsilon if full determinism isn't achievable; flag that to the user).  
- **Energy drift:** total energy after 10k steps is within tolerance of the start, for a closed system.  
- **Momentum conservation:** total linear (and angular, if applicable) momentum stays within tolerance.  
- **Numerical sanity:** no NaN/Infinity in any body state after stress scenes.  
- **Tunnelling:** a fast body vs a thin or small body at max supported velocity must collide.  
- **Timestep stability:** the simulation stays stable across the supported range of timesteps.

---

## Phase 4 — Browser access for agents

1. Add the **Playwright MCP** server to the project's MCP config (check the current setup method in the Claude Code docs), or Chrome DevTools MCP if preferred.  
2. Add a helper script that starts the dev server and waits until it's ready, so agents can load the game reliably.  
3. Update the existing **playtester** agent (merge, don't replace) so that it:  
   - actually loads the game in the browser, interacts with it, and takes screenshots  
   - checks the console for errors and warnings  
   - tests at desktop and mobile viewport sizes  
   - runs with `model: sonnet` and `effort: low` in its frontmatter (its job is mostly clicking, screenshotting and reporting, which doesn't need deep reasoning, and this keeps usage down on a Pro plan)  
   - plays through three personas: **new player** (first 60 seconds, is it obvious what to do?), **builder** (sets up complex systems, are the tools sufficient?), and **breaker** (tries to crash it, spam inputs, or extreme values)

---

## Phase 5 — Specialist audit agents

Create these in `.claude/agents/`. All of them are **read-only** (restrict tools to reading, searching, running bench and tests, and browser access; no edit or write tools). Every finding must include **evidence**: a screenshot path, a metric, or `file:line`. Findings without evidence get discarded at triage.

Each agent outputs findings in this format:

\#\#\# \[AREA-\#\#\#\] Short title

\- \*\*Area:\*\* perf | physics | ux | design | efficiency | code

\- \*\*Evidence:\*\* \<metric / screenshot path / file:line\>

\- \*\*Impact:\*\* 1–5   \*\*Dev effort:\*\* 1–5

\- \*\*Proposal:\*\* what to change and why

### Model & effort per agent

Set these in each agent's frontmatter. Agents that need to reason about numerical or algorithmic subtleties get high effort; agents that mostly observe, sort or rank get low effort on Sonnet to conserve Pro plan usage.

| Agent | model | effort | Why |
| :---- | :---- | :---- | :---- |
| `physics-reviewer` (existing) | inherit (Opus 5.5) | high | Numerical stability, conservation, determinism |
| `perf-profiler` | inherit (Opus 5.5) | high | Algorithmic complexity, memory layout, threading |
| `code-quality-reviewer` | inherit (Opus 5.5) | medium | Broad but mostly structural judgement |
| `ux-reviewer` | inherit (Opus 5.5) | medium | Visual/interaction judgement from screenshots |
| `game-designer` | inherit (Opus 5.5) | medium | Creative proposals; higher effort adds little |
| `efficiency-auditor` | inherit (Opus 5.5) | medium | Mostly measurement plus interpretation |
| `playtester` (existing) | sonnet | low | Clicking, screenshots, console checks |
| `triage` | sonnet | low | Dedupe, score and sort |

Example frontmatter:

\---

name: physics-reviewer

description: Reviews simulation code and results for numerical correctness, conservation and determinism. Read-only.

model: inherit

effort: high

tools: Read, Grep, Glob, Bash

\---

For existing agents, add or adjust only the `model` and `effort` lines; leave the rest as it is. If the user later finds an agent missing things or wasting usage, adjust one level at a time.

### `perf-profiler`

Runs the bench and inspects hot paths. Looks for:

- O(n²) loops, especially in n-body or collision code (candidates: Barnes-Hut, spatial hashing or uniform grid, quadtree)  
- allocations inside the frame loop (objects, arrays, closures, vectors), where pooling or reuse applies  
- array-of-objects layouts that would be faster as typed-array structure-of-arrays  
- missing fixed timestep with render interpolation  
- main-thread work that could move to a Web Worker or OffscreenCanvas  
- rendering overhead: draw calls, state changes, overdraw, Canvas2D vs WebGL suitability

### `ux-reviewer`

Works from screenshots at multiple viewports. Checks discoverability, control clarity, feedback on actions, visual hierarchy, readability of the simulation, onboarding, touch support, keyboard access, colour contrast, and reduced-motion handling.

### `game-designer`

Evaluates the fun factor and the pillars in CLAUDE.md: first 60 seconds, "aha" moments, missing toys or tools, presets or scenarios, sharing and saving, and emergent-play opportunities. Proposals should be concrete and small enough to ship one at a time.

### `efficiency-auditor`

Covers bundle size and composition, dead code, unused or heavy dependencies, asset formats and compression, lazy loading, caching headers where relevant, and memory growth over long sessions (use the `long-run` bench).

### `code-quality-reviewer`

Whole-codebase (not diff) review: architecture smells, module coupling, duplication, type safety, error handling, test coverage gaps in critical paths, and naming and consistency.

(The existing **physics-reviewer** also takes part in audits. Extend it, if needed, to use the invariant tests and bench output as evidence.)

### `triage`

Takes all findings and:

1. discards anything without evidence  
2. merges duplicates  
3. scores priority \= impact ÷ dev effort (break ties by risk)  
4. writes and updates `BACKLOG.md`, sorted by priority, preserving the status of existing items

---

## Phase 6 — BACKLOG.md

Create `BACKLOG.md` at the repo root:

\# Backlog

\_Last audit: \<date\>\_

\#\# Ready (sorted by priority)

| ID | Area | Title | Impact | Effort | Evidence |

|----|------|-------|--------|--------|----------|

\#\# In progress

\#\# Done

| ID | Title | Result (metric delta / notes) | Commit |

|----|-------|-------------------------------|--------|

\#\# Rejected / won't do

| ID | Title | Reason |

|----|-------|--------|

---

## Phase 7 — Skills

Create two skills in `.claude/skills/`.

### `audit`

1. Ensure the dev server is running and the build is current  
2. Run the bench and the invariant tests (capture results as evidence)  
3. Dispatch `perf-profiler`, `physics-reviewer`, `ux-reviewer`, `game-designer`, `efficiency-auditor` and `code-quality-reviewer` (in parallel where possible)  
4. Pass all findings to `triage` and update `BACKLOG.md`  
5. Summarise the top 5 items for the user

### `iterate`

1. Take the top **Ready** item from `BACKLOG.md` (or one the user names) and move it to **In progress**  
2. Implement it in the smallest reasonable change  
3. Run the tests, including the invariant tests  
4. Run `bench:compare`. On regression over the threshold, fix it or abandon the change and record why  
5. Run `/code-review`  
6. Run `playtester` (always) and `physics-reviewer` (if the simulation code changed)  
7. Pass their findings to `triage`: fix blockers now and send the rest to the backlog  
8. If the metrics improved, update `bench/baseline.json`  
9. Move the item to **Done** with its metric delta, commit, push, and update the claude.ai copy (follow the existing process for this)

Keep the existing loop's behaviour intact; `iterate` wraps and extends it.

**Effort on skills:** don't set `effort` in either skill's frontmatter. A skill-level effort overrides the session level, and the user needs `/effort high` to take effect when an `iterate` item is a hard one. The agents each skill dispatches still use their own frontmatter settings.

---

## Phase 8 — Hooks (deterministic enforcement)

Configure in `.claude/settings.json` (merge with existing settings; confirm the schema in the docs):

- **After file edits (PostToolUse on edit/write tools):** run lint, typecheck and fast unit tests on affected files. Keep this fast, under \~10 s.  
- **Before push / at task end:** run the full test suite and `bench:compare`, and block if either fails.  
- Optionally, block edits to `bench/baseline.json` except through the `bench:baseline` script.

Put hook logic in scripts under `.claude/hooks/` rather than inline, so it's readable and testable.

---

## Phase 9 — Worktree A/B experiments (convention only)

Document this in CLAUDE.md under Workflow. When a backlog item is a large architectural choice (e.g. quadtree vs uniform grid, Canvas2D vs WebGL, main thread vs Worker physics):

1. Create two git worktrees, one per approach  
2. Implement both minimally  
3. Run the bench in each and compare  
4. Keep the winner and record both results in the BACKLOG "Done" entry

---

## Phase 10 — Unattended audits (optional, ask user first)

Provide a script, `scripts/nightly-audit.sh`, that runs Claude Code headless (`claude -p` with the audit skill) and commits the updated `BACKLOG.md` to a branch. Include example cron and GitHub Actions snippets in a comment at the top of the script, but don't enable either without the user's go-ahead.

---

## Definition of done

- [ ] `docs/ARCHITECTURE.md` exists and is accurate  
- [ ] CLAUDE.md has targets, pillars and the workflow section (confirmed by user)  
- [ ] `bench` / `bench:compare` / `bench:baseline` work, and the baseline is committed  
- [ ] Invariant tests pass (or failures are documented as backlog items)  
- [ ] Playwright (or DevTools) MCP is configured; playtester uses it with personas  
- [ ] Six audit agents plus triage exist and are read-only  
- [ ] Every agent has `model` and `effort` set per the Phase 5 table; CLAUDE.md has the Model & effort section  
- [ ] `BACKLOG.md` exists  
- [ ] `audit` and `iterate` skills work end-to-end  
- [ ] Hooks enforce tests and the bench regression gate  
- [ ] First `/audit` run completed and top 5 items reported to the user