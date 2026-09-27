# Backlog

_Last audit: 2026-09-27_

## Ready (sorted by priority)

| ID | Area | Title | Impact | Effort | Priority | Evidence |
|----|------|-------|--------|--------|----------|----------|
| PERF-003 | perf | Phone bench underestimates real phones ~1.7×; nothing above default speed | 4 | 1 | 4.00 | bench/run_bench.py:44,131; 412×915 dsf2.625 measured 123-139ms vs 75-89 |
| EFF-001 | efficiency | Web fonts download 3.5× more than the game itself | 4 | 1 | 4.00 | index.html:24; 123.8KB woff2+11.4KB CSS vs 35.2KB game |
| DESIGN-004 | design | "Go supernova" button in inspector for heavy stars | 4 | 1 | 4.00 | index.html:947,1943-1946; stars sit at 100 M☉ forever |
| PHYS-002 | physics | Supernova ejecta below escape speed falls back; big remnants leave no nebula | 3 | 1 | 3.00 | index.html:1009-1013; 384/520 survive at 11 M☉ vs 0/520 at 110 M☉ |
| CODE-006 | code | Inspector shows stale/zero flux for new bodies and while paused | 3 | 1 | 3.00 | index.html:699,1135,1955; new planet shows ~9K "Too cold" |
| CODE-004 | code | Determinism check ignores dust despite its own comment | 3 | 1 | 3.00 | tests/invariants.js:39-41 |
| UX-002 | ux | Help right after scene load shows the scene blurb twice | 3 | 1 | 3.00 | scratch\ux\desktop-help.png; index.html:1417,1830 |
| UX-006 | ux | Auto-orbit loses its label and is stranded on its own dock row on phones | 3 | 1 | 3.00 | tests/output/phone-pixel-7.png, phone-iphone-13.png; index.html:325; scratch\playtest\shots\phone-01-arrival.png, phone-01-sun-planet-autoorbit.png (merged UX-102) |
| CODE-001 | code | build_artifact.py drops first `<style>` block and ships avoidable bloat; nothing checks the copy is current | 3 | 1 | 3.00 | tools/build_artifact.py:29 slices before index.html:17-21; test hook 398B; stripping comments/indentation saves ~6KB gz (35.9→29.9KB) (merged EFF-003) |
| DESIGN-011 | design | Galaxies (first scene) slow to pay off, loses its tails | 3 | 1 | 3.00 | scratch\play\gal-20.png, gal-40.png, galaxies-60s.png; dust 2,900→1,552 by 60s |
| DESIGN-009 | design | Undo the last throw | 3 | 1 | 3.00 | scratch\play\free-bh-8.png; mis-aimed 30 M☉ black hole wiped a system in ~12s |
| DESIGN-006 | design | Each calm scene's blurb ends with one dare | 3 | 1 | 3.00 | index.html:1236-1392; Binary/Figure eight/Cradle: no events in 60s at default speed |
| PERF-001 | perf | Dust drawn as 8,000 anti-aliased round-capped strokes is ~85% of every frame | 5 | 2 | 2.50 | index.html:2181,2190-2197; medium 15.2→2.3ms removing drawTracers |
| DESIGN-001 | design | "Share this universe" link (scene + seed in URL) | 5 | 2 | 2.50 | index.html:553; no location/URLSearchParams/localStorage use; Mayhem varies a lot by seed |
| CODE-007 | code | Frame time not clamped below zero | 2 | 1 | 2.00 | index.html:2608,2612 (Math.min(50,...) with no lower bound) |
| PHYS-004 | physics | Merged planets keep their old look and name | 2 | 1 | 2.00 | index.html:677,923; merged brown dwarfs keep planet style ("Rocky world" at several M♃) |
| PHYS-005 | physics | Stars below ~0.14 M☉ have HZ inside the star; L/T laws off at extremes | 2 | 1 | 2.00 | index.html:686,1940-1947; 0.08 M☉ HZ 2.3-3.7 units vs contact 9.0 |
| CODE-010 | code | Momentum zeroing written four ways; Binary scene skips it, drifts | 2 | 1 | 2.00 | index.html:1264-1266,1308-1320,1366-1380,1284; binary none; COM speed 0.006-0.011 units, drift 0.5-0.9 AU/100yr seeds 1-5 (merged PHYS-007) |
| UX-004 | ux | Hint jumps over the scene picker when the inspector opens on phones | 2 | 1 | 2.00 | tests/output/phone-pixel-7-inspector.png; index.html:1823 |
| UX-007 | ux | Follow glows gold (tool colour) though it's a setting | 2 | 1 | 2.00 | tests/output/phone-pixel-7-inspector.png; index.html:372 |
| UX-008 | ux | Speed readout is a hidden reset button | 2 | 1 | 2.00 | index.html:432 (title attribute only) |
| UX-101 | ux | Habitable-zone labels can draw under the readout HUD on phones | 2 | 1 | 2.00 | scratch\playtest\shots\zoom-zone-label-check.png vs zoom-zone-label-check-desktop.png |
| CODE-011 | code | Repeated magic predicates, palette indices and zoom limits | 2 | 1 | 2.00 | index.html:797,1109,2636 (heavy-body test); 501,1167,2196 (probe colour); 1413,1475,1724 (zoom clamp) |
| CODE-012 | code | Test/bench runners crash with raw tracebacks when Playwright/browser missing | 2 | 1 | 2.00 | tests/run_tests.py:27,256,146; bench/run_bench.py:29 (unguarded imports/launch) |
| PERF-007 | perf | Formation's opening seconds cost ~2x per frame at its new starting rate | 2 | 1 | 2.00 | index.html:1305,2636-2642; desktop 2.6/1.2ms (rate4) vs 5.8/5.1ms (rate60); phone profile 12.9/8.6ms vs 26.7/23.6ms; per PERF-003 real phones ~1.7x slower, opening frames could hit ~40-45ms for ~10-20s until mergers (280→81 bodies by sim time 1000) |
| DESIGN-012 | design | Cradle/Formation blurbs still tell the player to turn the speed up | 2 | 1 | 2.00 | index.html:1249 ("Slide the speed up...") and 1306 ("Turn the speed up...") vs new default rate 60 (DESIGN-002) |
| UX-001 | ux | On phones panels leave less than half the screen for the sky | 4 | 2 | 2.00 | scratch\ux\pixel-mayhem-8s.png; tests/output/phone-iphone-13.png; index.html:1858 |
| DESIGN-003 | design | Click an event in the feed to fly the camera to it | 4 | 2 | 2.00 | index.html:1843,1856; scratch\play\mayhem-10s.png |
| PHYS-001 | physics | Formation scene makes brown dwarfs, not habitable planets; life stuck at Jupiter mass | 4 | 2 | 2.00 | index.html:1309-1319 (disk 0.13 M☉), seeds 1-3 largest body 61.6-72.5 M♃ by 50yr, 0 living worlds after 300yr; LIFE_MIN=10 units≈0.87 M♃ (index.html:460); rocky look only below 2 units (660-664) (merged DESIGN-005) |
| PHYS-003 | physics | Comets shed dust forever and exhaust the dust budget | 3 | 2 | 1.50 | index.html:1172-1181,1576; one comet 811 grains at 10yr → 7,201 at 100yr (capped) |
| CODE-005 | code | Changing tool mid-throw changes what gets thrown | 3 | 2 | 1.50 | index.html:1506,1521,1534,1572,1588,2361,2394,1862 (all read global `tool`) |
| CODE-003 | code | Tests/bench copy engine constants and maths instead of reading them from the hook | 3 | 2 | 1.50 | invariants.js:15,55-56,69; bench/scenes.js:22-30,42; harness.js:30; run_tests.py:48 |
| UX-005 | ux | Touch targets under 44px on phones | 3 | 2 | 1.50 | measured Pixel 7: help/restart 29×34, Auto-orbit 31×34, dock chips 34px (index.html:315), slider 22px, Follow/Close 28px (index.html:156) |
| UX-003 | ux | Help teaches only throwing; shortcuts, Warp and Zones are only in tooltips | 3 | 2 | 1.50 | scratch\ux\pixel-help.png, desktop-help.png; index.html:1812-1814 |
| EFF-002 | efficiency | Static backdrop is a full-res offscreen canvas (~20MB at DPR 2) blitted every frame | 3 | 2 | 1.50 | index.html:1445-1463,2503; measured 21.0MB offscreen canvases at 1440×900 DPR2 (backdrop 19.8MB) |
| DESIGN-008 | design | Civilizations' probes can seed life (panspermia) | 3 | 2 | 1.50 | index.html:1162-1167,797; probes are ordinary dust, dust only interacts with bodies ≥400 units |
| DESIGN-010 | design | New scene: rogue black hole through a living system | 3 | 2 | 1.50 | Cradle is the only scene with life and nothing threatens it |
| CODE-002 | code | No tests for life stages, supernovae, ignition, comet shedding, keyboard fallbacks, dust cap, scene blurbs | 4 | 3 | 1.33 | harness.js/invariants.js never touch updateLife (1131-1170), supernova (1003-1040), ignition (912-921), shedComets (1172-1181), dust cap (1576); harness.js:29 never sends `code` so index.html:2009-2029 fallbacks never run |
| DESIGN-007 | design | Snapshot link for a universe you built | 4 | 3 | 1.33 | index.html:1567; nothing thrown in Empty space survives a reload; no storage (builds on DESIGN-001) |
| CODE-008 | code | Zero-sized canvas at start never recovers scene framing; resize wired twice | 2 | 2 | 1.00 | index.html:1412-1413,2686-2689,2721 |
| CODE-009 | code | `lights` and primed accelerations recomputed ad hoc and go stale within a frame | 2 | 2 | 1.00 | index.html:1410,1601,2646,2711 (lights); 1408,1602,2711 (accel); ignition (914), supernova (1006), shred/cull don't update lights |
| PERF-005 | perf | cull()→mainGroup() is O(n²): a 3-5ms hitch every 30 frames on 1,000 bodies | 2 | 2 | 1.00 | large: 10/300 frames at 5.1-7.7ms vs 2.7 median, cadence frameN%30 (index.html:2648,1059-1066,1090-1093) |
| PHYS-006 | physics | Comet-delivery bonus ignores whether the world can hold life | 1 | 1 | 1.00 | index.html:907-909 (no DWARF or zone check) |
| PHYS-008 | physics | Galaxies' core black holes below the tool's 3 M☉ minimum; toy-scale inspector units | 1 | 1 | 1.00 | index.html:1241-1242,1496; inspector shows "Horizon 7.4km" |
| UX-009 | ux | Tablet dock: stray separator at the end of the first row | 1 | 1 | 1.00 | scratch\ux\tablet-820x1180.png; index.html:302 (.sep hidden only ≤720px) |
| UX-103 | ux | "Nothing here yet" blurb stays up after you've placed things | 1 | 1 | 1.00 | scratch\playtest\shots\desktop-01-sun-planet-autoorbit.png, phone-01-sun-planet-autoorbit.png; index.html:1389,1857 |
| CODE-013 | code | Misleading names and a stale comment | 1 | 1 | 1.00 | index.html:1142 (b.hz), 537 (T), 2057 vs 563 (local `pick` shadows global), 551-552 (stale comment) |
| EFF-004 | efficiency | Long-run bench can't see likely growth sources (broader soak shows no leak) | 2 | 2 | 1.00 | run_bench.py:63,92 (heap only after forced GC); long-run scene has no BH/supernova/throws/reloads; soak: heap flat, sprite cache ~80 keys |
| EFF-005 | efficiency | Avoidable per-frame allocations: trail strokes/colours, sprite lookups, array filters | 2 | 2 | 1.00 | drawTrail index.html:2066-2082 (largest JS self-time, 0.55ms medium/1.4ms large; batching measured large JS render 2.16→1.19ms); glowSprite per effect (2557); HB=bodies.filter per substep (797); lights filter per frame (2646); 3 rgba strings per body per frame (2080); GC measured only 0.02ms/frame so low priority (merged PERF-004) |

