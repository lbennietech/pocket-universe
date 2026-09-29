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

The command is read with a small shell-like lexer (lex(), below): it resolves
quotes and backslash escapes, treats `$(...)`/`` `...` ``/arithmetic as one
opaque word (their contents are never scanned here for a nested git verb: a
command actually hidden that way is instead caught by the fail-safe below),
skips heredoc bodies to their closing delimiter line, and drops redirections
(with their targets). Each resulting segment's first real word is checked for
`cd`/`pushd`/`Set-Location`/`sl` (which changes the directory for the segments
after it) or a `git` invocation (`-C <dir>` names the directory directly; git
then reports which repository that directory belongs to). If the target can't
be worked out, the command is gated anyway, so a parsing mistake fails safe.

Because a hand-rolled lexer can still miss a real case, there's a second,
cruder fail-safe: if the raw command text matches `git ... commit` or
`git ... push` *anywhere* (a plain regex, quotes and heredocs included) but
the lexer found no matching top-level segment in this repository, the matching
gate still runs (the coarse staged-index check for a possible commit, the full
push gate against HEAD for a possible push). A false alarm from a commit
message that happens to mention "git push" costs an extra gate run; a real
push slipping through unchecked would not be safe.
"""
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from collections import namedtuple
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tools"))
import build  # noqa: E402  (tools/build.py)

GIT_OPTS = r"\bgit(?:\s+(?:-C\s+\S+|-c\s+\S+|--?[\w-]+(?:=\S+)?))*\s+"
# `git push`/`git commit` anywhere in the raw text, allowing global options in between
# (git -C dir push) but not as an argument or inside a message (git stash push, --grep push).
# This is deliberately crude (it doesn't know about quotes or heredocs): it's only used for
# the early "is this worth parsing at all" exit and the fail-safe below, never on its own to
# decide what a real commit or push contains.
PUSH = re.compile(GIT_OPTS + r"push\b")
COMMIT = re.compile(GIT_OPTS + r"commit\b")
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
CD_VERBS = {"cd", "pushd", "set-location", "sl"}
SEPARATE = ("This check runs before your command, so it can only follow simple staging. Run "
            "`python tools/build.py` and `git add` first, then commit in a separate command.")

# redirection operators, longest first so e.g. `<<-` and `<<<` never get read as a bare `<<`.
# The digit-prefixed form (an fd number with no space before the operator, e.g. `2>&1`) is only
# ever tried at a fresh word boundary -- see lex() -- matching the shell's own rule that a
# leading digit is part of the redirection only when it isn't already part of a longer word.
_REDIR_ALTS = r">&\d+|>&-|<&\d+|<&-|<<-|<<<|<<|>>|>|<"
REDIR_FD_RE = re.compile(r"\d+(?:" + _REDIR_ALTS + r")")
REDIR_PLAIN_RE = re.compile(_REDIR_ALTS + r"|&>>|&>")
NO_TARGET_RE = re.compile(r">&\d+|>&-|<&\d+|<&-")   # the target is embedded in the operator itself

Segment = namedtuple("Segment", "tokens directory")


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


def is_this_repo(directory):
    """True if directory is in this repository, or that can't be determined (fail safe)."""
    root = repo_root(directory) if Path(directory).is_dir() else None
    return root is None or root == ROOT.resolve()


def _read_word(command, pos):
    """One shell word starting at pos: quotes and backslash escapes resolved, `$(...)`/
    `` `...` `` kept verbatim as an opaque chunk of the word (never scanned here for a nested
    git verb -- see the fail-safe in main()). (None, pos) if pos isn't the start of a word."""
    n = len(command)
    buf, started = [], False
    while pos < n:
        c = command[pos]
        if c in " \t\n;&|<>":
            break
        started = True
        if c == "\\":
            if pos + 1 < n:
                buf.append(command[pos + 1])
                pos += 2
            else:
                pos += 1
        elif c == "'":
            end = command.find("'", pos + 1)
            if end == -1:
                buf.append(command[pos + 1:])
                pos = n
            else:
                buf.append(command[pos + 1:end])
                pos = end + 1
        elif c == '"':
            pos += 1
            while pos < n and command[pos] != '"':
                if command[pos] == "\\" and pos + 1 < n and command[pos + 1] in "\"\\$`\n":
                    buf.append(command[pos + 1])
                    pos += 2
                else:
                    buf.append(command[pos])
                    pos += 1
            pos = min(pos + 1, n)
        elif c == "$" and pos + 1 < n and command[pos + 1] == "(":
            start, pos, depth, q = pos, pos + 2, 1, None
            while pos < n and depth > 0:
                ch = command[pos]
                if q:
                    if ch == "\\" and q == '"' and pos + 1 < n:
                        pos += 2
                        continue
                    if ch == q:
                        q = None
                    pos += 1
                    continue
                if ch in "'\"":
                    q = ch
                elif ch == "(":
                    depth += 1
                elif ch == ")":
                    depth -= 1
                pos += 1
            buf.append(command[start:pos])
        elif c == "`":
            start, pos = pos, pos + 1
            while pos < n and command[pos] != "`":
                pos += 2 if command[pos] == "\\" and pos + 1 < n else 1
            pos = min(pos + 1, n)
            buf.append(command[start:pos])
        else:
            buf.append(c)
            pos += 1
    return ("".join(buf), pos) if started else (None, pos)


