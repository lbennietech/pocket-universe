#!/usr/bin/env python3
"""
Pocket Universe hook: gate for git commit and git push
Copyright (c) 2026 Luke Bennie <lukebennie@gmail.com>. All rights reserved.

PreToolUse hook for Bash/PowerShell. index.html is built from src/ by
tools/build.py, and GitHub Pages serves the committed index.html, so:

  - If the command commits to *this* repository, the index.html it would
    commit must be current with the src/ it would commit. The hook runs before
    the command, so it works out what the commit will contain: what's staged
    now, plus what the command's own `git add` segments and `commit -a` or
    pathspecs will stage (simulated on a copy of the git index). If the command
    rebuilds first (tools/build.py, or the tests or benchmarks, which rebuild),
    the hook runs that build itself first. Anything it can't follow (git rm,
    git reset, ... before the commit) is refused with a request to commit in a
    separate command.
  - If the command pushes *this* repository, every commit it pushes (the
    refspecs, or the current branch by default) must have an index.html
    current with its src/, and then the full test suite and the benchmark
    comparison must pass. A commit and a push in one command are refused: the
    hook would have to check a commit that doesn't exist yet.

If a check fails, exit 2 so the command is blocked and Claude sees why.
Commits and pushes of other repositories (for example another project worked
on from this session) and all other commands pass straight through.

To find where a push (or commit) goes, the command is read segment by
segment: a `cd`, `pushd`, `Set-Location` or `sl` changes the directory for the
segments after it, and `git -C <dir> push` names the directory directly. Git
then reports which repository that directory belongs to. If the target can't
be worked out, the command is gated anyway, so a parsing mistake fails safe.
"""
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tools"))
import build  # noqa: E402  (tools/build.py)

GIT_OPTS = r"\bgit(?:\s+(?:-C\s+\S+|-c\s+\S+|--?[\w-]+(?:=\S+)?))*\s+"
# `git push`, allowing global options in between (git -C dir push), but not
# `push` as an argument or inside a message (git stash push, git log --grep push)
PUSH = re.compile(GIT_OPTS + r"push\b")
COMMIT = re.compile(GIT_OPTS + r"commit\b")
GIT_ANY = re.compile(GIT_OPTS + r"([\w-]+)")
GIT_C = re.compile(r"\bgit\s+(?:-c\s+\S+\s+)*-C\s+(\"[^\"]+\"|'[^']+'|\S+)")
CD = re.compile(r"^\s*(?:cd|pushd|Set-Location|sl)(?:\s+-(?:Path|LiteralPath))?\s+(\"[^\"]+\"|'[^']+'|\S+)\s*$", re.I)
SEPARATORS = re.compile(r"&&|\|\||;|\n")
# git subcommands that don't change what a later commit contains
READ_ONLY_GIT = {"status", "diff", "log", "show", "rev-parse", "ls-files", "branch", "config", "remote",
                 "fetch", "describe", "blame", "grep", "shortlog", "var", "version", "help"}
# commands that rebuild index.html from src/ as a side effect
BUILDERS = re.compile(r"tools[/\\]build\.py(?![^\n]*--(?:check|where))|tests[/\\]run_tests\.py|"
                      r"bench[/\\]run_bench\.py|tools[/\\]build_artifact\.py|tools[/\\]serve\.py")
# git commit options that take a value as the next word
COMMIT_VALUE_OPTS = {"-m", "-F", "-C", "-c", "-t", "--message", "--file", "--reuse-message", "--reedit-message",
                     "--template", "--author", "--date", "--fixup", "--squash", "--cleanup", "--trailer",
                     "--pathspec-from-file"}
COMMIT_VALUE_FLAGS = "mFCct"   # the same, as bundled short flags (-am "msg")
PUSH_VALUE_OPTS = {"-o", "--push-option", "--repo", "--receive-pack", "--exec"}
SEPARATE = ("This check runs before your command, so it can only follow simple staging. Run "
            "`python tools/build.py` and `git add` first, then commit in a separate command.")


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


def segments(command, cwd):
    """(segment, directory it runs in) for each segment of the command."""
    out, here = [], cwd
    for segment in SEPARATORS.split(command):
        cd = CD.match(segment)
        if cd:
            here = str(Path(here, to_native(cd.group(1))))
            continue
        c = GIT_C.search(segment)
        out.append((segment, str(Path(here, to_native(c.group(1)))) if c else here))
    return out


def is_this_repo(directory):
    """True if directory is in this repository, or that can't be determined (fail safe)."""
    root = repo_root(directory) if Path(directory).is_dir() else None
    return root is None or root == ROOT.resolve()


