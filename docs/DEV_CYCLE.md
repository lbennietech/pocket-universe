# Pocket Universe: dev cycle

Copyright (c) 2026 Luke Bennie <lukebennie@gmail.com>. All rights reserved.

How work flows from "what should we improve?" to a change that's live on GitHub Pages and the claude.ai artifact. There are two loops: `/audit` fills the backlog, and `/iterate` works through it one item at a time. The full steps are in `.claude/skills/audit/SKILL.md` and `.claude/skills/iterate/SKILL.md`. This guide is the overview.

## The backlog

`BACKLOG.md` holds every known improvement, in four sections: **Ready**, **In progress**, **Done** and **Rejected**. Each Ready item has an ID (such as `PERF-002`), an area, impact and effort scores from 1 to 5, a priority (impact ÷ effort), a **Tier** and **Est. time** (below), and evidence (a metric, a screenshot or a `file:line`). The Ready table is sorted by priority, so the top row is the best value for the effort.

To see the list, open `BACKLOG.md` (VS Code and GitHub render the table), ask Claude ("show the top 10 Ready items"), or print the Ready rows from the terminal:

```
python -c "s=open('BACKLOG.md',encoding='utf-8').read().split('## Ready')[1].split('## In progress')[0]; [print(' | '.join(c.strip() for c in l.split('|')[1:10])) for l in s.splitlines() if l.startswith('| ') and not l.startswith('| ID')]"
```

In a Claude Code session, prefix it with `!` to run it without using model tokens.

### Tier and Est. time (added 2026-09-28)

Every Ready row carries the **Tier** that `/iterate` would delegate it to and a rough **Est. time** for the whole pipeline (implement, test, review, ship — not just the coding). The `triage` agent fills these in for new items using the same rule `/iterate` uses to pick an implementer (see "Model & effort" in `CLAUDE.md`): Deep for the integrator, time-stepping, collisions/merges, determinism, spatial structures, threading or A/B experiments; Opus for a physics or perf area item or anything at effort 2+; Light for everything else at effort 1. These are planning estimates, not measurements, calibrated loosely against actual runs logged in the Done table (see below) — treat them as a rough guide to what to expect, not a commitment.

When an item moves to **Done**, its row also carries its **Tier** and an **Actual time** — a rough wall-clock figure for the whole run, including any regression-fix rounds or benchmark troubleshooting, not just the implementer agent's own working time. Batched items (see "Batching small items" below) record the batch's combined actual time once, on the item that carries the shared commit note, with the other items in the batch pointing to it.

## `/audit`: find what to improve

The most expensive command, so run it rarely: when the Ready list gets thin, or after a big feature lands.

1. **Collect evidence.** Runs `python tests/run_tests.py --screens` (all checks plus screenshots) and `python bench/run_bench.py --compare`.
2. **Send out the specialists in parallel.** perf-profiler, physics-reviewer, ux-reviewer, game-designer, efficiency-auditor, code-quality-reviewer and playtester each review the whole game, read-only. A finding without evidence is discarded.
3. **Triage.** The `triage` agent drops findings without evidence, merges duplicates, scores priority and updates `BACKLOG.md`, keeping the status of existing items.
4. **Report.** A summary of the headline numbers, the top five Ready items and anything that needs Luke's decision. It commits `BACKLOG.md` but doesn't push.

## `/iterate`: ship one improvement

The everyday command. `/iterate` takes the top Ready item; `/iterate PERF-002` takes the item you name.

1. **Pick.** Move the item to In progress. If it's a big architectural choice, use the A/B worktree convention (below).
2. **Choose the implementer tier and implement.** `/iterate` picks one of three agents to make the smallest change that delivers the item, in `index.html`, plus a check in `tests/harness.js` or `tests/invariants.js` for new behaviour:
   - **Deep** (`implementer-deep`, Opus at high effort): the integrator, time-stepping, collisions and merges, determinism, spatial structures, Workers or threading, and A/B experiments.
   - **Opus** (`implementer-opus`, Opus at medium effort): a physics or perf area item, or anything at effort 2 or more.
   - **Light** (`implementer`, Sonnet at medium effort): everything else.
   - Luke can override the tier, for example "/iterate UX-005 on Opus".
3. **Test.** `python tests/run_tests.py` must pass everywhere, and `python bench/run_bench.py --compare` must not regress by more than 5%.
4. **Review.**
   - `/code-review` on the diff, and fix what it finds.
   - The `playtester` agent, always.
   - The `physics-reviewer` agent if the simulation changed (gravity, collisions, sizes, masses, time-stepping, dust, life rules or scenes). Deep-tier items already got Opus at high effort during implementation, so no separate high-effort physics pass is needed here.
5. **Triage** the review findings. For blockers, send them back to the same implementer agent via SendMessage (then retest); send the rest to the backlog.
6. **Ratchet the baseline** with `python bench/run_bench.py --baseline` if the benchmarks improved and nothing regressed.
7. **Finish.** Move the item to Done with its result and commit hash, update `README.md` if controls or features changed, then commit and push. A hook reruns the tests and the benchmark comparison and blocks the push if either fails. Finally, `python tools/build_artifact.py` and republish the artifact.