def _skip_ws(command, pos):
    n = len(command)
    while pos < n and command[pos] in " \t":
        pos += 1
    return pos


def _skip_heredoc(command, pos, delim, dash):
    """The position right at (not past) the newline that ends delim's line, or the end of the
    command if the delimiter never appears (an unterminated heredoc blanks the rest: fail safe,
    since nothing after it can be trusted as separate commands either)."""
    n = len(command)
    while pos <= n:
        nl = command.find("\n", pos)
        end = nl if nl != -1 else n
        line = command[pos:end]
        if (line.strip() if dash else line) == delim:
            return end
        if nl == -1:
            return n
        pos = nl + 1
    return n


def lex(command):
    """command split into segments (on ; | || && & and newlines), each a list of plain word
    tokens: git's own arguments, quotes and backslash escapes already resolved. Redirections
    (and their targets) are dropped; heredoc bodies are skipped to their delimiter line."""
    n = len(command)
    pos = 0
    segments, words, pending = [], [], []

    def end_segment():
        if words:
            segments.append(words[:])
            words.clear()

    while pos < n:
        c = command[pos]
        if c in " \t":
            pos += 1
        elif c == "\n":
            if pending:
                pos += 1
                for idx, (delim, dash) in enumerate(pending):
                    pos = _skip_heredoc(command, pos, delim, dash)
                    if idx < len(pending) - 1 and pos < n and command[pos] == "\n":
                        pos += 1   # move on to the next heredoc's body
                pending = []
                # deliberately not `continue`ing past the delimiter line's own newline: the
                # next loop turn sees it and ends the segment there, same as any other newline
            else:
                end_segment()
                pos += 1
        elif command[pos:pos + 2] in ("&&", "||"):
            end_segment()
            pos += 2
        elif c == "#":
            nl = command.find("\n", pos)
            pos = nl if nl != -1 else n
        else:
            # always at a fresh word boundary here (the loop never leaves a word half-read),
            # so a leading digit is always eligible to be a redirection's fd number
            m = REDIR_FD_RE.match(command, pos) or REDIR_PLAIN_RE.match(command, pos)
            if m:
                op = m.group(0)
                pos = m.end()
                bare = op.lstrip("0123456789")
                if bare in ("<<", "<<-"):
                    pos = _skip_ws(command, pos)
                    delim, pos = _read_word(command, pos)
                    pending.append((delim or "", bare == "<<-"))
                elif not NO_TARGET_RE.fullmatch(bare):
                    pos = _skip_ws(command, pos)
                    _, pos = _read_word(command, pos)
            elif c in ";&|":
                end_segment()
                pos += 1
            else:
                word, pos = _read_word(command, pos)
                if word is not None:
                    words.append(word)
                else:
                    pos += 1   # stray character (shouldn't normally happen); don't loop forever
    end_segment()
    return segments


def parse_git(tokens):
    """(verb, index of the verb token, -C directory or None) if tokens is a
    `git <global options> <verb> ...` invocation, else None. Mirrors git's own global-option
    parsing closely enough for our purposes: -C/-c each take the next token as a value
    (repeatable), and any other -x/--x flag (with or without =value) is skipped."""
    if not tokens or tokens[0] != "git":
        return None
    i, directory = 1, None
    while i < len(tokens):
        t = tokens[i]
        if t in ("-C", "-c"):
            if t == "-C" and directory is None and i + 1 < len(tokens):
                directory = tokens[i + 1]
            i += 2
        elif re.fullmatch(r"--?[\w-]+(=.*)?", t):
            i += 1
        else:
            break
    return (tokens[i], i, directory) if i < len(tokens) else None


def _cd_target(tokens):
    """The directory a `cd`/`pushd`/`Set-Location`/`sl` segment changes to, or None."""
    if not tokens or tokens[0].lower() not in CD_VERBS:
        return None
    rest = tokens[1:]
    if rest and rest[0].lower() in ("-path", "-literalpath"):
        rest = rest[1:]
    return rest[0] if len(rest) == 1 else None


