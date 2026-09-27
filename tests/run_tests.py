#!/usr/bin/env python3
"""
Pocket Universe: automated tests
Copyright (c) 2026 Luke Bennie <lukebennie@gmail.com>. All rights reserved.

Plays the game in headless Chrome with scripted mouse, touch and keyboard
input and checks what happens. Needs Python 3.10+ and Chrome or Edge; no
packages to install.

    python tests/run_tests.py             # input and simulation checks
    python tests/run_tests.py --screens   # also save screenshots to tests/output/

Set CHROME=/path/to/browser if it isn't found automatically.
Exits with 1 if any check fails or the page throws an error.
"""
import argparse
import base64
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TESTS = ROOT / "tests"
OUT = TESTS / "output"

# Runs before the game: turns on the test hook, drives animation frames from
# timers (headless Chrome's virtual time doesn't fire requestAnimationFrame)
# and records any uncaught error.
HEAD_SHIM = (
    "<script>window.__PU_TEST__=true;"
    "window.requestAnimationFrame=cb=>setTimeout(()=>cb(performance.now()),16);"
    "window.cancelAnimationFrame=id=>clearTimeout(id);"
    "window.__errs=[];addEventListener('error',e=>{window.__errs.push(e.message+' (line '+e.lineno+')');});"
    "</script>"
)

DESKTOP_SHOTS = [
    ("desktop-showcase", "scene=showcase"),
    ("desktop-galaxies", "scene=galaxies"),
    ("desktop-cradle", "scene=cradle&zoom=3"),
    ("desktop-feast", "scene=feast&zoom=2"),
    ("desktop-formation", "scene=formation&run=4000"),
]


def find_browser():
    env = os.environ.get("CHROME")
    if env and Path(env).exists():
        return env
    candidates = [
        r"C:\Program Files\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    ]
    for c in candidates:
        if Path(c).exists():
            return c
    for name in ("google-chrome", "chromium", "chromium-browser", "chrome", "msedge"):
        found = shutil.which(name)
        if found:
            return found
    sys.exit("Couldn't find Chrome or Edge. Set CHROME=/path/to/browser.")


def build_page(tmp):
    html = (ROOT / "index.html").read_text(encoding="utf-8")
    if "<head>" not in html or "</body>" not in html:
        sys.exit("index.html is missing <head> or </body>.")
    harness = (TESTS / "harness.js").read_text(encoding="utf-8")
    html = html.replace("<head>", "<head>\n" + HEAD_SHIM, 1)
    html = html.replace("</body>", "<script>\n" + harness + "\n</script>\n</body>", 1)
    page = tmp / "test.html"
    page.write_text(html, encoding="utf-8")
    return page


def run_browser(browser, url, tmp, name, size="1400,900", budget=30000, shot=None):
    """Load url headless and return the harness's PU_RESULTS object, or None."""
    profile = tmp / ("profile-" + name)
    args = [
        browser, "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
        "--user-data-dir=" + str(profile), "--allow-file-access-from-files",
        # Windows writes the console log to a file in the profile; elsewhere it goes to stderr
        "--enable-logging" if os.name == "nt" else "--enable-logging=stderr", "--v=0",
        "--virtual-time-budget=" + str(budget), "--window-size=" + size,
    ]
    if shot:
        args.append("--screenshot=" + str(shot))
    args.append(url)
    proc = subprocess.Popen(args, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
                            encoding="utf-8", errors="replace")
    # On Windows the launcher can exit while the headless browser keeps
    # running, so wait for the results (and the screenshot) to appear.
    log = profile / "chrome_debug.log"
    out, found = "", None
    deadline = time.time() + 240
    while time.time() < deadline:
        if proc.poll() is not None and not out:
            out = proc.stdout.read() or " "
        text = out + (log.read_text(encoding="utf-8", errors="replace") if log.exists() else "")
        found = found or re.search(r"PU_RESULTS ([A-Za-z0-9+/=]+)", text)
        shot_done = not shot or (Path(shot).exists() and Path(shot).stat().st_size > 0)
        if found and shot_done:
            break
        time.sleep(0.25)
    time.sleep(1)   # let the browser finish writing and exit
    if proc.poll() is None:
        proc.kill()
    return json.loads(base64.b64decode(found.group(1)).decode("utf-8")) if found else None


def functional(browser, page, tmp):
    res = run_browser(browser, page.as_uri() + "?mode=functional", tmp, "functional", shot=tmp / "functional.png")
    if not res:
        print("FAIL  the test page produced no results (it may not have loaded)")
        return False
    if res.get("crashed"):
        print("FAIL  the harness crashed:\n" + res["crashed"])
        return False
    ok = True
    for c in res["checks"]:
        mark = "ok  " if c["pass"] else "FAIL"
        ok = ok and c["pass"]
        print(f"{mark}  {c['name']}" + ("" if c["pass"] else f"   {json.dumps(c['detail'], ensure_ascii=False)}"))
    for e in res.get("errors", []):
        ok = False
        print("FAIL  page error: " + e)
    passed = sum(c["pass"] for c in res["checks"])
    print(f"\n{passed}/{len(res['checks'])} checks passed" + ("" if res.get("errors") == [] else ", page errors found"))
    return ok


def screens(browser, page, tmp):
    OUT.mkdir(exist_ok=True)
    for old in OUT.glob("*.png"):
        old.unlink()
    ok = True
    for name, query in DESKTOP_SHOTS:
        shot = OUT / (name + ".png")
        res = run_browser(browser, page.as_uri() + "?mode=visual&" + query, tmp, name, budget=40000, shot=shot)
        errs = (res or {}).get("errors", ["no results"])
        ok = ok and not errs
        print(f"saved {shot.relative_to(ROOT)}" + (f"   ERRORS: {errs}" if errs else ""))
    # Phones: iframes give exact 390 px and 600 px wide layouts, which a
    # headless window can't be made narrow enough to show.
    frame = tmp / "phones.html"
    src = page.as_uri() + "?mode=visual&scene=galaxies"
    frame.write_text(
        '<!doctype html><body style="margin:0;background:#333">'
        f'<iframe src="{src}" style="width:390px;height:844px;border:0;position:absolute;left:0;top:0"></iframe>'
        f'<iframe src="{src}&w=600" style="width:600px;height:844px;border:0;position:absolute;left:410px;top:0"></iframe>'
        "</body>", encoding="utf-8")
    shot = OUT / "phone-390-and-600.png"
    run_browser(browser, frame.as_uri(), tmp, "phones", size="1030,860", budget=8000, shot=shot)
    print(f"saved {shot.relative_to(ROOT)}")
    print("\nNote: desktop screenshots are scaled from a slightly smaller viewport, so circles look about 10% "
          "taller than wide. That's the screenshot, not the game. The phone image is not scaled.")
    return ok


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--screens", action="store_true", help="also save screenshots to tests/output/")
    args = ap.parse_args()
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")   # Windows consoles default to cp1252
    browser = find_browser()
    with tempfile.TemporaryDirectory(prefix="pu-tests-", ignore_cleanup_errors=True) as t:
        tmp = Path(t)
        page = build_page(tmp)
        ok = functional(browser, page, tmp)
        if args.screens:
            print()
            ok = screens(browser, page, tmp) and ok
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
