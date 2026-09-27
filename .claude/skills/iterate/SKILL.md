---
name: iterate
description: Take the top Ready item from Pocket Universe's BACKLOG.md (or one Luke names) through the full pipeline - implement the smallest change, run tests and invariants, benchmark against the baseline, code review, playtest, physics review when needed, triage follow-ups, then commit, push and republish. Use when Luke says iterate, "do the next backlog item", or names a backlog ID.
argument-hint: "[backlog ID, optional]"
---

# /iterate

Wraps the pre-push routine in `CLAUDE.md` and extends it with the backlog and the benchmarks. Keep the existing routine's behaviour; this adds to it.

## 1. Pick the item

- Use the ID in `$ARGUMENTS` if given, else the top row of **Ready** in `BACKLOG.md`.
- Move it to **In progress** (keep its row, add today's date).
- If it's a big architectural choice (for example a spatial structure, WebGL, a Worker), follow the A/B worktree convention in `CLAUDE.md` instead of picking one approach up front.
- If it needs deep reasoning (integrator, collisions, determinism, spatial structures, threading), tell Luke that `/effort high` is worth switching on for this one.

## 2. Implement

Make the **smallest reasonable change** that delivers the item, in `index.html` (plus tests if the behaviour is new). Keep the single-file, no-build design. Use `rand()`, never `Math.random()`, in anything that shapes the simulation. Add or extend a check in `tests/harness.js` or `tests/invariants.js` for new behaviour.

## 3. Test

- `python tests/run_tests.py`: every check must pass, including the physics invariants.
- `python bench/run_bench.py --compare`: on a regression over the threshold, fix it or abandon the change. If you abandon it, move the item back to Ready (or to Rejected) and record why.

## 4. Review

- Run `/code-review` on the change and fix what it finds.
- Run the `playtester` agent (always).
- Run the `physics-reviewer` agent if the simulation changed (gravity, collisions, sizes, masses, time-stepping, dust, life rules or scenes).

If the project's agents aren't available as agent types, run `general-purpose` agents told to follow the matching file in `.claude/agents/`.

## 5. Triage the reviews

Pass the reviewers' findings to `triage`. Fix blockers now (then repeat steps 3 and 4 for the fix), and send everything else to the backlog.

## 6. Ratchet the baseline

If the benchmarks improved and nothing regressed, update the baseline with `python bench/run_bench.py --baseline`, and mention the improvement.

## 7. Finish

- Move the item to **Done** with its result (the metric delta, or what changed for the player) and the commit hash.
- Update `README.md` if controls or features changed.
- Commit (authored as Luke Bennie, per `CLAUDE.md`), then `git push`. The push hook reruns the tests and the benchmark comparison.
- Run `python tools/build_artifact.py` and republish `pocket-universe.html` to the claude.ai artifact.
- Tell Luke what shipped, the numbers, and what's next on the backlog.
