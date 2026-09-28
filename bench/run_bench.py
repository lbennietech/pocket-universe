#!/usr/bin/env python3
"""
Pocket Universe: performance benchmarks
Copyright (c) 2026 Luke Bennie <lukebennie@gmail.com>. All rights reserved.

Loads the real index.html in headless Chromium with Playwright, builds seeded
scenes (bench/scenes.js) and drives whole frames through the test hook,
timing each one. Budgets live in CLAUDE.md under "Targets & design pillars".

    python bench/run_bench.py                 # run, write bench/results/latest.json
    python bench/run_bench.py --compare       # same-session A/B against the upstream index.html
    python bench/run_bench.py --compare --against baseline   # compare with bench/baseline.json
    python bench/run_bench.py --baseline      # run and save as the new baseline
    python bench/run_bench.py --compare --no-run   # re-check the last run without re-running
    options: --threshold 0.05  --scenes small,medium  --quick  --repeats N  --ref <git ref or file>

Timed scenes run several times (REPEATS; long-run LONG_RUN_REPEATS), interleaved
round-robin so a machine that slows down mid-run affects every scene alike.
Every metric, heap growth included, is the median across those runs; only
NaN/Infinity counts from any run. The phone profile has its own browser
context with a real phone's viewport and pixel density (412x915 at 2.625x)
and a 4x slower CPU.

--compare is a same-session A/B test. It benchmarks the reference index.html
(`git show <ref>:index.html`, where ref is the upstream branch, normally
origin/main, or HEAD without one) and the working copy side by side, one
after the other in every round, in one browser session, with the working
copy's bench/scenes.js for both. So drift between sessions (a laptop running
hotter or cooler) cancels out. If the reference can't run the current scenes
(for example its test hook lacks something they need), it says so and falls
back to bench/baseline.json.

Budget-only checks run once, on the working copy: long-run (heap growth over
~9,000 steps), soak (scene reloads, throws, merges, supernovae and black holes,
heap growth plus the counters that would explain it) and the file size.

Results record the method and a hash of the scenario definitions (RUNS,
PROFILES, the soak and bench/scenes.js). Comparing with a stored baseline
refuses runs measured differently or on different scenarios, and --baseline
only saves a full run measured the default way.

Needs: pip install playwright && python -m playwright install chromium
Exit code 1 when --compare finds a regression over the threshold, or the
size budget is broken.
"""
import argparse
import datetime
import gzip
import hashlib
import json
import statistics
import subprocess
import sys
import tempfile
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

SIZE_BUDGET_KB = 45.0
HEAP_GROWTH_BUDGET_MB = 5.0

# browser context per profile; the canvas is sized by viewport x devicePixelRatio (capped at 2)
PROFILES = {
    "desktop": {"viewport": {"width": 1280, "height": 800}},
    "phone": {"viewport": {"width": 412, "height": 915}, "device_scale_factor": 2.625,
              "is_mobile": True, "has_touch": True},
}
# name: (bench scene, frames measured, warm-up frames, rate in sim units/s, CPU slowdown, profile)
RUNS = {
    "small": ("small", 240, 30, 4, 1, "desktop"),
    "medium": ("medium", 240, 30, 4, 1, "desktop"),
    "large": ("large", 120, 20, 4, 1, "desktop"),
    "collision-pileup": ("collision-pileup", 240, 10, 8, 1, "desktop"),
    "medium-fast": ("medium", 240, 30, 60, 1, "desktop"),    # rate 60, as Cradle and Formation start
    "long-run": ("long-run", 3000, 30, 15.3, 1, "desktop"),  # about 3 steps a frame: ~9,000 steps
    "medium-phone": ("medium", 120, 20, 4, 4, "phone"),      # a real phone's pixels, 4x slower CPU
}
BUDGET_ONLY = ("long-run",)   # measured for heap growth on the working copy only, never A/B'd
# soak: cycles through real scenes, throwing bodies, colliding stars into supernovae and
# black holes, and reloading. Heap is read after a forced GC, after WARM cycles and at the end.
SOAK = {"scenes": ["galaxies", "cradle", "feast", "eight", "formation", "binary", "mayhem"],
        "warm_cycles": 7, "cycles": 14, "frames": 60, "rate": 60, "timer_wait_s": 11}