## Choosing what to iterate on

Running `/iterate` over and over works down the list in priority order, which is a sensible default. The score is a rough guide, though, so steer when you have something in mind:

- **By theme.** Pick what you want the game to feel like next (more fun right away, better on phones, faster to load, more correct) and do that area's items back to back. The area column (`design`, `perf`, `ux`, `efficiency`, `physics`, `code`) is a good filter.
- **By cost.** Items with effort 1 are cheap runs: small change, short review. Save effort 2 and 3 items for when a bigger step is worth the extra usage.
- **By dependencies.** Some items build on others. Do the foundation first (for example, the "share this universe" link before a snapshot link that extends it).
- **Fixes before features.** Something broken for players, like a wrong number or a hidden label, usually beats a new toy.
- **Ask.** "What should I iterate next if I care about phones?" is cheap, and Claude will recommend IDs from the backlog.

## Batching small items (added 2026-09-28)

Several independent Ready items that are all Light tier (or all the same tier) and don't touch the simulation (gravity, collisions, sizes, masses, time-stepping, dust, life rules or scene `build()` logic) can be implemented, tested and reviewed together in one pass instead of one `/iterate` cycle each. This cuts most of the per-item overhead: one `python tests/run_tests.py` run, one `/code-review`, one `playtester` pass, instead of one of each per item.

- **Only batch genuinely independent items.** Don't mix an item that needs a physics review with ones that don't — that forces every item in the batch through a review it doesn't need. Don't batch items likely to touch the same lines of `index.html` in conflicting ways.
- **One implementer agent for the whole batch**, briefed with every item's row and proposal, working through them one at a time as isolated edits. Never run two implementer agents on the batch in parallel in the same working tree — they'd clobber each other's uncommitted edits with no git worktree isolation between them.
- **Still one commit per item when the diff allows it**, but when the changes are too interleaved to split safely (the common case for a same-file batch), one commit covering the whole batch is fine — list every ID in the commit message, and give each item its own Done row pointing at that shared commit, with the actual time recorded once (see "Tier and Est. time" above).
- The rest of the pipeline (test, bench, review, triage, ratchet, finish) runs exactly once for the whole batch, same as a single-item `/iterate` run.

## Supporting commands

| Command | What it does |
|---|---|
| `python tests/run_tests.py` | All checks: three browsers, emulated phones, physics invariants. `--quick` for a quick load check, `--screens` to save screenshots to `tests/output/`. |
| `python bench/run_bench.py` | Benchmarks. `--compare` checks against `bench/baseline.json`, and `--baseline` records a new one (only after a genuine improvement). |
| `python tools/serve.py` | Serves the game at http://localhost:8765/ for the Playwright browser tool. |
| `python tools/build_artifact.py` | Rebuilds `pocket-universe.html` for the claude.ai artifact. |
| `/effort high` | For hard reasoning (integrator, collisions, determinism, spatial structures, threading). Return to medium afterwards. |

## A/B experiments

For a big architectural choice, such as a quadtree versus a uniform grid, Canvas2D versus WebGL, or physics on the main thread versus a Worker, create two git worktrees, one per approach. Implement both minimally, benchmark each, keep the winner and record both results in the item's Done entry.

## Keeping usage down

Each agent's model and effort are set in its file in `.claude/agents/` and listed in the Model & effort section of `CLAUDE.md`. The session itself defaults to Sonnet at medium effort (`.claude/settings.json`). `/iterate` routes implementation work to one of three implementer agents by tier (`implementer` on Sonnet, `implementer-opus` and `implementer-deep` on Opus), named explicitly so they keep their model regardless of the session's. `physics-reviewer` and `perf-profiler` do the same. Switch models at the start of a session rather than partway through, because prompt caching is per model. Beyond that:

- Prefer many small `/iterate` runs to frequent audits.
- Keep the session at medium effort, and use `/effort high` only where it's clearly needed.
- Items with effort 1 cost the least. The expensive ones are architecture changes and anything that needs an A/B experiment.

## Example: three iterations

These use items from the 2026-09-27 audit.

1. **`/iterate`** takes the top item, `DESIGN-002`: give each scene its own starting speed so Cradle shows life in seconds, not about 162. It's a small change per scene plus a harness check. Scenes count as simulation, so the physics-reviewer runs, but it isn't an integrator change, so no high-effort pass. The playtester confirms Cradle pays off quickly on desktop and phone. Cost: low.
2. **`/iterate PERF-002`**: stop resampling the parallax star tile every frame (phone frame time measured 64.0 → 37.1 ms with smoothing off). The benchmark comparison is the key step here, and the improvement ratchets the baseline. No physics review, since it only changes drawing. Cost: low.
3. **`/iterate PERF-001`**: dust drawing is about 85% of every frame. This is an architecture choice (batched paths versus a pixel buffer or WebGL), so it follows the A/B worktree convention with `/effort high` for the design. Cost: medium to high, but it could get the `large` scene to 60 fps.
