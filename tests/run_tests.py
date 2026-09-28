#!/usr/bin/env python3
"""
Pocket Universe: automated tests
Copyright (c) 2026 Luke Bennie <lukebennie@gmail.com>. All rights reserved.

Plays the real index.html with Playwright (Python):
  - in-page input checks (tests/harness.js) in Chromium, Firefox and WebKit
    (Safari's engine) at desktop size
  - real mouse input: drag to pan, Ctrl-drag to throw, click to inspect
  - emulated phones (Pixel 7 on Chromium, iPhone 13 on WebKit): touch wording,
    layout fits the screen, a real tap inspects, a real long press places
  - physics invariants (tests/invariants.js)

    python tests/run_tests.py                 # everything
    python tests/run_tests.py --screens       # also save screenshots to tests/output/
    python tests/run_tests.py --quick         # a few seconds: does the page load cleanly?
    python tests/run_tests.py --browsers chromium   # limit the browsers

Needs: pip install playwright && python -m playwright install chromium firefox webkit
Exits with 1 if any check fails or a page throws an error.
"""
import argparse
import json
import sys
from pathlib import Path

try:
    from playwright.sync_api import Error as PlaywrightError
    from playwright.sync_api import sync_playwright
except ImportError:
    sys.exit("Playwright isn't installed. Run: pip install playwright && python -m playwright install chromium firefox webkit")

ROOT = Path(__file__).resolve().parent.parent
TESTS = ROOT / "tests"
OUT = TESTS / "output"
PAGE = (ROOT / "index.html").as_uri()
DESKTOP = {"width": 1400, "height": 900}
PHONES = [("Pixel 7", "chromium"), ("iPhone 13", "webkit")]

# (file name, harness query) for desktop screenshots
DESKTOP_SHOTS = [
    ("desktop-showcase", "scene=showcase"),
    ("desktop-galaxies", "scene=galaxies"),
    ("desktop-cradle", "scene=cradle&zoom=1"),
    ("desktop-feast", "scene=feast"),
    ("desktop-formation", "scene=formation&run=4000"),
]

INIT = "window.__PU_TEST__ = true;\n" + (ROOT / "bench" / "scenes.js").read_text(encoding="utf-8") \
    + "\n" + (TESTS / "invariants.js").read_text(encoding="utf-8")
HARNESS = (TESTS / "harness.js").read_text(encoding="utf-8")
SCREEN_POS = """(pred) => window.__pu.toScreen(window.__pu.bodies.find(pred ? new Function('o', 'return ' + pred) : () => true))"""


def launch(pw, engine):
    """getattr(pw, engine).launch(), with a clear short error if that browser
    hasn't been installed, instead of a raw Playwright traceback."""
    try:
        return getattr(pw, engine).launch()
    except PlaywrightError:
        sys.exit(f"{engine.capitalize()} isn't installed for Playwright. Run: python -m playwright install {engine}")


class Results:
    def __init__(self):
        self.ok = True
        self.passed = 0
        self.total = 0

    def add(self, name, passed, detail=None):
        self.total += 1
        self.passed += bool(passed)
        self.ok = self.ok and bool(passed)
        suffix = "" if passed or detail is None else "   " + json.dumps(detail, ensure_ascii=False)
        print(f"{'ok  ' if passed else 'FAIL'}  {name}{suffix}", flush=True)


def open_page(browser, errors, url=PAGE, clock=True, **ctx):
    """A fresh page, on a fake clock unless clock=False; page errors go in `errors`."""
    context = browser.new_context(**ctx)
    page = context.new_page()
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("console", lambda m: m.type == "error" and errors.append("console: " + m.text))
    page.add_init_script(INIT)
    if clock:
        page.clock.install()
    page.goto(url)
    page.wait_for_function("() => window.__pu")
    return context, page


def pump(page, cond, limit_ms=240000, step=250):
    """Advance the fake clock until `cond` (a JS function) returns true."""
    waited = 0
    while not page.evaluate(cond):
        if waited >= limit_ms:
            return False
        page.clock.run_for(step)
        waited += step
    return True


