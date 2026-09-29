#!/usr/bin/env python3
"""
Pocket Universe: build index.html from src/
Copyright (c) 2026 Luke Bennie <lukebennie@gmail.com>. All rights reserved.

The game's source lives in src/: the page (shell.html), its styles (style.css)
and its script, split by area into the .js files listed in SCRIPTS below. This
joins them into the single self-contained index.html that GitHub Pages serves
from the repo root, the tests and benchmarks load, and build_artifact.py copies.
It's a plain join, so no dependencies and no install:

  - Each source file starts with its own header (the copyright line and what the
    file holds), ending at the first blank line. The header isn't shipped.
  - shell.html has two marker lines: `<!-- build: style.css -->` becomes the
    styles and `<!-- build: scripts -->` becomes the scripts, in SCRIPTS order,
    one blank line apart, inside the IIFE that shell.html opens, so the scripts
    share one scope. Lines are copied exactly as written, never re-indented.
  - Line 2 of index.html is a stamp holding a hash of the rest of the file, so
    a hand edit to index.html is caught instead of silently overwritten.

    python tools/build.py              # rebuild index.html if src/ changed
    python tools/build.py --check      # exit 1 if index.html isn't current (writes nothing)
    python tools/build.py --check-staged     # the same, for what `git commit` would commit
    python tools/build.py --check-ref HEAD   # the same, for a commit's files
    python tools/build.py --where 1234 # which src/ file and line index.html:1234 came from
    python tools/build.py --force      # rebuild even over a hand-edited index.html

Other tools import ensure(), which rebuilds a stale index.html and raises
BuildError (with instructions) if index.html was edited by hand.
"""
import argparse
import hashlib
import os
import re
import subprocess
import sys
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = "src"
OUT = ROOT / "index.html"

SHELL = "shell.html"
STYLE = "style.css"
# The script, in the order it runs. Later files may use what earlier ones define.
SCRIPTS = [
    "units.js",       # units, physical constants, tool and colour tables
    "state.js",       # the mutable game state: bodies, dust, camera, time
    "helpers.js",     # random numbers, labels, formatting, the event feed
    "bodies.js",      # making bodies, comets, dust; radius, colour and kind
    "physics.js",     # gravity, the leapfrog integrator, block time steps, dust
    "collisions.js",  # merges, tidal shredding, supernovae
    "cull.js",        # centre of mass, the main group, removing far-off bodies
    "life.js",        # habitable zones and life
    "scenes.js",      # the scene builders
    "viewport.js",    # viewport, camera, backdrop
    "aiming.js",      # placing and throwing new objects
    "input.js",       # mouse, touch and keyboard
    "ui.js",          # HUD, inspector, dock and feed wiring
    "render.js",      # drawing everything
    "loop.js",        # the main loop: one frame of input, physics, camera, drawing
    "testhook.js",    # window.__pu, the read-only hook for tests and benchmarks
    "boot.js",        # start-up
]
COPYRIGHT = "Copyright (c) 2026 Luke Bennie <lukebennie@gmail.com>. All rights reserved."
STAMP = "<!-- Built from src/ by tools/build.py: edit src/, not this file. sha256:{} -->"
STAMP_RE = re.compile(r"^<!-- Built from src/ by tools/build\.py: edit src/, not this file\. sha256:([0-9a-f]{16}) -->\n",
                      re.M)
SOURCE_TYPES = (".js", ".css", ".html")   # files in src/ that must be listed above
MARKERS = ("<!-- build: style.css -->", "<!-- build: scripts -->")


class BuildError(Exception):
    pass


def _digest(text):
    return hashlib.sha256(text.encode("utf-8")).hexdigest()[:16]


def _source(name, text):
    """(lines, header line count) of a source file, without its header."""
    lines = text.replace("\r\n", "\n").split("\n")
    try:
        blank = next(i for i, l in enumerate(lines) if not l.strip())
    except StopIteration:
        raise BuildError(f"src/{name}: needs a header (copyright line and description) ending in a blank line")
    if not any(COPYRIGHT in l for l in lines[:blank]):
        raise BuildError(f"src/{name}: its header must include the line: {COPYRIGHT}")
    body = lines[blank + 1:]
    while body and not body[-1].strip():
        body.pop()
    return body, blank + 1


