# Pocket Universe: dev cycle

Copyright (c) 2026 Luke Bennie <lukebennie@gmail.com>. All rights reserved.

This guide covers how work flows from "what should we improve?" to a change that's live on GitHub Pages and the claude.ai artifact. There are two loops:

- `/audit` fills the backlog.
- `/iterate` works through it one **batch** at a time: a group of Ready items that can safely ship together with a single test, review and push cycle.

The full steps are in `.claude/skills/audit/SKILL.md` and `.claude/skills/iterate/SKILL.md`, and the grouping rules are in `.claude/agents/triage.md`. This guide is the overview.

## Quick reference

| Command | What it does |
|---|---|
| `/iterate` | Ship the next batch (`B1`, which holds the top Ready item) |
| `/iterate B3` | Ship a named batch |
| `/iterate UX-104` | Ship whichever batch that item is in |
| `/iterate UX-104 solo` | Ship just that one item |
| `/iterate B2 without UX-104` | Ship a batch minus some items |
| `/iterate B3 on Opus` | Ship a batch on a higher implementer tier |
| `/audit` | Full review of the game by seven specialist agents, then triage into the backlog. The most expensive command, so run it rarely. |
| "show the backlog" / "show the batches" | Claude lists the Ready items or batches with their Tier and Est. time |
| `python tests/run_tests.py` | All checks: three browsers, emulated phones, physics invariants. `--quick` for a load check, `--screens` to save screenshots to `tests/output/`. |
| `python bench/run_bench.py` | Benchmarks, about 3 minutes (`--compare` about 6). Each metric is the median of 5 runs interleaved across the scenes (3 for `long-run`), plus a memory `soak`. `--compare` is a same-session A/B of the upstream `index.html` against the working copy (`--ref` picks another git ref or file); `--against baseline` compares with `bench/baseline.json` instead, and `--baseline` records a new one (only after a genuine improvement, or when the method or scenarios change). `--quick` is a fast single run, not comparable with the baseline. |
| `python tools/build.py` | Rebuilds `index.html` from `src/`. The tests, benchmarks, `serve.py`, `build_artifact.py` and the after-edit hook already do this for you. `--check` fails if `index.html` isn't current, `--check-staged` checks what `git commit` would commit (the commit hook uses this), `--check-ref <ref>` checks a commit (the push hook runs it on every ref it pushes), and `--where <line>` maps an `index.html` line to its `src/` file and line. |
| `python tools/serve.py` | Serves the game at http://localhost:8765/ for the Playwright browser tool, rebuilding `index.html` from `src/` on each page load if `src/` changed. |
| `python tools/build_artifact.py` | Rebuilds `pocket-universe.html` for the claude.ai artifact, from a freshly built `index.html` (it skips the rebuild if `index.html` hasn't changed). |
| `/effort high` | For hard reasoning in the main session. Return to medium afterwards. |

## The backlog

`BACKLOG.md` has four working sections: **Batches**, **Ready**, **In progress** and **Rejected**. Shipped items are in **Done** in `BACKLOG_DONE.md`, kept separate since 2026-09-29 so that everything reading the backlog doesn't pay for the whole history.

Each Ready item has:

- an ID (such as `PERF-002`) and an area
- impact and effort scores from 1 to 5
- a priority (impact ÷ effort)
- its **Batch**
- its **Tier**
- an **Est. time**
- evidence: a metric, a screenshot or a `file:line`

The Ready table is sorted by priority, so the top row is the best value for the effort.

To see it, open `BACKLOG.md` (VS Code and GitHub render the tables), ask Claude, or print the Ready rows from the terminal (prefix with `!` in a Claude Code session to spend no model tokens):

```
python -c "s=open('BACKLOG.md',encoding='utf-8').read().split('## Ready')[1].split('## In progress')[0]; [print(' | '.join(c.strip() for c in l.split('|')[1:11])) for l in s.splitlines() if l.startswith('| ') and not l.startswith('| ID')]"
```

### Tier

The Tier is the implementer agent that takes the item. It follows the rule in "Model & effort" in `CLAUDE.md`:

- **Deep** (`implementer-deep`, Opus at high effort): the integrator, time-stepping, collisions and merges, determinism, spatial structures, Workers or threading, and A/B experiments.
- **Opus** (`implementer-opus`, Opus at medium effort): a physics or perf area item, anything at effort 2 or more, or a change to the safety gates' logic (hooks, the build, the test runner's pass/fail logic).
- **Light** (`implementer`, Sonnet at medium effort): everything else (ux, design, efficiency, code or docs at effort 1).

### Est. time and Actual time

**Est. time** is a rough figure for the whole pipeline (implement, test, review, ship), not just the coding. Typical ranges:

- Light effort-1: 10-20 min
- Opus effort-1: 15-25 min
- Opus effort-2: 20-35 min
- Effort-3 or Deep: 35-90+ min

These are planning estimates, not measurements.