def body_count(page):
    return page.evaluate("() => window.__pu.bodies.length")


def harness_checks(browser, name, res):
    errors = []
    context, page = open_page(browser, errors, PAGE + "?mode=functional", viewport=DESKTOP)
    page.add_script_tag(content=HARNESS)
    if not pump(page, "() => !!window.__puResults"):
        res.add(f"[{name}] harness finished", False, {"errors": errors[:5]})
    else:
        out = page.evaluate("() => window.__puResults")
        if out.get("crashed"):
            res.add(f"[{name}] harness ran", False, {"crash": out["crashed"]})
        for c in out.get("checks", []):
            res.add(f"[{name}] {c['name']}", c["pass"], c.get("detail"))
    res.add(f"[{name}] no page errors (scripted input)", not errors, errors[:5])
    context.close()


def real_mouse_checks(browser, name, res):
    errors = []
    context, page = open_page(browser, errors, viewport=DESKTOP)
    page.select_option("#scene", "empty")
    page.clock.run_for(300)
    cam0 = page.evaluate("() => window.__pu.cam.x")
    page.mouse.move(700, 450)
    page.mouse.down()
    page.mouse.move(760, 450, steps=6)
    page.mouse.move(820, 450, steps=6)
    page.mouse.up()
    page.clock.run_for(100)
    panned = page.evaluate("() => window.__pu.cam.x") < cam0 - 50
    res.add(f"[{name}] real mouse drag pans", panned and body_count(page) == 0)
    mod = "Meta" if sys.platform == "darwin" else "Control"
    page.keyboard.down(mod)
    page.mouse.move(500, 300)
    page.mouse.down()
    page.clock.run_for(600)
    page.mouse.move(520, 320, steps=5)
    page.mouse.up()
    page.keyboard.up(mod)
    page.clock.run_for(100)
    res.add(f"[{name}] real Ctrl-drag throws a planet", body_count(page) == 1, {"bodies": body_count(page)})
    if body_count(page):
        x, y = page.evaluate(SCREEN_POS, None)
        page.mouse.click(x, y)
        page.clock.run_for(200)
        res.add(f"[{name}] real click inspects", page.is_visible("#card"))
    res.add(f"[{name}] no page errors (real mouse)", not errors, errors[:5])
    context.close()


def phone_checks(pw, device, engine, res):
    errors = []
    browser = launch(pw, engine)
    context, page = open_page(browser, errors, **pw.devices[device])
    tag = f"[{device}]"
    page.clock.run_for(500)
    res.add(f"{tag} touch wording in the hint", "Touch and hold" in page.inner_text("#hint"))
    fits = page.evaluate("""() => {
        const w = innerWidth, bad = [];
        for (const el of document.querySelectorAll('.dock button, .dock input, #scene, #help, #restart')) {
          const r = el.getBoundingClientRect();
          if (r.width && (r.left < -1 || r.right > w + 1)) bad.push(el.id || el.textContent.trim() || el.tagName);
        }
        const h = document.getElementById('hint').getBoundingClientRect();
        if (h.left < -1 || h.right > w + 1) bad.push('hint');
        return { width: w, scrollWidth: document.documentElement.scrollWidth, offscreen: bad };
    }""")
    res.add(f"{tag} layout fits the screen", fits["scrollWidth"] <= fits["width"] and not fits["offscreen"], fits)
    # a real tap on the Sun in Cradle of life opens the inspector
    page.select_option("#scene", "cradle")
    page.clock.run_for(300)
    x, y = page.evaluate(SCREEN_POS, "o.kind === 'star'")
    page.tap("#sky", position={"x": x, "y": y})
    page.clock.run_for(300)
    res.add(f"{tag} real tap inspects", page.is_visible("#card"))
    card = page.evaluate("() => { const r = document.getElementById('card').getBoundingClientRect(); return [r.left, r.right, innerWidth]; }")
    res.add(f"{tag} inspector fits the screen", card[0] >= -1 and card[1] <= card[2] + 1, {"left": card[0], "right": card[1], "width": card[2]})
    if engine == "chromium":
        # a real long press (Chromium touch events) places a planet
        n0 = body_count(page)
        cdp = context.new_cdp_session(page)
        cdp.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": [{"x": 80, "y": 420}]})
        page.clock.run_for(900)
        cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})
        page.clock.run_for(200)
        res.add(f"{tag} real touch-and-hold places a body", body_count(page) == n0 + 1,
                {"before": n0, "after": body_count(page)})
    res.add(f"{tag} no page errors", not errors, errors[:5])
    context.close()
    browser.close()