def assemble(read, listing):
    """Build index.html from read(path) -> text for each path under src/.
    Returns (text, segments), segments being (first out line, count, src path, first src line)."""
    wanted = {f"{SRC}/{n}" for n in [SHELL, STYLE, *SCRIPTS]}
    extra = sorted(p for p in listing if p not in wanted)
    missing = sorted(wanted - set(listing))
    if extra:
        raise BuildError(f"{', '.join(extra)} would not be shipped: add it to SCRIPTS in tools/build.py "
                         f"(in the order it should run), or move it out of src/")
    if missing:
        raise BuildError(f"missing {', '.join(missing)} (listed in tools/build.py)")
    out, segs = ["<!doctype html>", None], []   # None: the stamp, filled in below

    def emit(name):
        body, head = _source(name, read(f"{SRC}/{name}"))
        segs.append((len(out) + 1, len(body), f"{SRC}/{name}", head + 1))
        out.extend(body)

    shell, head = _source(SHELL, read(f"{SRC}/{SHELL}"))
    if not shell or shell[0].lower() != "<!doctype html>":
        raise BuildError(f"src/{SHELL}: the first line after its header must be <!doctype html>")
    segs.append((1, 1, f"{SRC}/{SHELL}", head + 1))
    found = sorted(l.strip() for l in shell if l.strip() in MARKERS)
    if found != sorted(MARKERS):
        raise BuildError(f"src/{SHELL} must contain each marker line exactly once: {', '.join(MARKERS)}")
    for i, line in enumerate(shell[1:], 1):
        if line.strip() == MARKERS[0]:
            emit(STYLE)
        elif line.strip() == MARKERS[1]:
            for k, name in enumerate(SCRIPTS):
                if k:
                    out.append("")
                emit(name)
        else:
            if segs and segs[-1][2] == f"{SRC}/{SHELL}" and segs[-1][0] + segs[-1][1] == len(out) + 1:
                s = segs[-1]
                segs[-1] = (s[0], s[1] + 1, s[2], s[3])
            else:
                segs.append((len(out) + 1, 1, f"{SRC}/{SHELL}", head + 1 + i))
            out.append(line)
    rest = "\n".join(out[:1] + out[2:]) + "\n"
    out[1] = STAMP.format(_digest(rest))
    return "\n".join(out) + "\n", segs


def _working_tree():
    def read(path):
        return (ROOT / path).read_text(encoding="utf-8")
    listing = [p.relative_to(ROOT).as_posix() for p in (ROOT / SRC).rglob("*")
               if p.is_file() and p.suffix in SOURCE_TYPES]
    return read, listing


def _git(*args, env=None, missing_ok=False):
    out = subprocess.run(["git", *args], cwd=ROOT, capture_output=True, env=env)
    if out.returncode != 0:
        if missing_ok:
            return None
        raise BuildError(f"git {' '.join(args)} failed: {out.stderr.decode(errors='replace').strip()}")
    return out.stdout.decode("utf-8")


def build(tree=None):
    read, listing = tree or _working_tree()
    return assemble(read, listing)


def _state(current, built):
    """'current', 'stale' (an untouched older build) or 'edited' (changed by hand, or never built)."""
    if current == built:
        return "current"
    m = STAMP_RE.search(current)
    if m and _digest(STAMP_RE.sub("", current, count=1)) == m.group(1):
        return "stale"
    return "edited"


EDITED = ("index.html was edited directly (it doesn't match its build stamp). index.html is built "
          "from src/: move the change into the matching src/ file, then run `python tools/build.py`. "
          "To throw the hand edit away instead, run `python tools/build.py --force`.")
MISSING = "index.html is missing: run `python tools/build.py`."


def _read_out():
    return OUT.read_text(encoding="utf-8").replace("\r\n", "\n") if OUT.exists() else None