# metrics compared (lower is better)
COMPARED = ("mean_ms", "p95_ms", "physics_ms", "render_ms")
REPEATS = 5            # runs per scene by default; each metric is the median across them
LONG_RUN_REPEATS = 3   # long-run is slow (~9,000 steps), so it's capped at this many runs
MEDIANED = ("mean_ms", "p95_ms", "max_ms", "physics_ms", "render_ms", "heap_growth_mb")
FLOOR_MS = 0.25        # sub-millisecond metrics are too noisy for a percentage gate


def repeats_for(name, repeats):
    return min(repeats, LONG_RUN_REPEATS) if name == "long-run" else repeats


def method(repeats, quick):
    """How a run was measured. Only runs measured the same way are compared."""
    if quick:
        return "quick: single run"
    return (f"median of {repeats} interleaved runs ({repeats_for('long-run', repeats)} for long-run); "
            f"soak: one run")


DEFAULT_METHOD = method(REPEATS, False)


def scenario_hash():
    """Changes whenever the scenario definitions do, so stale baselines aren't compared."""
    scenes = (BENCH / "scenes.js").read_text(encoding="utf-8").replace("\r\n", "\n")
    blob = json.dumps([RUNS, PROFILES, SOAK], sort_keys=True) + scenes
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()[:12]


def git(*args):
    try:
        out = subprocess.run(["git", *args], cwd=ROOT, capture_output=True)
    except OSError:
        return None
    return out.stdout if out.returncode == 0 else None


def reference(ref):
    """(label, index.html bytes) for the A/B reference: a file, a git ref, or the upstream."""
    if ref and Path(ref).is_file():
        return f"file {ref}", Path(ref).read_bytes()
    if not ref:
        up = git("rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}")
        ref = up.decode().strip() if up else "HEAD"
    commit = git("rev-parse", "--short", ref)
    html = git("show", f"{ref}:index.html")
    if commit is None or html is None:
        return None, None
    return f"{ref} ({commit.decode().strip()})", html


def percentile(xs, q):
    xs = sorted(xs)
    return xs[min(len(xs) - 1, int(round(q * (len(xs) - 1))))]


class Side:
    """One index.html, with a page (and CDP session) per profile, in one shared browser."""

    def __init__(self, browser, url, init, profiles):
        self.pages = {}
        for prof in profiles:
            ctx = browser.new_context(**PROFILES[prof])
            page = ctx.new_page()
            page.add_init_script(init)
            page.goto(url)
            page.wait_for_function("() => window.__pu && window.__puBuild")
            page.evaluate("() => window.__pu.stopLoop()")   # idle pages mustn't steal CPU
            cdp = ctx.new_cdp_session(page)
            cdp.send("HeapProfiler.enable")
            self.pages[prof] = (page, cdp)

    def probe(self, names):
        """Why this page can't run the given scenes, or None if it can."""
        for name in names:
            scene, rate, prof = RUNS[name][0], RUNS[name][3], RUNS[name][5]
            page = self.pages[prof][0]
            try:
                page.evaluate("""([s, r]) => { window.__puBuild(s, 1); const P = window.__pu;
                    P.setRate(r); P.perf.on = true; P.tick(1); P.perf.on = false;
                    if (!(P.perf.physics >= 0) || !(P.perf.render >= 0)) throw new Error('no perf timings'); }""",
                              [scene, rate])
            except PlaywrightError as e:
                return f"{name}: {str(e).splitlines()[0]}"
        return None


