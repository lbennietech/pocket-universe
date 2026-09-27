#!/usr/bin/env python3
"""
Pocket Universe hook: gate for git push
Copyright (c) 2026 Luke Bennie <lukebennie@gmail.com>. All rights reserved.

PreToolUse hook for Bash/PowerShell. If the command runs `git push`, run the
full test suite and the benchmark comparison first. If either fails, exit 2
so the push is blocked and Claude sees why. Other commands pass straight
through.
"""
import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PUSH = re.compile(r"\bgit\b[^;&|\n]*\bpush\b")


def run(args):
    proc = subprocess.run([sys.executable, *args], cwd=ROOT, capture_output=True, text=True,
                          encoding="utf-8", errors="replace")
    return proc.returncode, proc.stdout + proc.stderr


def main():
    try:
        data = json.load(sys.stdin)
    except ValueError:
        return 0
    command = str((data.get("tool_input") or {}).get("command", ""))
    if not PUSH.search(command):
        return 0
    code, out = run([str(ROOT / "tests" / "run_tests.py")])
    if code != 0:
        fails = "\n".join(l for l in out.splitlines() if l.startswith("FAIL"))
        sys.stderr.write("Push blocked: tests failed.\n" + (fails or out[-2000:]) + "\n")
        return 2
    code, out = run([str(ROOT / "bench" / "run_bench.py"), "--compare"])
    if code != 0:
        sys.stderr.write("Push blocked: benchmark regression or broken budget.\n" + out[-2500:] + "\n")
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
