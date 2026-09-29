---
name: devmanual
description: Print Pocket Universe's developers' guide, short - the framework size and usage profile, the life cycle, the commands, the current state of the backlog, and when the process should change. 'full' prints the whole of docs/DEV_CYCLE.md. Use when Luke asks how to work on the project, what the commands are, or what to do next.
argument-hint: "[nothing for the short version, or 'full']"
---

# /devmanual

Read-only: this skill changes nothing. Keep it cheap: read only the parts named below, not whole files.

## `/devmanual full`

Read `docs/DEV_CYCLE.md` and print it as it is. Stop.

## `/devmanual` (short version)

Print these five parts, in this order, in well under a screen:

1. **Size and profile.** Framework size **Standard**, usage profile **Lean** (from `CLAUDE.md`, "Model & effort"): the full audit-and-iterate framework, run as cheaply as the work allows.
2. **Life cycle.** `/audit` rarely, to fill the backlog → `triage` groups Ready items into batches → `/iterate` ships one batch (implement, test, benchmark, review, playtest, commit, push, republish), or `/autoiterate` loops batches until the backlog is done or something needs Luke. Luke's new requests are merged into the backlog at the start of each cycle.
3. **Commands.** The "Quick reference" table in `docs/DEV_CYCLE.md` (read just that section), plus `/autoiterate` (`/autoiterate stop` to finish the batch in flight and stop) and `/devmanual full`. Shorten each row to one line.
4. **Current state.** From `BACKLOG.md`, read only the "Batches" and "In progress" sections: what's in progress, and the next batch with its category, tier, items and Est. time. From git: the branch, and how many commits are waiting to be pushed (`git status -sb`).
5. **When the process should change.** Move to **Full** if the game gains other developers, a hosted service with uptime targets, or regulated or personal data (add the scale's extra reviewers and CI as the gate). Move to **Light** if work drops to occasional fixes (stop audits and batching; one implementer and the change review). Either move is Luke's decision.

If `docs/DEV_CYCLE.md` and this skill disagree, the doc wins: say so, so the skill can be fixed.