Done rows record the **Tier** and an **Actual time**. That's a rough wall-clock figure for the whole run, including fix rounds and benchmark troubleshooting. A batch's Actual time is recorded once, on its first item, and the other items in the batch point to it.

## Batches

`triage` regroups every Ready item into batches each time it touches the backlog, and writes the **Batches** table at the top of `BACKLOG.md`. `B1` always holds the top Ready item, so a plain `/iterate` still follows priority order and brings along everything that can safely ship with it.

Each batch has one **category** and one **tier**. The category decides which reviews the batch gets. They run once for the whole batch.

| Category | What goes in it | Reviews | Max size |
|---|---|---|---|
| `ui` | CSS, layout, text, blurbs, UI affordances. No simulation change. | code-review + playtester | 15 (about 5 if the items are effort-2 features) |
| `tooling` | Only `tests/`, `bench/` or `tools/`. The game doesn't change. | code-review only. No playtest or republish. | 15 |
| `sim` | Gravity, collisions, sizes, masses, time-stepping, dust, life rules, or a scene's `build()`/`rate` | code-review + playtester + one physics-reviewer | 5 |
| `perf` | Speed work that isn't Deep tier | code-review + playtester + benchmark focus (+ physics-reviewer if the simulation changes) | 5 |
| `solo` | Deep tier, A/B experiments, effort 3, or anything that would conflict | That item's own full pipeline | 1 |

**Grouping rules:**

- A batch never mixes tiers, so Light items never pay for Opus.
- Items that edit the same function stay apart.
- Dependencies are respected: an item that builds on another comes after it.

**Why the size limits:**

- Bigger batches make it harder to tell which change broke a test or the benchmark.
- Reviewers spread their attention thinner across a bigger diff.
- Pulling one bad item out of a batch gets riskier as it grows.

Simulation changes interact through shared physics, so `sim` and `perf` stay small. Small `ui` and `tooling` fixes rarely interact: the first 14-item batch shipped cleanly, which is why their cap was raised from 10 to 15 on 2026-09-28.

**Batch estimates** aren't the sum of their items. Take the largest item's estimate, then add about 2-3 min per extra `ui`/`tooling` item, or about 5 min per extra `sim`/`perf` item. The first batch (14 `ui`/`tooling` items on 2026-09-28) took about 35 min, against an estimated 175-245 min run one item at a time.

**Why there's no dedicated batching agent:** `triage` already rewrites the backlog after every audit and iteration, so grouping costs almost nothing extra, while a separate planner would add a model call to every run. `triage` runs at medium effort with a self-check. At low effort its first grouping broke its own rules.

## `/iterate`: ship a batch

1. **Pick.** Choose the batch: `B1` by default, or the batch or item you name.
   - Claude says which batch it is, its category, tier, items, reviews and Est. time, then moves the items to In progress.
   - If the Batches table is stale, `triage` regroups first.
2. **Implement.** One implementer agent (the batch's tier) takes the whole batch and works through the items one at a time as isolated edits.
   - For each item it makes the smallest change that delivers it, in the matching `src/` files (never in the built `index.html`), and adds a check in `tests/harness.js` or `tests/invariants.js` for new behaviour.
   - It reads only the `src/` files the item touches (`docs/ARCHITECTURE.md` says which file holds what) and cites code as `src/<file>:line` or by function name.
   - It runs the tests once at the end.
   - Two agents never share a working tree.
   - An item that turns out riskier than its category suggests is skipped and goes back to Ready.
3. **Test.** `python tests/run_tests.py --screens` must pass everywhere (the screenshots it saves are what the playtester looks at, and the pass count goes into every reviewer's brief so nobody re-runs the suite), and `python bench/run_bench.py --compare` must not regress by more than 5%.
   - `--compare` already times the upstream `index.html` and the working copy in the same session, so machine drift cancels out. If it warns that it fell back to the stored baseline, a failure may still be drift.
4. **Review.** Run the batch's reviews once (see the table above), briefing each reviewer with the full item list. `/code-review` always gets a level: `low` for `ui`, `docs` and `tooling`, `medium` for `sim`, `perf`, `solo` and safety-gate changes, `high` only for Deep items or when Luke asks.
5. **Fix blockers.** Blockers go back to the same implementer via SendMessage, then retest.
   - An item that can't be fixed quickly is dropped from the batch rather than holding up the rest.
   - Everything else waits for the single `triage` call in step 7.
6. **Ratchet the baseline** with `python bench/run_bench.py --baseline`, only if the numbers genuinely improved or the measuring method changed (`--compare` says so when it did).
   - Machine drift doesn't count. If a re-baseline is only needed because the machine slowed down, ask Luke first and commit it separately.
7. **Finish.**
   - Each item gets its own Done row in `BACKLOG_DONE.md`: Tier, result and commit. The batch's Actual time goes on its first item.
   - Commit per item when the diffs separate cleanly. Otherwise use one commit that lists every ID.
   - Update `README.md` if controls or features changed.
   - Commit the `src/` changes with the rebuilt `index.html`, and push. A hook blocks a commit whose `index.html` isn't current with its `src/` (it checks what the commit would contain, including the command's own `git add`), and blocks a push if any pushed commit's `index.html` is stale; it then reruns the tests and the benchmark comparison, and blocks the push if any fails.
   - If the game changed, run `python tools/build_artifact.py` and republish the artifact.
   - One `triage` call files the reviewers' non-blocking findings and regroups the remaining Ready items (skipped if there's nothing to add and nothing was dropped).
   - Claude reports what shipped as a table (ID, Tier, Est. time, change), then the Actual vs. Est. time, the test and benchmark numbers, and the next batch.