def words_after(segment, verb):
    """The words after `git ... <verb>` in a segment, quotes removed."""
    m = re.search(GIT_OPTS + verb + r"\b", segment)
    words = re.findall(r"\"[^\"]*\"|'[^']*'|\S+", segment[m.end():])
    return [w[1:-1] if len(w) >= 2 and w[0] == w[-1] and w[0] in "\"'" else w for w in words]


def git(args, cwd, env=None):
    return subprocess.run(["git", *args], cwd=cwd, env=env, capture_output=True, text=True,
                          encoding="utf-8", errors="replace")


def commit_problem(segs, i):
    """Why the commit in segment i would ship a stale index.html, or None."""
    before = segs[:i]
    for seg, _ in before:
        g = GIT_ANY.search(seg)
        if g and g.group(1) not in READ_ONLY_GIT | {"add"}:
            return f"the command runs `git {g.group(1)}` before committing. " + SEPARATE
    try:
        if any(BUILDERS.search(seg) for seg, _ in before):
            build.ensure(quiet=True)   # the command would rebuild index.html before committing
    except build.BuildError as e:
        return str(e)
    index = git(["rev-parse", "--git-path", "index"], ROOT).stdout.strip()
    tmp = tempfile.mkdtemp(prefix="pu-index-")
    try:
        env = dict(os.environ, GIT_INDEX_FILE=str(Path(tmp, "index")))
        src = Path(ROOT, index)
        if src.exists():
            shutil.copy(src, env["GIT_INDEX_FILE"])
        stage = [(words_after(seg, "add"), d) for seg, d in before if re.search(GIT_OPTS + r"add\b", seg)]
        words, paths, k = words_after(segs[i][0], "commit"), [], 0
        while k < len(words):
            w = words[k]
            if w == "--":
                paths += words[k + 1:]
                break
            if w in COMMIT_VALUE_OPTS:
                k += 1
            elif w == "--all":
                stage.append((["-u"], segs[i][1]))
            elif re.fullmatch(r"-[a-zA-Z]+", w):          # short flags, maybe bundled: -a, -am, -amMsg
                for n, flag in enumerate(w[1:], 1):
                    if flag == "a":
                        stage.append((["-u"], segs[i][1]))
                    if flag in COMMIT_VALUE_FLAGS:
                        k += n == len(w) - 1           # the value is the next word, or the rest of this one
                        break
            elif not w.startswith("-") and not w.startswith("@"):   # @' is a PowerShell here-string
                paths.append(w)
            k += 1
        if paths:
            stage.append((paths, segs[i][1]))
        for args, cwd in stage:
            r = git(["add", *args], cwd, env)
            if r.returncode != 0:
                return f"couldn't work out what `git add {' '.join(args)}` will stage ({r.stderr.strip()}). " + SEPARATE
        why = build.check(staged=True, env=env)
    except build.BuildError as e:
        why = str(e)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    return why and why + " (Checked on what this commit would contain.)"


def pushed_refs(segment):
    """The local refs a `git push` segment pushes."""
    words, positional, every, k = words_after(segment, "push"), [], False, 0
    while k < len(words):
        w = words[k]
        if w in PUSH_VALUE_OPTS:
            k += 1
        elif w in ("--all", "--mirror", "--branches"):
            every = True
        elif not w.startswith("-"):
            positional.append(w)
        k += 1
    refs = []
    if every:
        refs += git(["for-each-ref", "--format=%(refname)", "refs/heads"], ROOT).stdout.split()
    for spec in positional[1:]:            # the first positional word is the remote
        src = spec.lstrip("+").split(":")[0]
        if src:                              # `:branch` deletes, pushing nothing
            refs.append(src)
    return refs or ["HEAD"]


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
    if not PUSH.search(command) and not COMMIT.search(command):
        return 0
    segs = segments(command, data.get("cwd") or os.getcwd())
    commits = [i for i, (s, d) in enumerate(segs) if COMMIT.search(s) and is_this_repo(d)]
    pushes = [i for i, (s, d) in enumerate(segs) if PUSH.search(s) and is_this_repo(d)]
    if commits and pushes:
        sys.stderr.write("Blocked: run the commit and the push as separate commands, so the push gate can "
                         "check the commit that's actually pushed.\n")
        return 2
    for i in commits:
        why = commit_problem(segs, i)
        if why:
            sys.stderr.write("Commit blocked: " + why + "\n")
            return 2
    if not pushes:
        return 0
    for i in pushes:
        for ref in pushed_refs(segs[i][0]):
            try:
                why = build.check(ref=ref)
            except build.BuildError as e:
                why = f"couldn't check {ref}: {e}"
            if why:
                sys.stderr.write("Push blocked: " + why + "\n")
                return 2
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
