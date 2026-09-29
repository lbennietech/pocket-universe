---
name: autoiterate
description: Keep running Pocket Universe's /iterate dev cycle batch after batch without waiting for Luke - intake his new requests between batches, ship each batch through the full pipeline, and pause and resume on its own around session limits - until the backlog is done or something needs his decision. Use when Luke says autoiterate, "keep iterating", "work through the backlog", or asks for the loop to run unattended. For a single cycle, use /iterate.
argument-hint: "[optional: 'stop', 'stop now', N batches, or 'until <ID>']"
---

# /autoiterate

`/iterate` runs **one** batch through the dev cycle and stops. `/autoiterate` runs that same cycle **repeatedly**, with no input from Luke between batches. Every quality gate in `/iterate` still applies to every batch: never skip a review, a test or the push gate to go faster.

For unattended runs that must survive a session limit, start it as **`/loop /autoiterate`**. That lets the session schedule its own wake-up at the limit's reset time (see "Session limits" below). Plain `/autoiterate` loops just as well while the session can run, but it can only resume after a limit if Luke nudges it.

## Turning it off

There's one command, with a `stop` argument; no separate "off" command is needed.

- **`/autoiterate stop`** (or Luke saying "stop autoiterating"): finish the batch in flight through its commit and push, then stop instead of picking the next one.
- **`/autoiterate stop now`**: stop at the next safe point, without starting new work. Don't leave half-finished edits: let a running agent finish or tell it to stop, then either commit what passes the gates or stash the rest (`git stash -u`) and say so.
- Either way, if it's running under `/loop`, cancel the scheduled wake-up (ScheduleWakeup with `stop: true`) so it can't restart itself, then report what shipped in the run.

## The loop

Repeat until a stop condition:

1. **Intake.** Run step 0 of `/iterate` (`.claude/skills/iterate/SKILL.md`): fold any requests Luke sent since the last batch into the backlog, consolidate, then have `triage` regroup and refresh priorities, keeping his pins.
2. **Pick** the next batch: `B1`, or the next one whose dependencies are met. Skip, don't stall on, a batch waiting on Luke's decision.
3. **Run it through the whole `/iterate` pipeline**, steps 1 to 7: implement, test, benchmark, review, triage, ratchet, finish (commit, push, record the hash).
4. **Report in two or three lines:** what shipped, anything dropped and why, and the next batch. Don't wait for a reply; go straight to step 1.

Between steps, while agents work in the background, don't end a turn idle: either have an agent or command in flight (its notification resumes the session), have a wake-up scheduled, or have stopped for one of the reasons below.

## Stop conditions

Stop, report and wait for Luke when:

- **The Ready list is empty**, or every remaining item is blocked on something only Luke can decide.
- **A decision only Luke can make** blocks the next useful work: a design-pillar trade-off, a budget change, pushing somewhere new, anything destructive or visible to others beyond the normal push to `main`. Ask once, clearly, and keep working on batches that don't depend on the answer.
- **Something is broken** that one fix round couldn't repair and dropping the item doesn't unblock: the push gate keeps failing on a real regression, tests fail on `main`, or a tool is broken.
- **Luke says stop,** or the argument's limit is reached ("stop after 3 batches", "until DESIGN-014").

When stopping, summarise every batch shipped in this run (the `/iterate` report table), the total time, and what's next.

## Session limits

When an agent, or the session itself, hits a usage or rate limit:

1. **Check the real clock** with `date` in the shell. Task notifications can arrive late, and there's no other reliable clock.
2. **Reset time already passed:** check `git status` for half-finished edits, then resume the same agent with SendMessage (it keeps its context).
3. **Reset still in the future:** tell Luke the real reset time and how long that is from now. Carry on with work that doesn't need the limited agent, if any. Then:
   - **Under `/loop`:** call ScheduleWakeup for the reset time plus about two minutes, with the same `/loop` prompt so the wake-up re-enters `/autoiterate`. Delays are capped at an hour, so chain wake-ups for a longer wait. On waking, check the clock again, then resume.
   - **Without `/loop`:** say that it's paused until the reset and that `/autoiterate` (or any message) resumes it.
4. **A 429 with no reset time:** retry once before treating it as a real limit.
5. Quote the error as given, and don't call a limit model-specific unless the error says so.
