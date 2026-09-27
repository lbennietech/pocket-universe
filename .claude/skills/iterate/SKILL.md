---
name: iterate
description: Take the top Ready item from Pocket Universe's BACKLOG.md (or one Luke names) through the full pipeline - implement the smallest change, run tests and invariants, benchmark against the baseline, code review, playtest, physics review when needed, triage follow-ups, then commit, push and republish. Use when Luke says iterate, "do the next backlog item", or names a backlog ID.
argument-hint: "[backlog ID, optional]"
---

# /iterate

Wraps the pre-push routine in `CLAUDE.md` and extends it with the backlog and the benchmarks. Keep the existing routine's behaviour; this adds to it.

## 1. Pick the item and its tier

- Use the ID in `$ARGUMENTS` if given, else the top row of **Ready** in `BACKLOG.md`.
- Move it to **In progress**, keeping its **Tier** and **Est. time** columns as they already are in `BACKLOG.md`, and add today's date.
- If it's a big architectural choice (for example a spatial structure, WebGL, a Worker), follow the A/B worktree convention in `CLAUDE.md` instead of picking one approach up front.
- Choose which `implementer` agent does the work (this should already match the item's **Tier** column in `BACKLOG.md`; if it doesn't, or the item is new and has no Tier yet, apply this rule and record it):
  - **Deep** (`implementer-deep`, Opus at high effort): the integrator, time-stepping, collisions and merges, determinism, spatial structures, Workers or threading, and A/B experiments.
  - **Opus** (`implementer-opus`, Opus at medium effort): a physics or perf area item, or anything with effort 2 or more.
  - **Light** (`implementer`, Sonnet at medium effort): everything else — ux, design, efficiency or code items at effort 1.
  - Luke can override the tier, for example "/iterate UX-005 on Opus".
  - Say which tier was chosen and why before delegating, and mention the item's **Est. time**.

## 2. Implement

Delegate the implementation to the chosen agent, briefing it with the item's full row from `BACKLOG.md` (ID, area, impact, effort, evidence) and its proposal. It makes the **smallest reasonable change** that delivers the item, in `index.html` (plus tests if the behaviour is new), keeping the single-file, no-build design, using `rand()` never `Math.random()`, and adding or extending a check in `tests/harness.js` or `tests/invariants.js` for new behaviour. It reports back what changed and the test result; it never commits or pushes.

## 3. Test

- `python tests/run_tests.py`: every check must pass, including the physics invariants.
- `python bench/run_bench.py --compare`: on a regression over the threshold, fix it or abandon the change. If you abandon it, move the item back to Ready (or to Rejected) and record why.

## 4. Review

- Run `/code-review` on the change and fix what it finds.
- Run the `playtester` agent (always).
- Run the `physics-reviewer` agent if the simulation changed (gravity, collisions, sizes, masses, time-stepping, dust, life rules or scenes). Deep-tier items already got Opus at high effort during implementation, so no separate high-effort physics pass is needed here.

If the project's agents aren't available as agent types, run `general-purpose` agents told to follow the matching file in `.claude/agents/`.

## 5. Triage the reviews

Pass the reviewers' findings to `triage`. For blockers, send them back to the same implementer agent from step 2 via SendMessage (it keeps the context from its first pass), then repeat steps 3 and 4 for the fix. Send everything else to the backlog.

## 6. Ratchet the baseline

If the benchmarks improved and nothing regressed, update the baseline with `python bench/run_bench.py --baseline`, and mention the improvement.

## 7. Finish

- Move the item to **Done**, keeping its **Tier** column and adding an **Actual time** (a rough wall-clock estimate for the whole run, including any fix rounds or troubleshooting — not just the implementer's own time), its result (the metric delta, or what changed for the player), and the commit hash.
- Update `README.md` if controls or features changed.
- Commit (authored as Luke Bennie, per `CLAUDE.md`), then `git push`. The push hook reruns the tests and the benchmark comparison.
- Run `python tools/build_artifact.py` and republish `pocket-universe.html` to the claude.ai artifact.
- Tell Luke what shipped, the numbers (including Tier and Actual vs. Est. time), and what's next on the backlog.
