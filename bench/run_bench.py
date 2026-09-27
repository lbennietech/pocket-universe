#!/usr/bin/env python3
"""
Pocket Universe: performance benchmarks
Copyright (c) 2026 Luke Bennie <lukebennie@gmail.com>. All rights reserved.

Loads the real index.html in headless Chromium with Playwright, builds seeded
scenes (bench/scenes.js) and drives whole frames through the test hook,
timing each one. Budgets live in CLAUDE.md under "Targets & design pillars".

    python bench/run_bench.py                 # run, write bench/results/latest.json
    python bench/run_bench.py --compare       # run, then compare with bench/baseline.json
    python bench/run_bench.py --baseline      # run and save as the new baseline
    python bench/run_bench.py --compare --no-run   # compare the last run without re-running
    options: --threshold 0.05  --scenes small,medium  --quick  --repeats N

Each scene runs several times (REPEATS; long-run LONG_RUN_REPEATS), interleaved
round-robin across the scenes so a machine that slows down mid-run affects
every scene alike. Every metric, heap growth included, is the median across
those runs, so a single lucky or unlucky run (a cold first round, a late
garbage collection) can't set the result. The only exception is NaN/Infinity,
where any run counts. The method is recorded in the results. --compare refuses
to compare runs measured different ways, and --baseline only saves a full run
measured the default way.

Medians keep noise within one session out of the comparison. They can't remove
drift between sessions (a laptop running cooler or hotter than when the
baseline was recorded), so a failed --compare still needs a stash/pop A/B test
before blaming the change.

Needs: pip install playwright && python -m playwright install chromium
Exit code 1 when --compare finds a regression over the threshold, or the
size budget is broken.
"""
import argparse
import datetime
import gzip
import json
import statistics
import subprocess
import sys
from pathlib import Path

try:
    from playwright.sync_api import Error as PlaywrightError
    from playwright.sync_api import sync_playwright
except ImportError:
    sys.exit("Playwright isn't installed. Run: pip install playwright && python -m playwright install chromium")

ROOT = Path(__file__).resolve().parent.parent
BENCH = ROOT / "bench"
RESULTS = BENCH / "results"
BASELINE = BENCH / "baseline.json"
LATEST = RESULTS / "latest.json"

SIZE_BUDGET_KB = 40.0
HEAP_GROWTH_BUDGET_MB = 5.0

# name: (bench scene, frames measured, warm-up frames, rate in sim units/s, CPU slowdown)
RUNS = {
    "small": ("small", 240, 30, 4, 1),
    "medium": ("medium", 240, 30, 4, 1),
    "large": ("large", 120, 20, 4, 1),
    "collision-pileup": ("collision-pileup", 240, 10, 8, 1),
    "long-run": ("long-run", 3000, 30, 15.3, 1),       # about 3 steps a frame: ~9,000 steps
    "medium-phone": ("medium", 120, 20, 4, 4),         # the phone profile: 4x slower CPU
}
# metrics compared against the baseline (lower is better)
COMPARED = ("mean_ms", "p95_ms", "physics_ms", "render_ms")
REPEATS = 5            # runs per scene by default; each metric is the median across them
LONG_RUN_REPEATS = 3   # long-run is slow (~9,000 steps), so it's capped at this many runs
MEDIANED = ("mean_ms", "p95_ms", "max_ms", "physics_ms", "render_ms", "heap_growth_mb")


def repeats_for(name, repeats):
    return min(repeats, LONG_RUN_REPEATS) if name == "long-run" else repeats


def method(repeats, quick):
    """How a run was measured. Only runs measured the same way are compared."""
    if quick:
        return "quick: single run"
    return f"median of {repeats} interleaved runs ({repeats_for('long-run', repeats)} for long-run)"


DEFAULT_METHOD = method(REPEATS, False)


def percentile(xs, q):
    xs = sorted(xs)
    return xs[min(len(xs) - 1, int(round(q * (len(xs) - 1))))]