def _write_atomic(text):
    """Write index.html via a temporary file and a rename, so no reader ever sees half a file."""
    fd, tmp = tempfile.mkstemp(prefix=".index.", suffix=".tmp", dir=ROOT)
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as f:
            f.write(text)
        for attempt in range(20):
            try:
                os.replace(tmp, OUT)
                return
            except PermissionError:   # Windows: a reader has index.html open for a moment
                if attempt == 19:
                    raise
                time.sleep(0.05)
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)


def ensure(force=False, quiet=False):
    """Make index.html current with src/. Returns 'current' or 'rebuilt'; raises BuildError."""
    built, _ = build()
    current = _read_out()
    state = "edited" if current is None else _state(current, built)
    if state == "current":
        return "current"
    if state == "edited" and current is not None and not force:   # a missing index.html is simply built
        raise BuildError(EDITED)
    _write_atomic(built)
    if not quiet:
        print(f"rebuilt index.html from src/ ({len(built.encode('utf-8')):,} bytes)")
    return "rebuilt"


def check(ref=None, staged=False, env=None):
    """None if index.html is current with src/, else why not. Checks the working tree by default,
    the git index (what `git commit` would commit) with staged=True, or the commit `ref`.
    env: environment for git, e.g. with GIT_INDEX_FILE pointing at another index."""
    if ref is None and not staged:
        built, _ = build()
        current = _read_out()
        if current is None:
            return MISSING
        name, fix = "index.html", "run `python tools/build.py`"
    else:
        spec = ":" if staged else f"{ref}:"
        if staged:
            files = _git("ls-files", "--", SRC, env=env).splitlines()
            name, fix = "The staged index.html", "run `python tools/build.py`, then `git add index.html` with src/"
        else:
            files = _git("ls-tree", "-r", "--name-only", ref, "--", SRC).splitlines()
            name, fix = f"index.html in {ref}", "run `python tools/build.py` and commit index.html with src/"
        listing = [p for p in files if p.endswith(SOURCE_TYPES)]
        if not listing:   # from before the split: index.html was the source
            return None
        built, _ = build((lambda p: _git("show", spec + p, env=env), listing))
        current = _git("show", spec + "index.html", env=env, missing_ok=True)
        if current is None:
            return f"{name} is missing: {fix}."
        current = current.replace("\r\n", "\n")
    state = _state(current, built)
    if state == "current":
        return None
    if state == "stale":
        return f"{name} is stale: src/ changed since it was built; {fix}."
    return f"{name} was edited directly (it doesn't match its build stamp); {fix}." if (ref or staged) else EDITED


def where(line):
    """Map an index.html line to its src/ file and line (for the current src/)."""
    built, segs = build()
    warn = ""
    if _read_out() != built:
        warn = ("\nWARNING: index.html doesn't match the current src/ (it's stale or was edited by hand), "
                "so this maps a fresh build's line, which may not be the line you're looking at. "
                "Run `python tools/build.py` and look again.")
    if line == 2:
        return "index.html:2 is the build stamp" + warn
    for start, count, path, first in segs:
        if start <= line < start + count:
            return f"index.html:{line} -> {path}:{first + line - start}" + warn
    return f"index.html:{line} is a blank line tools/build.py puts between two src/ files (or past the end)" + warn


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--check", action="store_true", help="exit 1 if index.html isn't current; write nothing")
    ap.add_argument("--check-staged", action="store_true", help="like --check, for the files staged in git")
    ap.add_argument("--check-ref", metavar="REF", help="like --check, for the files in a commit (e.g. HEAD)")
    ap.add_argument("--where", type=int, metavar="LINE", help="map an index.html line to its src/ file and line")
    ap.add_argument("--force", action="store_true", help="rebuild even over a hand-edited index.html")
    a = ap.parse_args()
    try:
        if a.where is not None:
            print(where(a.where))
        elif a.check or a.check_ref or a.check_staged:
            why = check(a.check_ref, a.check_staged)
            if why:
                sys.exit("FAIL: " + why)
            what = " (staged)" if a.check_staged else (" in " + a.check_ref if a.check_ref else "")
            print(f"ok: index.html{what} is current with src/")
        elif ensure(force=a.force) == "current":
            print("index.html is already current with src/")
    except BuildError as e:
        sys.exit("FAIL: " + str(e))


if __name__ == "__main__":
    main()
