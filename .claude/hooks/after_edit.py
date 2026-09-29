#!/usr/bin/env python3
"""
Pocket Universe hook: quick check after an edit
Copyright (c) 2026 Luke Bennie <lukebennie@gmail.com>. All rights reserved.

PostToolUse hook for Edit/Write. When the game's source (src/), the built
index.html, the build script or the test/bench scripts change, rebuild
index.html from src/ and load it in headless Chromium for a few seconds to
make sure it runs without errors (tests/run_tests.py --quick, which builds
first). On failure it exits 2 so Claude sees the problem straight away,
including an index.html edited by hand instead of in src/.
"""
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
WATCHED = ("index.html", "tools/build.py", "tests/harness.js", "tests/invariants.js", "bench/scenes.js")


def main():
    try:
        data = json.load(sys.stdin)
    except ValueError:
        return 0
    path = str((data.get("tool_input") or {}).get("file_path", "")).replace("\\", "/")
    in_src = path.lower().startswith(ROOT.as_posix().lower() + "/src/")
    if not any(path.endswith(w) for w in WATCHED) and not in_src:
        return 0
    proc = subprocess.run([sys.executable, str(ROOT / "tests" / "run_tests.py"), "--quick"],
                          cwd=ROOT, capture_output=True, text=True, encoding="utf-8", errors="replace")
    if proc.returncode != 0:
        sys.stderr.write("Quick check failed after editing " + path + ":\n" + proc.stdout[-2000:] + proc.stderr[-1000:])
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