def measure(page, cdp, scene, frames, warm, rate, slow, seed=1):
    page.evaluate("([s, seed]) => window.__puBuild(s, seed)", [scene, seed])
    page.evaluate("r => window.__pu.setRate(r)", rate)
    cdp.send("Emulation.setCPUThrottlingRate", {"rate": slow})
    cdp.send("HeapProfiler.collectGarbage")
    heap0 = cdp.send("Runtime.getHeapUsage")["usedSize"]
    data = page.evaluate(
        """([frames, warm]) => {
            const P = window.__pu;
            // reading one pixel back makes the browser finish drawing the frame,
            // so the drawing cost lands in the frame that caused it
            const ctx = document.getElementById('sky').getContext('2d');
            const flush = () => ctx.getImageData(0, 0, 1, 1);
            P.perf.on = true;
            P.tick(warm);
            flush();
            const total = [], phys = [], rend = [];
            for (let i = 0; i < frames; i++) {
              const t = performance.now();
              P.tick(1);
              const t1 = performance.now();
              flush();
              const t2 = performance.now();
              total.push(t2 - t);
              phys.push(P.perf.physics); rend.push(P.perf.render + (t2 - t1));
            }
            P.perf.on = false;
            let bad = 0;
            for (const b of P.bodies) if (!isFinite(b.x + b.y + b.vx + b.vy)) bad++;
            return { total, phys, rend, bodies: P.bodies.length, dust: P.dust, nonFinite: bad, simTime: P.simTime };
        }""",
        [frames, warm],
    )
    cdp.send("HeapProfiler.collectGarbage")
    heap1 = cdp.send("Runtime.getHeapUsage")["usedSize"]
    cdp.send("Emulation.setCPUThrottlingRate", {"rate": 1})
    t = data["total"]
    return {
        "frames": frames,
        "mean_ms": round(statistics.fmean(t), 3),
        "p95_ms": round(percentile(t, 0.95), 3),
        "max_ms": round(max(t), 3),
        "physics_ms": round(statistics.fmean(data["phys"]), 3),
        "render_ms": round(statistics.fmean(data["rend"]), 3),
        "heap_start_mb": round(heap0 / 2**20, 2),
        "heap_end_mb": round(heap1 / 2**20, 2),
        "heap_growth_mb": round((heap1 - heap0) / 2**20, 2),
        "bodies_end": data["bodies"],
        "dust_end": data["dust"],
        "non_finite": data["nonFinite"],
    }


