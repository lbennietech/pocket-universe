# Improvement plan: progress

Tracks the work order in `IMPROVEMENT_PLAN.md`. To pick up in a new session, open Claude Code in this folder and say "continue the improvement plan".

## Decisions (Luke, 2026-09-27)

- **Tooling:** Playwright for Python for tests and benchmarks (Chromium, Firefox, WebKit, phone emulation). Node.js is installed only for the Playwright browser tool (MCP) that agents use. The game itself stays dependency-free.
- **Performance target:** 60 fps at 300 bodies plus 8,000 dust (everyday), 1,000 bodies as the stretch target, and a phone profile (4× CPU slowdown) at 30 fps.
- **Design pillars:** all four in `CLAUDE.md`.
- **Hooks:** a quick load check after edits to the game; the full tests plus the benchmark comparison block `git push`.
- **Determinism:** a seeded `rand()` and fixed-frame test controls (a player-facing "share this universe" link could come later).
- **Nightly audit:** not now.

## Phases

- [x] 0: survey, `docs/ARCHITECTURE.md`
- [x] Groundwork: seedable `rand()`, frame timing (`perf`), test hook `tick`/`physics`/`seed`
- [x] 1: `CLAUDE.md` targets, pillars, workflow, model & effort
- [x] 2: benchmarks (`bench/`)
- [x] 3: physics invariant tests (`tests/invariants.js`)
- [x] 4: Playwright test runner, `tools/serve.py`, `.mcp.json`, playtester personas
- [x] 5: audit agents (perf-profiler, ux-reviewer, game-designer, efficiency-auditor, code-quality-reviewer, triage) and model/effort on existing agents
- [x] 6: `BACKLOG.md`
- [x] 7: skills `/audit` and `/iterate`
- [x] 8: hooks
- [x] 9: A/B worktree convention (documented in `CLAUDE.md`)
- [ ] 10: nightly audit (skipped by decision)
- [ ] First `/audit`, then the full routine, then push
