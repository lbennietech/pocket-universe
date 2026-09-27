#!/usr/bin/env python3
"""
Pocket Universe hook: gate for git push
Copyright (c) 2026 Luke Bennie <lukebennie@gmail.com>. All rights reserved.

PreToolUse hook for Bash/PowerShell. If the command pushes *this* repository,
run the full test suite and the benchmark comparison first. If either fails,
exit 2 so the push is blocked and Claude sees why. Pushes of other repositories
(for example another project worked on from this session) and all other
commands pass straight through.

To find where a push goes, the command is read segment by segment: a `cd`,
`pushd`, `Set-Location` or `sl` changes the directory for the segments after
it, and `git -C <dir> push` names the directory directly. Git then reports
which repository that directory belongs to. If the target can't be worked out,
the push is gated anyway, so a parsing mistake fails safe.
"""
import json
import os
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
# `git push`, allowing global options in between (git -C dir push), but not
# `push` as an argument or inside a message (git stash push, git log --grep push)
PUSH = re.compile(r"\bgit(?:\s+(?:-C\s+\S+|-c\s+\S+|--?[\w-]+(?:=\S+)?))*\s+push\b")
GIT_C = re.compile(r"\bgit\s+(?:-c\s+\S+\s+)*-C\s+(\"[^\"]+\"|'[^']+'|\S+)")
CD = re.compile(r"^\s*(?:cd|pushd|Set-Location|sl)(?:\s+-(?:Path|LiteralPath))?\s+(\"[^\"]+\"|'[^']+'|\S+)\s*$", re.I)
SEPARATORS = re.compile(r"&&|\|\||;|\n")


def to_native(path):
    """Git Bash paths like /e/hztrn/x become E:/hztrn/x on Windows."""
    path = path.strip("\"'")
    m = re.match(r"^/([a-zA-Z])(/.*)?$", path)
    if os.name == "nt" and m:
        path = m.group(1).upper() + ":" + (m.group(2) or "/")
    return os.path.expanduser(path)


def repo_root(directory):
    """The top level of the git repository containing directory, or None."""
    try:
        out = subprocess.run(["git", "-C", directory, "rev-parse", "--show-toplevel"],
                             capture_output=True, text=True, timeout=10)
    except (OSError, subprocess.SubprocessError):
        return None
    if out.returncode != 0 or not out.stdout.strip():
        return None
    return Path(out.stdout.strip()).resolve()


def push_targets(command, cwd):
    """The directory each `git push` in the command runs against."""
    targets, here = [], cwd
    for segment in SEPARATORS.split(command):
        cd = CD.match(segment)
        if cd:
            here = str(Path(here, to_native(cd.group(1))))
            continue
        if PUSH.search(segment):
            c = GIT_C.search(segment)
            targets.append(str(Path(here, to_native(c.group(1)))) if c else here)
    return targets


def pushes_this_repo(command, cwd):
    """True if any push in the command targets this repository, or its target can't be determined."""
    for target in push_targets(command, cwd):
        root = repo_root(target) if Path(target).is_dir() else None
        if root is None or root == ROOT.resolve():
            return True
    return False


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
    cwd = data.get("cwd") or os.getcwd()
    if not pushes_this_repo(command, cwd):
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