def combine(runs):
    """One result from several runs of a scene: the median of every metric, but any NaN counts."""
    by_growth = sorted(runs, key=lambda r: r["heap_growth_mb"])
    out = dict(by_growth[len(by_growth) // 2])   # heap start/end come from the median-growth run
    for m in MEDIANED:
        out[m] = round(statistics.median(r[m] for r in runs), 3)
    out["non_finite"] = max(r["non_finite"] for r in runs)
    out["runs"] = len(runs)
    return out


def run(selected, quick, repeats):
    html = (ROOT / "index.html").read_bytes()
    init = "window.__PU_TEST__ = true;\n" + (BENCH / "scenes.js").read_text(encoding="utf-8")
    out = {"scenes": {}}
    reps = {name: 1 if quick else repeats_for(name, repeats) for name in selected}
    with sync_playwright() as pw:
        try:
            browser = pw.chromium.launch()
        except PlaywrightError:
            sys.exit("Chromium isn't installed for Playwright. Run: python -m playwright install chromium")
        page = browser.new_page(viewport={"width": 1280, "height": 800})
        page.add_init_script(init)
        page.goto((ROOT / "index.html").as_uri())
        page.wait_for_function("() => window.__pu && window.__puBuild")
        cdp = page.context.new_cdp_session(page)
        cdp.send("HeapProfiler.enable")
        runs = {name: [] for name in selected}
        # round-robin: every scene gets one run per round, so slow-downs spread evenly
        for i in range(max(reps.values())):
            for name in selected:
                if i >= reps[name]:
                    continue
                scene, frames, warm, rate, slow = RUNS[name]
                if quick:
                    frames = max(30, frames // 4)
                runs[name].append(measure(page, cdp, scene, frames, warm, rate, slow))
        for name in selected:
            r = combine(runs[name])
            r["rate"], r["cpu_slowdown"] = RUNS[name][3], RUNS[name][4]
            out["scenes"][name] = r
            print(f"{name:18} mean {r['mean_ms']:7.2f} ms  p95 {r['p95_ms']:7.2f}  "
                  f"physics {r['physics_ms']:6.2f}  render {r['render_ms']:6.2f}  "
                  f"heap {r['heap_growth_mb']:+.2f} MB  bodies {r['bodies_end']}  ({r['runs']} runs)")
        out["meta"] = {"browser": "chromium " + browser.version, "method": method(repeats, quick)}
        browser.close()
    out["size"] = {"index_html_kb": round(len(html) / 1024, 1),
                   "index_html_gzip_kb": round(len(gzip.compress(html, 9)) / 1024, 1)}
    try:
        commit = subprocess.run(["git", "rev-parse", "--short", "HEAD"], cwd=ROOT,
                                capture_output=True, text=True).stdout.strip()
    except OSError:
        commit = ""
    out["meta"].update({"date": datetime.datetime.now().isoformat(timespec="seconds"), "commit": commit})
    print(f"{'size':18} {out['size']['index_html_gzip_kb']} KB gzipped (budget {SIZE_BUDGET_KB} KB)")
    return out


def budgets(res):
    """Report the CLAUDE.md budgets. Returns False only for hard budgets (size, NaN)."""
    ok = True
    s = res["scenes"]
    lines = []
    def line(label, good, text, hard=False):
        nonlocal ok
        mark = "ok  " if good else ("FAIL" if hard else "miss")
        if hard and not good:
            ok = False
        lines.append(f"  {mark}  {label}: {text}")
    if "medium" in s:
        line("everyday 60 fps", s["medium"]["mean_ms"] <= 16.6 and s["medium"]["p95_ms"] <= 20,
             f"mean {s['medium']['mean_ms']} ms, p95 {s['medium']['p95_ms']} ms")
    if "medium-phone" in s:
        line("phone 30 fps", s["medium-phone"]["mean_ms"] <= 33, f"mean {s['medium-phone']['mean_ms']} ms")
    if "large" in s:
        line("stretch 1,000 bodies at 60 fps", s["large"]["mean_ms"] <= 16.6, f"mean {s['large']['mean_ms']} ms")
    if "long-run" in s:
        line("long-run heap growth", s["long-run"]["heap_growth_mb"] <= HEAP_GROWTH_BUDGET_MB,
             f"{s['long-run']['heap_growth_mb']:+} MB")
    for name, r in s.items():
        if r["non_finite"]:
            line(f"{name} numbers", False, f"{r['non_finite']} bodies with NaN/Infinity", hard=True)
    line("size", res["size"]["index_html_gzip_kb"] <= SIZE_BUDGET_KB,
         f"{res['size']['index_html_gzip_kb']} KB gzipped", hard=True)
    print("\nBudgets (miss = recorded for the backlog, FAIL = blocks):")
    print("\n".join(lines))
    return ok


def compare(res, threshold):
    if not BASELINE.exists():
        print("\nNo bench/baseline.json yet: run with --baseline first.")
        return False
    base = json.loads(BASELINE.read_text(encoding="utf-8"))
    base_method = base["meta"].get("method", "fastest of 3 runs (before 2026-09-28)")
    run_method = res["meta"].get("method", "fastest of 3 runs (before 2026-09-28)")
    if base_method != run_method:
        if run_method != DEFAULT_METHOD:
            fix = "Run the benchmark again the default way (no --quick, --repeats or stale --no-run results) to compare."
        else:
            fix = "The baseline uses an outdated method: re-record it with --baseline."
        print(f"\nThe baseline was measured as \"{base_method}\" but this run as \"{run_method}\", "
              f"so they can't be compared fairly. {fix}")
        return False
    print(f"\nCompared with baseline {base['meta'].get('commit', '?')} ({base['meta'].get('date', '?')}), "
          f"threshold {threshold:.0%}:")
    print(f"  {'scene':18} {'metric':11} {'baseline':>9} {'latest':>9} {'change':>8}")
    ok = True
    for name, r in res["scenes"].items():
        b = base["scenes"].get(name)
        if not b:
            continue
        for m in COMPARED:
            if b[m] <= 0:
                continue
            change = (r[m] - b[m]) / b[m]
            # sub-millisecond metrics are too noisy for a percentage gate
            regressed = change > threshold and r[m] - b[m] > 0.25
            ok = ok and not regressed
            flag = "  REGRESSION" if regressed else ""
            print(f"  {name:18} {m:11} {b[m]:9.2f} {r[m]:9.2f} {change:+8.1%}{flag}")
    print("\nNo regressions." if ok else "\nRegression over the threshold: fix it or explain why before pushing.")
    return ok


def main():
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--compare", action="store_true")
    ap.add_argument("--baseline", action="store_true")
    ap.add_argument("--no-run", action="store_true", help="reuse bench/results/latest.json")
    ap.add_argument("--threshold", type=float, default=0.05)
    ap.add_argument("--scenes", default=",".join(RUNS))
    ap.add_argument("--quick", action="store_true", help="fewer frames, one run (not comparable, not for baselines)")
    ap.add_argument("--repeats", type=int, default=REPEATS,
                    help=f"runs per scene (default {REPEATS}); use 1 for a quick single reading, e.g. heap growth")
    a = ap.parse_args()
    if a.repeats < 1:
        sys.exit("--repeats must be at least 1.")
    if a.no_run:
        res = json.loads(LATEST.read_text(encoding="utf-8"))
    else:
        names = [n.strip() for n in a.scenes.split(",") if n.strip()]
        unknown = [n for n in names if n not in RUNS]
        if unknown:
            sys.exit(f"Unknown scenes: {unknown}. Known: {list(RUNS)}")
        res = run(names, a.quick, a.repeats)
        RESULTS.mkdir(exist_ok=True)
        LATEST.write_text(json.dumps(res, indent=2), encoding="utf-8")
    ok = budgets(res)
    # compare against the old baseline before a new one replaces it
    if a.compare:
        ok = compare(res, a.threshold) and ok
    if a.baseline:
        got = res["meta"].get("method")
        if got != DEFAULT_METHOD:
            sys.exit(f"Refusing to save a run measured as \"{got}\" as the baseline: "
                     f"baselines must be measured as \"{DEFAULT_METHOD}\" (a full run, no --quick or --repeats).")
        missing = [n for n in RUNS if n not in res["scenes"]]
        if missing:
            sys.exit(f"Refusing to save a partial run as the baseline (missing: {', '.join(missing)}).")
        BASELINE.write_text(json.dumps(res, indent=2), encoding="utf-8")
        print(f"\nSaved {BASELINE.relative_to(ROOT)}")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
