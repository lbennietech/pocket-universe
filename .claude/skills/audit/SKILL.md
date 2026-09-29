---
name: audit
description: Audit the whole of Pocket Universe for improvements - run the benchmarks and invariant tests, dispatch the specialist agents in parallel (including a docs accuracy check), triage their findings into BACKLOG.md and summarise the top five items and the batches. Use when Luke asks for an audit, a backlog refresh or "what should we improve next".
---

# /audit

Finds improvements across the whole game (not just a change), with evidence, and turns them into a prioritised `BACKLOG.md`. Judge everything against the targets and design pillars in `CLAUDE.md`.

## 1. Make sure the build is current and the tools work

- `git status`: note uncommitted changes (the audit covers the working tree).
- `python tools/serve.py`: starts or confirms the local server at http://localhost:8765/ for the browser tool.
- If `python -m playwright --version` fails, stop and tell Luke how to install it (`pip install playwright` and `python -m playwright install chromium firefox webkit`).

## 2. Collect evidence

Run these and keep the output. The agents will cite it:

- `python tests/run_tests.py --screens`: functional checks in three engines, phones, physics invariants, and screenshots in `tests/output/`.
- `python bench/run_bench.py --compare`: frame timings from a same-session A/B against the upstream `index.html`, heap growth (`long-run` and `soak`), size and budgets.

## 3. Dispatch the specialists in parallel

Launch these agents together, in the background, each with a short brief that includes the key numbers from step 2 and where the screenshots are:

- `perf-profiler`
- `physics-reviewer` (ask for audit-format findings)
- `ux-reviewer`
- `game-designer`
- `efficiency-auditor`
- `code-quality-reviewer`
- `playtester` (ask for audit-format findings from the three personas, not a push verdict)
- `docs-writer` (audit mode: check every doc against the current code and game, and flag features that shipped without docs)

Tell each one that this is a whole-game audit, that it must not edit anything, and that findings without evidence will be discarded. If the project's agents aren't available as agent types (for example the session started outside this folder), run `general-purpose` agents and tell each to follow the matching file in `.claude/agents/`.

## 4. Triage

When all have reported, pass every finding to the `triage` agent. It updates `BACKLOG.md`: it discards findings without evidence, merges duplicates, scores impact ÷ effort, gives each item a Tier and Est. time, regroups all Ready items into batches (the Batches table), and keeps existing statuses.

## 5. Report to Luke

Summarise in plain language:

- the headline numbers (tests passed, frame times against budget, size)
- the **top five** Ready items, each with one line on what it is and why it matters
- the **batches** (ID, category, tier, item count, Est. time), so Luke can see what the next few `/iterate` runs will ship
- anything that needs Luke's decision (items that touch a pillar, or big A/B choices)

Commit `BACKLOG.md` with a message like `Audit YYYY-MM-DD: N new backlog items`. Don't push just for a backlog update unless Luke asks.