## `/audit`: find what to improve

The most expensive command, so run it rarely: when the Ready list gets thin, or after a big feature lands.

1. **Collect evidence.** Runs `python tests/run_tests.py --screens` and `python bench/run_bench.py --compare`.
2. **Send out the specialists in parallel.** perf-profiler, physics-reviewer, ux-reviewer (which also plays the playtester's three personas), game-designer, efficiency-auditor, code-quality-reviewer and docs-writer each review the whole game, read-only, starting from step 1's results instead of re-running them. A finding without evidence is discarded. A focused audit (`/audit perf`, `/audit phones`) sends only the agents that cover the focus.
3. **Triage.** `triage` drops findings without evidence, merges duplicates, scores priority, gives each item a Tier and Est. time, regroups the batches, and updates `BACKLOG.md`, keeping the status of existing items.
4. **Report.** A summary of the headline numbers, the top five Ready items, the batches and anything that needs Luke's decision. It commits `BACKLOG.md` but doesn't push.

## Choosing what to iterate on

Running `/iterate` over and over works down the batches in priority order, which is a sensible default. Steer when you have something in mind:

- **By theme.** Pick what you want the game to feel like next (more fun right away, better on phones, faster to load, more correct) and run that category's batches. `ui` batches change what players see, `sim` batches change the physics.
- **By cost.** Light batches are the cheapest. `tooling` batches are cheap too, since they skip the playtest and the republish. Save `solo` Deep items for when a big step is worth the usage.
- **By dependencies.** Do the foundation first (for example, the batch with the "share this universe" link before the snapshot link that builds on it).
- **Fixes before features.** Something broken for players usually beats a new toy.
- **Ask.** "What should I iterate next if I care about phones?" is cheap, and Claude will recommend batches or items.

## A/B experiments

For a big architectural choice, such as a quadtree versus a uniform grid, Canvas2D versus WebGL, or physics on the main thread versus a Worker:

1. Create two git worktrees, one per approach.
2. Implement both minimally and benchmark each.
3. Keep the winner, and record both results in the item's Done entry.

These are always `solo` batches on the Deep tier.

## Keeping usage down

Luke is on a Pro plan. Each agent's model, effort and turn cap are set in its file in `.claude/agents/` and listed, with the reasons, in "Model & effort" in `CLAUDE.md`, which also summarises the 2026-09-29 usage review they came from. The session runs on Sonnet at medium effort and compacts at 200K tokens (`.claude/settings.json`). The implementer agents name their model explicitly, so they keep it whatever the session runs on, and so do `physics-reviewer` and `perf-profiler`. Switch models at the start of a session rather than partway through, because prompt caching is per model. In rough order of what they save:

- Keep the main session lean: it re-reads its whole context every turn, and was about half of all usage. Let it compact, read parts of big files rather than whole ones, and `/clear` between batches when running `/iterate` by hand (see "Keeping this session lean" in `.claude/skills/iterate/SKILL.md`).
- Treat Deep `solo` items and A/B experiments as the big spends they are (the one A/B experiment so far was about a fifth of all usage); `/autoiterate` asks before starting one.
- Name the `/code-review` level; `high` fans out to many sub-agents.
- Don't duplicate work: the tests and the benchmark run once per round, and reviewers get the results in their brief.
- Let batching do the work: one test, review and push cycle per batch instead of per item.
- Prefer many `/iterate` runs to frequent audits.
- Keep the session at medium effort, and use `/effort high` only where it's clearly needed.

## Example: three batches

These use the batches as of 2026-09-28.

1. **`/iterate`** runs `B1` (`tooling`, Opus): PERF-003, CODE-003 and EFF-004. It fixes the phone bench profile, has the tests read engine constants from the test hook, and makes the long-run bench able to see memory growth. Only test and bench code changes, so it gets a code review but no playtest and no republish. Est. 30-35 min.
2. **`/iterate B4`** runs `B4` (`ui`, Light): CODE-006, DESIGN-009 and UX-104 (inspector flux display, undo the last throw, and the hint fade). It gets one code review and one playtester pass for all three. Est. 25-30 min.
3. **`/iterate B6`** runs `B6` (`solo`, Deep): PERF-001, where dust drawing is about 85% of every frame. It's an architecture choice (batched paths versus a pixel buffer or WebGL), so it follows the A/B worktree convention on the Deep implementer. Est. 30-40 min, but it could get the `large` scene to 60 fps.