## In progress

## Done

| ID | Title | Result (metric delta / notes) | Commit |
|----|-------|-------------------------------|--------|
| PERF-002 | Parallax star tile bilinearly resampled every frame | The star-tile parallax draw now sets `imageSmoothingEnabled = false` around its `drawImage` calls (restored to `true` right after, so sprites/gradients are unaffected). 139/139 tests pass; playtester confirmed no visual regression. The original 64.0→37.1ms claim wasn't reproduced in headless Chromium bench (measured no meaningful difference there, ~53-66ms either way) — the benefit needs checking on a real phone or a dpr-2 profile before treating it as proven. Benchmark baseline was re-recorded a third time this session (bench/baseline.json) after confirming via a stash/pop A/B test that this machine has genuinely slowed down over the session (unrelated to any code change); Luke was informed and chose to re-baseline. | ae4cd7e |
| DESIGN-002 | Per-scene starting speed so Cradle/Formation pay off in seconds | Cradle/Formation now start the speed slider at rate 60 instead of RATE_DEFAULT (4), so their first payoff shows within seconds instead of ~162s; restart preserves a manually-set rate (loadScene(key, isRestart)); other scenes unaffected. 136/136 tests pass. Benchmark baseline was also re-recorded separately (commit f97f29c) after run-to-run machine noise (unrelated to this change) was flagging false regressions against the first baseline sample. | 44c05f8 |

## Rejected / won't do

| ID | Title | Reason |
|----|-------|--------|
| PERF-006 | bodies→typed arrays / opaque canvas | Measured, no gain: accel 0.185 vs 0.211ms (n=300), 2.37 vs 2.33ms (n=1000) (scratch\perf\soa.py); alpha:false 128.6→128.1ms; GC 0.02ms/frame. Render is ≥95% of frame time. Revisit only as a Barnes-Hut A/B if 1,000 bodies at high speed becomes a goal. |
| UX-010 | Wide title in WebKit screenshots | test-browser quirk; noted for reviewers |