def segments(command, cwd):
    """Segment(tokens, directory) for each non-empty segment of the command."""
    out, here = [], cwd
    for tokens in lex(command):
        target = _cd_target(tokens)
        if target is not None:
            here = str(Path(here, to_native(target)))
            continue
        g = parse_git(tokens)
        directory = str(Path(here, to_native(g[2]))) if g and g[2] else here
        out.append(Segment(tokens, directory))
    return out


def git(args, cwd, env=None):
    return subprocess.run(["git", *args], cwd=cwd, env=env, capture_output=True, text=True,
                          encoding="utf-8", errors="replace")


def commit_problem(segs, i):
    """Why the commit in segment i would ship a stale index.html, or None."""
    before = segs[:i]
    for seg in before:
        g = parse_git(seg.tokens)
        if g and g[0] not in READ_ONLY_GIT | {"add"}:
            return f"the command runs `git {g[0]}` before committing. " + SEPARATE
    try:
        if any(BUILDERS.search(" ".join(seg.tokens)) for seg in before):
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
        stage = []
        for seg in before:
            g = parse_git(seg.tokens)
            if g and g[0] == "add":
                stage.append((seg.tokens[g[1] + 1:], seg.directory))
        gc = parse_git(segs[i].tokens)
        words, paths, k = segs[i].tokens[gc[1] + 1:], [], 0
        while k < len(words):
            w = words[k]
            if w == "--":
                paths += words[k + 1:]
                break
            if w in COMMIT_VALUE_OPTS:
                k += 1
            elif w == "--all":
                stage.append((["-u"], segs[i].directory))
            elif re.fullmatch(r"-[a-zA-Z]+", w):          # short flags, maybe bundled: -a, -am, -amMsg
                for n, flag in enumerate(w[1:], 1):
                    if flag == "a":
                        stage.append((["-u"], segs[i].directory))
                    if flag in COMMIT_VALUE_FLAGS:
                        k += n == len(w) - 1           # the value is the next word, or the rest of this one
                        break
            elif not w.startswith("-") and not w.startswith("@"):   # @' is a PowerShell here-string
                paths.append(w)
            k += 1
        if paths:
            stage.append((paths, segs[i].directory))
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


def pushed_refs(tokens, verb_index):
    """The local refs a `git push` invocation (tokens, with its verb at verb_index) pushes."""
    words, positional, every, k = tokens[verb_index + 1:], [], False, 0
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


def in_scope(segs, cwd):
    """True if the command ever runs in this repository: some segment's directory is this repo
    (or unknown, so fail safe), or -- if the lexer produced no segments at all, for example a
    command that's nothing but a heredoc -- the command's own starting directory is. A `cd`,
    `pushd`, `Set-Location`, `sl` or `git -C`/`-c` to elsewhere in the command takes the rest of
    it, and the raw-text fail-safe below, out of scope with it."""
    if segs:
        return any(is_this_repo(seg.directory) for seg in segs)
    return is_this_repo(cwd)


def push_refs_for(command, segs, pushes, scoped):
    """Every ref a command's real `git push` segments push, or the fail-safe ["HEAD"] if the
    lexer found none but the raw text still looks like it might push in this repo, or [] if
    neither (including when the command is out of scope: see in_scope())."""
    if pushes:
        refs = []
        for i in pushes:
            g = parse_git(segs[i].tokens)
            refs += pushed_refs(segs[i].tokens, g[1])
        return refs
    return ["HEAD"] if scoped and PUSH.search(command) else []


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
    cwd = data.get("cwd") or os.getcwd()
    segs = segments(command, cwd)
    commits, pushes = [], []
    for i, seg in enumerate(segs):
        g = parse_git(seg.tokens)
        if g and is_this_repo(seg.directory):
            (commits if g[0] == "commit" else pushes if g[0] == "push" else []).append(i)

    if commits and pushes:
        sys.stderr.write("Blocked: run the commit and the push as separate commands, so the push gate can "
                         "check the commit that's actually pushed.\n")
        return 2

    for i in commits:
        why = commit_problem(segs, i)
        if why:
            sys.stderr.write("Commit blocked: " + why + "\n")
            return 2
    scoped = in_scope(segs, cwd)
    if not commits and scoped and COMMIT.search(command):
        # fail-safe: the raw text looks like it might commit somewhere the lexer didn't resolve
        # to a top-level `git commit` in this repo (a substitution, an unusual quoting, a lexer
        # gap, ...), and nothing in the command took it out of this repo. Check what's currently
        # staged rather than risk a hidden commit shipping a stale index.html; a commit message
        # that merely mentions "git commit" costs a check.
        try:
            why = build.check(staged=True)
        except build.BuildError as e:
            why = str(e)
        if why:
            sys.stderr.write("Commit blocked: " + why + " (the raw command mentions `git commit` "
                             "somewhere this check couldn't fully follow.)\n")
            return 2

    refs = push_refs_for(command, segs, pushes, scoped)
    if not refs:
        return 0
    for ref in refs:
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