def measure(side, name, quick, seed=1):
    scene, frames, warm, rate, slow, prof = RUNS[name]
    if quick:
        frames = max(30, frames // 4)
    page, cdp = side.pages[prof]
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


SOAK_CYCLE = """([scene, cycle, frames, rate]) => {
    const P = window.__pu, M = P.MSUN;
    if (!window.__puSoakFeed) {   // count every feed entry ever added (the feed keeps only 4)
      window.__puSoakFeed = 0;
      new MutationObserver(ms => { for (const m of ms) window.__puSoakFeed += m.addedNodes.length; })
        .observe(document.getElementById('feed'), { childList: true });
    }
    P.stopLoop();
    P.loadScene(scene);
    P.seed(cycle + 1);
    P.setRate(rate);
    // aim everything at the heaviest body: fast planets, then two 12 M☉ stars
    // colliding head-on (24 M☉ collapses: a supernova, then a black hole), and a black hole
    const c = P.bodies.reduce((a, b) => (!a || b.m > a.m ? b : a), null) || { x: 0, y: 0, vx: 0, vy: 0 };
    for (let i = 0; i < 6; i++) {
      const a = i * 1.047;
      P.addBody(P.makeBody(c.x + Math.cos(a) * 900, c.y + Math.sin(a) * 900,
        c.vx - Math.cos(a) * 40, c.vy - Math.sin(a) * 40, 5 + i * 30, 'planet'));
    }
    P.addBody(P.makeBody(c.x - 60, c.y + 1500, c.vx + 15, c.vy, 12 * M, 'star'));
    P.addBody(P.makeBody(c.x + 60, c.y + 1500, c.vx - 15, c.vy, 12 * M, 'star'));
    P.addBody(P.makeBody(c.x + 2500, c.y - 800, c.vx - 25, c.vy + 8, 30 * M, 'bh'));
    P.settle();
    P.tick(frames);
    let bad = 0, bh = 0;
    for (const b of P.bodies) { if (!isFinite(b.x + b.y + b.vx + b.vy)) bad++; if (b.kind === 'bh') bh++; }
    return { bad, bh };
}"""
SOAK_COUNTERS = """() => ({ sprites: window.__pu.sprites, effects: window.__pu.effects,
    feedNodes: document.getElementById('feed').children.length, feedAdded: window.__puSoakFeed,
    domNodes: document.getElementsByTagName('*').length, bodies: window.__pu.bodies.length })"""


def soak(side, quick):
    """Budget check: heap growth across reloads, throws, merges, supernovae and black holes."""
    page, cdp = side.pages["desktop"]
    cycles = 7 if quick else SOAK["cycles"]
    scenes, bad, bh_cycles = SOAK["scenes"], 0, 0
    def cycle(i):
        nonlocal bad, bh_cycles
        r = page.evaluate(SOAK_CYCLE, [scenes[i % len(scenes)], i, SOAK["frames"], SOAK["rate"]])
        bad += r["bad"]
        bh_cycles += r["bh"] > 0
    heap = lambda: cdp.send("Runtime.getHeapUsage")["usedSize"] / 2**20
    for i in range(SOAK["warm_cycles"]):
        cycle(i)
    cdp.send("HeapProfiler.collectGarbage")
    heap0, c0 = heap(), page.evaluate(SOAK_COUNTERS)
    bh_cycles = 0   # count black holes over the measured cycles only (NaN counts from any)
    for i in range(SOAK["warm_cycles"], SOAK["warm_cycles"] + cycles):
        cycle(i)
    page.evaluate("() => window.__pu.loadScene('empty')")
    page.wait_for_timeout(SOAK["timer_wait_s"] * 1000)   # let the feed's removal timers fire
    cdp.send("HeapProfiler.collectGarbage")
    heap1, c1 = heap(), page.evaluate(SOAK_COUNTERS)
    return {"cycles": cycles, "heap_start_mb": round(heap0, 2), "heap_end_mb": round(heap1, 2),
            "heap_growth_mb": round(heap1 - heap0, 2), "cycles_with_black_hole": bh_cycles,
            "sprites_start": c0["sprites"], "sprites_end": c1["sprites"],
            "feed_entries_added": c1["feedAdded"] - c0["feedAdded"], "feed_nodes_end": c1["feedNodes"],
            "dom_nodes_start": c0["domNodes"], "dom_nodes_end": c1["domNodes"],
            "effects_end": c1["effects"], "non_finite": bad}


def combine(runs):
    """One result from several runs of a scene: the median of every metric, but any NaN counts."""
    by_growth = sorted(runs, key=lambda r: r["heap_growth_mb"])
    out = dict(by_growth[len(by_growth) // 2])   # heap start/end come from the median-growth run
    for m in MEDIANED:
        out[m] = round(statistics.median(r[m] for r in runs), 3)
    out["non_finite"] = max(r["non_finite"] for r in runs)
    out["runs"] = len(runs)
    return out


def print_scene(name, r, tag=""):
    print(f"{tag}{name:18} mean {r['mean_ms']:7.2f} ms  p95 {r['p95_ms']:7.2f}  "
          f"physics {r['physics_ms']:6.2f}  render {r['render_ms']:6.2f}  "
          f"heap {r['heap_growth_mb']:+.2f} MB  bodies {r['bodies_end']}  ({r['runs']} runs)")


def run(selected, quick, repeats, with_soak, ref=None):
    """Benchmark the working copy; with ref=(label, html), also the reference, interleaved (A/B)."""
    # Normalize CRLF -> LF: on Windows with core.autocrlf=true, the working-copy
    # file has CRLF line endings, but git stores (and GitHub Pages serves) LF, so
    # measuring the raw working-copy bytes overstates the gzip size that ships.
    html = (ROOT / "index.html").read_bytes().replace(b"\r\n", b"\n")
    init = "window.__PU_TEST__ = true;\n" + (BENCH / "scenes.js").read_text(encoding="utf-8")
    out = {"scenes": {}}
    reps = {name: 1 if quick else repeats_for(name, repeats) for name in selected}
    profiles = sorted({RUNS[n][5] for n in selected} | ({"desktop"} if with_soak else set()))
    timed = [n for n in selected if n not in BUDGET_ONLY]
    with sync_playwright() as pw, tempfile.TemporaryDirectory() as tmp:
        try:
            browser = pw.chromium.launch()
        except PlaywrightError:
            sys.exit("Chromium isn't installed for Playwright. Run: python -m playwright install chromium")
        work = Side(browser, (ROOT / "index.html").as_uri(), init, profiles)
        sides = {"work": work}
        if ref and timed:
            ref_file = Path(tmp) / "index.html"
            ref_file.write_bytes(ref[1])
            try:
                side = Side(browser, ref_file.as_uri(), init, sorted({RUNS[n][5] for n in timed}))
                why = side.probe(timed)
            except PlaywrightError as e:
                why = str(e).splitlines()[0]
            if why:
                print(f"WARNING: the reference index.html ({ref[0]}) can't run the current bench scenes "
                      f"({why}).\nWARNING: falling back to comparing with bench/baseline.json.\n")
                out["reference_unusable"] = f"{ref[0]}: {why}"
            else:
                sides["ref"] = side
                print(f"A/B: reference {ref[0]} against the working copy, interleaved\n")
        runs = {(s, n): [] for s in sides for n in selected if s == "work" or n in timed}
        # round-robin: every scene (and side) gets one run per round, so slow-downs spread
        # evenly; the side that goes first alternates, so neither is favoured
        for i in range(max(reps.values(), default=0)):
            for k, name in enumerate(selected):
                if i >= reps[name]:
                    continue
                order = [s for s in (("ref", "work") if (i + k) % 2 == 0 else ("work", "ref"))
                         if (s, name) in runs]
                for s in order:
                    runs[(s, name)].append(measure(sides[s], name, quick))
        for name in selected:
            for s in ("ref", "work"):
                if (s, name) not in runs:
                    continue
                r = combine(runs[(s, name)])
                r["rate"], r["cpu_slowdown"], r["profile"] = RUNS[name][3], RUNS[name][4], RUNS[name][5]
                if s == "work":
                    out["scenes"][name] = r
                else:
                    out.setdefault("reference", {"ref": ref[0], "scenes": {}})["scenes"][name] = r
                print_scene(name, r, "ref  " if s == "ref" else ("work " if "ref" in sides else ""))
        if with_soak:
            out["soak"] = s = soak(work, quick)
            print(f"{'soak':18} {s['cycles']} cycles  heap {s['heap_growth_mb']:+.2f} MB  "
                  f"sprites {s['sprites_start']}->{s['sprites_end']}  feed entries {s['feed_entries_added']} "
                  f"(nodes {s['feed_nodes_end']})  DOM {s['dom_nodes_start']}->{s['dom_nodes_end']}  "
                  f"black holes in {s['cycles_with_black_hole']} cycles")
        out["meta"] = {"browser": "chromium " + browser.version, "method": method(repeats, quick),
                       "scenarios": scenario_hash()}
        browser.close()
    out["size"] = {"index_html_kb": round(len(html) / 1024, 1),
                   "index_html_gzip_kb": round(len(gzip.compress(html, 9)) / 1024, 1)}
    commit = git("rev-parse", "--short", "HEAD")
    out["meta"].update({"date": datetime.datetime.now().isoformat(timespec="seconds"),
                        "commit": commit.decode().strip() if commit else ""})
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
    if "soak" in res:
        k = res["soak"]
        line("soak heap growth", k["heap_growth_mb"] <= HEAP_GROWTH_BUDGET_MB,
             f"{k['heap_growth_mb']:+} MB over {k['cycles']} cycles (sprite cache {k['sprites_end']}, "
             f"feed nodes {k['feed_nodes_end']})")
        if k["non_finite"]:
            line("soak numbers", False, f"{k['non_finite']} bodies with NaN/Infinity", hard=True)
    for name, r in s.items():
        if r["non_finite"]:
            line(f"{name} numbers", False, f"{r['non_finite']} bodies with NaN/Infinity", hard=True)
    line("size", res["size"]["index_html_gzip_kb"] <= SIZE_BUDGET_KB,
         f"{res['size']['index_html_gzip_kb']} KB gzipped", hard=True)
    print("\nBudgets (miss = recorded for the backlog, FAIL = blocks):")
    print("\n".join(lines))
    return ok


def gate(latest, base, threshold, base_label, latest_label):
    """Compare the timed scenes of two results; False on a regression over the threshold."""
    print(f"  {'scene':18} {'metric':11} {base_label:>9} {latest_label:>9} {'change':>8}")
    ok = True
    for name, r in latest.items():
        b = base.get(name)
        if not b or name in BUDGET_ONLY:
            continue
        for m in COMPARED:
            if b[m] <= 0:
                continue
            change = (r[m] - b[m]) / b[m]
            regressed = change > threshold and r[m] - b[m] > FLOOR_MS
            ok = ok and not regressed
            flag = "  REGRESSION" if regressed else ""
            print(f"  {name:18} {m:11} {b[m]:9.2f} {r[m]:9.2f} {change:+8.1%}{flag}")
    print("\nNo regressions." if ok else "\nRegression over the threshold: fix it or explain why before pushing.")
    return ok


def compare_ab(res, threshold):
    ref = res["reference"]
    print(f"\nA/B in one session: reference {ref['ref']} against the working copy, threshold {threshold:.0%} "
          f"(and at least {FLOOR_MS} ms):")
    return gate(res["scenes"], ref["scenes"], threshold, "reference", "working")


def compare_baseline(res, threshold):
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
    if base["meta"].get("scenarios") != res["meta"].get("scenarios"):
        print(f"\nThe baseline's scenario definitions ({base['meta'].get('scenarios', 'unrecorded')}) differ from "
              f"this run's ({res['meta'].get('scenarios')}): RUNS, PROFILES, SOAK or bench/scenes.js changed. "
              f"Re-record the baseline with --baseline (on unchanged game code) to compare.")
        return False
    print(f"\nCompared with baseline {base['meta'].get('commit', '?')} ({base['meta'].get('date', '?')}), "
          f"threshold {threshold:.0%}:")
    return gate(res["scenes"], base["scenes"], threshold, "baseline", "latest")


def main():
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--compare", action="store_true")
    ap.add_argument("--against", choices=("reference", "baseline"), default="reference",
                    help="what --compare compares with: the reference index.html in the same session "
                         "(default) or the stored bench/baseline.json")
    ap.add_argument("--ref", help="reference for the A/B: a git ref or an index.html file "
                                  "(default: the upstream branch, or HEAD without one)")
    ap.add_argument("--baseline", action="store_true")
    ap.add_argument("--no-run", action="store_true", help="reuse bench/results/latest.json")
    ap.add_argument("--threshold", type=float, default=0.05)
    ap.add_argument("--scenes", default=",".join(RUNS) + ",soak")
    ap.add_argument("--quick", action="store_true", help="fewer frames, one run (not comparable, not for baselines)")
    ap.add_argument("--repeats", type=int, default=REPEATS,
                    help=f"runs per scene (default {REPEATS}); use 1 for a quick single reading, e.g. heap growth")
    a = ap.parse_args()
    if a.repeats < 1:
        sys.exit("--repeats must be at least 1.")
    ab = a.compare and a.against == "reference"
    if a.no_run:
        res = json.loads(LATEST.read_text(encoding="utf-8"))
    else:
        names = [n.strip() for n in a.scenes.split(",") if n.strip()]
        unknown = [n for n in names if n not in RUNS and n != "soak"]
        if unknown:
            sys.exit(f"Unknown scenes: {unknown}. Known: {list(RUNS) + ['soak']}")
        ref = None
        if ab:
            ref = reference(a.ref)
            if ref[1] is None:
                print(f"WARNING: couldn't read the reference index.html ({a.ref or 'upstream'}) from git.\n"
                      f"WARNING: falling back to comparing with bench/baseline.json.\n")
                ref = None
        res = run([n for n in names if n != "soak"], a.quick, a.repeats, "soak" in names, ref)
        RESULTS.mkdir(exist_ok=True)
        LATEST.write_text(json.dumps(res, indent=2), encoding="utf-8")
    ok = budgets(res)
    # compare against the old baseline before a new one replaces it
    if a.compare:
        if ab and "reference" in res:
            ok = compare_ab(res, a.threshold) and ok
        else:
            if ab:
                print("\nWARNING: no same-session reference results: comparing with the stored baseline instead, "
                      "so drift between sessions can show up as a regression.")
            ok = compare_baseline(res, a.threshold) and ok
    if a.baseline:
        got = res["meta"].get("method")
        if got != DEFAULT_METHOD:
            sys.exit(f"Refusing to save a run measured as \"{got}\" as the baseline: "
                     f"baselines must be measured as \"{DEFAULT_METHOD}\" (a full run, no --quick or --repeats).")
        missing = [n for n in RUNS if n not in res["scenes"]] + ([] if "soak" in res else ["soak"])
        if missing:
            sys.exit(f"Refusing to save a partial run as the baseline (missing: {', '.join(missing)}).")
        base = {k: v for k, v in res.items() if k not in ("reference", "reference_unusable")}
        BASELINE.write_text(json.dumps(base, indent=2), encoding="utf-8")
        print(f"\nSaved {BASELINE.relative_to(ROOT)}")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