def invariant_checks(browser, res):
    errors = []
    context, page = open_page(browser, errors, clock=False, viewport=DESKTOP)
    for c in page.evaluate("() => window.__puInvariants()"):
        res.add(f"[physics] {c['name']}", c["pass"], c.get("detail"))
    res.add("[physics] no page errors", not errors, errors[:5])
    context.close()


def screenshots(pw):
    OUT.mkdir(exist_ok=True)
    for old in OUT.glob("*.png"):
        old.unlink()
    browser = launch(pw, 'chromium')
    for name, query in DESKTOP_SHOTS:
        errors = []
        context, page = open_page(browser, errors, PAGE + "?mode=visual&" + query, viewport=DESKTOP)
        page.add_script_tag(content=HARNESS)
        pump(page, "() => !!window.__puResults")
        page.clock.run_for(100)
        page.screenshot(path=str(OUT / f"{name}.png"))
        print(f"saved tests/output/{name}.png" + (f"   ERRORS: {errors[:3]}" if errors else ""))
        context.close()
    browser.close()
    for device, engine in PHONES:
        browser = launch(pw, engine)
        errors = []
        context, page = open_page(browser, errors, **pw.devices[device])
        page.clock.run_for(2500)
        slug = device.lower().replace(" ", "-")
        page.screenshot(path=str(OUT / f"phone-{slug}.png"))
        # and with the inspector open on the Sun in Cradle of life
        page.select_option("#scene", "cradle")
        page.clock.run_for(300)
        x, y = page.evaluate(SCREEN_POS, "o.kind === 'star'")
        page.tap("#sky", position={"x": x, "y": y})
        page.clock.run_for(600)
        page.screenshot(path=str(OUT / f"phone-{slug}-inspector.png"))
        print(f"saved tests/output/phone-{slug}.png and phone-{slug}-inspector.png"
              + (f"   ERRORS: {errors[:3]}" if errors else ""))
        context.close()
        browser.close()


def quick(pw, res):
    errors = []
    browser = launch(pw, 'chromium')
    context, page = open_page(browser, errors, viewport=DESKTOP)
    page.clock.run_for(1500)
    ran = page.evaluate("() => { window.__pu.tick(30); return window.__pu.simTime > 0; }")
    res.add("page loads and runs", ran)
    res.add("no page errors", not errors, errors[:5])
    context.close()
    browser.close()


def main():
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--screens", action="store_true", help="also save screenshots to tests/output/")
    ap.add_argument("--quick", action="store_true", help="only check the page loads without errors")
    ap.add_argument("--browsers", default="chromium,firefox,webkit")
    a = ap.parse_args()
    res = Results()
    engines = [b.strip() for b in a.browsers.split(",") if b.strip()]
    with sync_playwright() as pw:
        if a.quick:
            quick(pw, res)
        else:
            for engine in engines:
                browser = launch(pw, engine)
                harness_checks(browser, engine, res)
                real_mouse_checks(browser, engine, res)
                if engine == "chromium":
                    invariant_checks(browser, res)
                browser.close()
            for device, engine in PHONES:
                if engine in engines:
                    phone_checks(pw, device, engine, res)
            if a.screens:
                print()
                screenshots(pw)
    print(f"\n{res.passed}/{res.total} checks passed")
    sys.exit(0 if res.ok else 1)


if __name__ == "__main__":
    main()
