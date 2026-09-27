---
name: iterate
description: Take the next batch of Ready items from Pocket Universe's BACKLOG.md (or a batch, item or items Luke names) through the full pipeline once - implement the smallest changes, run tests and invariants, benchmark against the baseline, code review, playtest, physics review when needed, triage follow-ups, then commit, push and republish. Use when Luke says iterate, "do the next backlog item/batch", or names a backlog or batch ID.
argument-hint: "[batch ID, item ID, 'ID solo', or nothing]"
---

# /iterate

Wraps the pre-push routine in `CLAUDE.md` and extends it with the backlog, batches and the benchmarks. Keep the existing routine's behaviour; this adds to it.

The unit of work is a **batch**: a group of Ready items that `triage` has put together because they share a category, a tier and review needs (see the Batches table in `BACKLOG.md` and rule 9 in `.claude/agents/triage.md`). One batch goes through implement, test, review and ship once, however many items it holds. A `solo` batch is a single item and runs exactly like a classic one-item iteration.

## 1. Pick the batch and its tier

- **What to run:**
  - `$ARGUMENTS` is a batch ID (for example `B2`): run that batch.
  - `$ARGUMENTS` is an item ID: run the batch that item belongs to. If Luke adds `solo` (`/iterate UX-104 solo`), run only that item.
  - `$ARGUMENTS` is empty: run the batch containing the top Ready item (`B1`).
  - Luke can drop items ("/iterate B2 without UX-104") or override the tier ("/iterate B3 on Opus").
- If the Batches table is missing, or doesn't match the Ready rows (items listed that aren't in Ready, Ready items with no batch), have `triage` regroup first. It runs on Sonnet at low effort, so this is cheap.
- Before starting, tell Luke: the batch ID, category, tier, the items (ID + short title), which reviews it needs, and its Est. time.
- Move every item in the batch to **In progress**, keeping its Batch, Tier and Est. time columns, and add today's date.
- If an item is a big architectural choice (a spatial structure, WebGL, a Worker), it's `solo`. Follow the A/B worktree convention in `CLAUDE.md` instead of picking one approach up front.
- **Choose the implementer** (this should match the batch's Tier; if it doesn't, apply this rule and say so):
  - **Deep** (`implementer-deep`, Opus at high effort): the integrator, time-stepping, collisions and merges, determinism, spatial structures, Workers or threading, and A/B experiments. These are always `solo`.
  - **Opus** (`implementer-opus`, Opus at medium effort): physics or perf area items, or anything at effort 2 or more.
  - **Light** (`implementer`, Sonnet at medium effort): everything else (ux, design, efficiency or code items at effort 1).

## 2. Implement

Brief **one** implementer agent with every item in the batch: each item's full row (ID, area, impact, effort, evidence) and its proposal. It works through them one at a time as isolated edits. For each item, it makes the **smallest reasonable change** that delivers it, in `index.html` (plus tests if the behaviour is new), keeping the single-file, no-build design, using `rand()` never `Math.random()`, and adding or extending a check in `tests/harness.js` or `tests/invariants.js` for new behaviour. It runs the tests once at the end and reports per item what changed. It never commits or pushes.

Never run two implementer agents on the same working tree at once: they'd overwrite each other's uncommitted edits. Only split a batch across agents with separate git worktrees, as in the A/B convention.

If the implementer flags an item as riskier than its category suggests (for example a `ui` item that turns out to touch the simulation), take that item out of the batch: revert its edits if it made any, and send it back to Ready with a note for `triage` to regroup. Carry on with the rest.

## 3. Test

- `python tests/run_tests.py`: every check must pass, including the physics invariants.
- `python bench/run_bench.py --compare`: on a regression over the threshold, find which item caused it (a stash/pop A/B test against the unchanged code shows whether it's the change or the machine), then fix it or drop that item from the batch. If you drop or abandon an item, move it back to Ready (or to Rejected) and record why.

## 4. Review

Run the reviews in the batch's **Reviews** column once, for the whole batch:

| Category | Reviews |
|---|---|
| `ui` | `/code-review` + `playtester` |
| `tooling` | `/code-review` only (the game doesn't change, so no playtest) |
| `sim` | `/code-review` + `playtester` + one `physics-reviewer` for the whole batch |
| `perf` | `/code-review` + `playtester` + careful benchmark reading; add `physics-reviewer` if the simulation changed |
| `solo` | whatever that one item needs by the rules above |

Brief each reviewer with the full list of items in the batch and what each one should do, so it can check each item by name. Deep-tier items already got Opus at high effort during implementation, so they don't need a separate high-effort physics pass.

If the project's agents aren't available as agent types, run `general-purpose` agents told to follow the matching file in `.claude/agents/`.

## 5. Triage the reviews

Pass the reviewers' findings to `triage`. Send blockers back to the same implementer agent from step 2 via SendMessage (it keeps the context from its first pass), then repeat steps 3 and 4 for the fix. If a blocker can't be fixed quickly, drop just that item from the batch (revert its edits, return it to Ready with the reason) rather than holding up the rest. Everything else goes to the backlog.

## 6. Ratchet the baseline

If the benchmarks genuinely improved and nothing regressed, update the baseline with `python bench/run_bench.py --baseline`, and mention the improvement. Machine drift isn't an improvement. If a re-baseline is only needed because the machine slowed down, ask Luke first and commit it separately with a clear message.

## 7. Finish

- Move every shipped item to **Done**, each with its own row: its Tier, its result (the metric delta, or what changed for the player) and the commit hash. Record the batch's **Actual time** once (rough wall-clock for the whole run, including fix rounds and troubleshooting) on the first item. The other rows say "part of batch Bn (see ID)".
- Commits: one per item when the diffs separate cleanly. Otherwise, one commit for the batch that lists every ID in its message.
- Update `README.md` if controls or features changed.
- Commit (authored as Luke Bennie, per `CLAUDE.md`), then `git push`. The push hook reruns the tests and the benchmark comparison.
- If the batch changed the game, run `python tools/build_artifact.py` and republish `pocket-universe.html` to the claude.ai artifact. A `tooling`-only batch doesn't need a republish.
- Have `triage` regroup the remaining Ready items if this batch dropped or added any, so the Batches table stays current.
- Tell Luke what shipped, as a table with each item's ID, Tier, Est. time and a short description of the change. Then give the batch's Actual time against its Est. time, the test and benchmark numbers, and the next batch on the backlog.
