#!/usr/bin/env python3
"""
Pocket Universe: tests for the before_push commit/push gate
Copyright (c) 2026 Luke Bennie <lukebennie@gmail.com>. All rights reserved.

Unit tests for .claude/hooks/before_push.py: the PreToolUse hook that blocks a
commit or push with a stale index.html. These test the parsing (lex(),
segments(), parse_git(), pushed_refs()) and the top-level decision (main(),
fed a fake stdin) directly, including the repo-scoped fail-safe for what the
lexer can't fully follow.

Stdlib only: no network, and no real git side effects (git add here always
targets a throwaway GIT_INDEX_FILE, as the hook itself does; the one test
that needs real history uses a temp repo made just for it). Note for anyone
running this file's own command by hand rather than through this test
runner: the raw text of *that* command is itself scanned by the live hook,
so a `python -c "..."` one-liner that mentions `git push`/`git commit`
triggers the very fail-safe under test here -- keep such strings inside this
file, not on the command line.

    python tests/test_hooks.py
"""
import contextlib
import importlib.util
import io
import json
import re
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
HOOK_PATH = ROOT / ".claude" / "hooks" / "before_push.py"

spec = importlib.util.spec_from_file_location("before_push", HOOK_PATH)
hook = importlib.util.module_from_spec(spec)
spec.loader.exec_module(hook)


def classify(command, cwd=None):
    """(commit segment indices, push segment indices, segs) the way main() computes them,
    without running the heavy build/test/bench steps a real commit or push would trigger."""
    cwd = cwd or str(ROOT)
    segs = hook.segments(command, cwd)
    commits, pushes = [], []
    for i, seg in enumerate(segs):
        g = hook.parse_git(seg.tokens)
        if g and hook.is_this_repo(seg.directory):
            (commits if g[0] == "commit" else pushes if g[0] == "push" else []).append(i)
    return commits, pushes, segs


def run_main(command, cwd=None):
    """(exit code, stderr) from feeding `command` to main() as a real PreToolUse hook would."""
    payload = json.dumps({"tool_input": {"command": command}, "cwd": cwd or str(ROOT)})
    stdin = sys.stdin
    sys.stdin = io.StringIO(payload)
    err = io.StringIO()
    try:
        with contextlib.redirect_stderr(err):
            code = hook.main()
    finally:
        sys.stdin = stdin
    return code, err.getvalue()


class LexTests(unittest.TestCase):
    """The lexer itself: quotes, escapes, substitutions, heredocs and redirections."""

    def test_heredoc_body_is_skipped(self):
        command = (
            "python - <<'EOF'\n"
            "print(\"this mentions a versioned git pre-commit hook but is just text\")\n"
            "EOF\n"
            "git status"
        )
        segs = hook.lex(command)
        joined = " ".join(w for seg in segs for w in seg)
        self.assertNotIn("pre-commit", joined)
        self.assertIn(["git", "status"], segs)

    def test_heredoc_commit_message_is_one_token(self):
        """The false positive this hook used to have: a heredoc script, then a commit whose
        message is built with `$(cat <<'EOF' ... EOF)`. Neither heredoc body should look like a
        prior `git pre-commit` subcommand, and the real add/commit must still be found, with the
        (eventual) message read as a single value for -m."""
        command = (
            "python - <<'EOF'\n"
            "print(\"this mentions a versioned git pre-commit hook but is just text\")\n"
            "EOF\n"
            "git add index.html src && git commit -q -m \"$(cat <<'EOF'\n"
            "Rebuild: add a versioned git pre-commit hook description\n"
            "EOF\n"
            ")\""
        )
        segs = hook.lex(command)
        self.assertEqual(segs[-1][:2], ["git", "commit"])
        for seg in segs[:-1]:
            g = hook.parse_git(seg)
            if g:
                self.assertIn(g[0], hook.READ_ONLY_GIT | {"add"})
        self.assertIn("-m", segs[-1])
        self.assertEqual(len(segs[-1]) - segs[-1].index("-m"), 2)   # -m consumes exactly one value

    def test_escaped_quote_does_not_swallow_the_rest_of_the_command(self):
        segs = hook.lex('echo "a \\"b" && git push')
        self.assertEqual(segs, [["echo", 'a "b'], ["git", "push"]])

    def test_comment_with_an_apostrophe_does_not_open_an_unclosed_quote(self):
        segs = hook.lex("# don't forget\ngit push")
        self.assertEqual(segs, [["git", "push"]])

    def test_left_shift_in_a_substitution_is_not_read_as_a_heredoc(self):
        segs = hook.lex('python -c "print(1<<2)"\ngit push')
        self.assertEqual(segs, [["python", "-c", "print(1<<2)"], ["git", "push"]])

    def test_arithmetic_left_shift_is_opaque(self):
        segs = hook.lex("echo $((1<<3))")
        self.assertEqual(segs, [["echo", "$((1<<3))"]])

    def test_quoted_dash_capital_c_value(self):
        segs = hook.lex('git -C "E:/Project/pocket-universe" push')
        self.assertEqual(segs, [["git", "-C", "E:/Project/pocket-universe", "push"]])
        self.assertEqual(hook.parse_git(segs[0]), ("push", 3, "E:/Project/pocket-universe"))

    def test_quoted_dash_c_config_value(self):
        segs = hook.lex('git -c user.name="L" commit -m x')
        self.assertEqual(segs, [["git", "-c", "user.name=L", "commit", "-m", "x"]])
        self.assertEqual(hook.parse_git(segs[0])[0], "commit")

    def test_redirection_with_fd_is_dropped(self):
        self.assertEqual(hook.lex("git push origin main 2>&1"), [["git", "push", "origin", "main"]])
        self.assertEqual(hook.lex("git commit -m x 2>&1"), [["git", "commit", "-m", "x"]])

    def test_pipe_splits_and_plain_redirection_is_dropped(self):
        segs = hook.lex("git push 2>&1 | tail -20")
        self.assertEqual(segs, [["git", "push"], ["tail", "-20"]])

    def test_redirect_target_is_dropped(self):
        self.assertEqual(hook.lex("git push origin main > out.txt 2>/dev/null"),
                         [["git", "push", "origin", "main"]])

    def test_quoted_pipe_is_not_a_separator(self):
        segs = hook.lex('echo "a|b" | grep x')
        self.assertEqual(segs, [["echo", "a|b"], ["grep", "x"]])


class PushRefTests(unittest.TestCase):
    def test_plain_push(self):
        commits, pushes, segs = classify("git push origin main")
        self.assertEqual(pushes, [0])
        g = hook.parse_git(segs[0].tokens)
        self.assertEqual(hook.pushed_refs(segs[0].tokens, g[1]), ["main"])

    def test_refspec_with_plus_and_full_ref(self):
        tokens = ["git", "push", "origin", "+HEAD:refs/heads/x"]
        self.assertEqual(hook.pushed_refs(tokens, 1), ["HEAD"])

    def test_push_all(self):
        tokens = ["git", "push", "--all", "origin"]
        # --all pushes every local branch of *this* repo (never empty: at least the branch
        # this checkout is on); "origin" is just the remote, not treated as a ref
        refs = hook.pushed_refs(tokens, 1)
        self.assertTrue(refs)
        self.assertNotIn("origin", refs)

    def test_push_option_and_delete_are_skipped(self):
        """`-o ci.skip` is consumed as a value, and `:old` (a delete) pushes nothing: only
        `good` is checked."""
        tokens = ["git", "push", "-o", "ci.skip", "origin", ":old", "good"]
        self.assertEqual(hook.pushed_refs(tokens, 1), ["good"])

    def test_redirection_does_not_leak_into_refs(self):
        commits, pushes, segs = classify("git push origin main 2>&1")
        g = hook.parse_git(segs[pushes[0]].tokens)
        self.assertEqual(hook.pushed_refs(segs[pushes[0]].tokens, g[1]), ["main"])


class CommitParseTests(unittest.TestCase):
    def test_commit_dash_capital_f_value_is_skipped(self):
        commits, pushes, segs = classify("git commit -F msg.txt")
        self.assertEqual(commits, [0])
        g = hook.parse_git(segs[0].tokens)
        self.assertEqual(segs[0].tokens[g[1] + 1:], ["-F", "msg.txt"])

    def test_bundled_am_flag_consumes_quoted_message(self):
        commits, pushes, segs = classify('git commit -am "fix git push docs"')
        self.assertEqual(commits, [0])
        self.assertEqual(pushes, [])   # "git push" inside the message must not register as a push

    def test_add_then_commit_message_x(self):
        commits, pushes, segs = classify("git add -A && git commit -m x")
        self.assertEqual(len(segs), 2)
        self.assertEqual(commits, [1])
        self.assertEqual(pushes, [])
        self.assertEqual(hook.parse_git(segs[0].tokens)[0], "add")

    def test_commit_and_push_in_one_command_is_refused(self):
        code, err = run_main("git commit -m x && git push")
        self.assertEqual(code, 2)
        self.assertIn("separate commands", err)


class CommitProblemTests(unittest.TestCase):
    """commit_problem() exercised for real, against this repo (read-only: it always simulates
    staging on a throwaway GIT_INDEX_FILE copy, never the real index or working tree), with
    build.check/build.ensure stubbed out so the test doesn't depend on this repo's current
    build state."""

    def setUp(self):
        self.orig_check = hook.build.check
        self.orig_ensure = hook.build.ensure
        self.calls = []
        hook.build.check = lambda **kw: (self.calls.append(kw), None)[1]
        hook.build.ensure = lambda **kw: "current"

    def tearDown(self):
        hook.build.check = self.orig_check
        hook.build.ensure = self.orig_ensure

    def test_staging_is_followed_before_commit(self):
        commits, pushes, segs = classify("git add -A && git commit -m x")
        why = hook.commit_problem(segs, commits[0])
        self.assertIsNone(why)
        self.assertTrue(self.calls and self.calls[-1].get("staged") is True)

    def test_dash_capital_f_value_is_not_staged_as_a_path(self):
        commits, pushes, segs = classify("git commit -F msg.txt")
        why = hook.commit_problem(segs, commits[0])
        self.assertIsNone(why)


class FailSafeTests(unittest.TestCase):
    """The raw-text fail-safe for what the lexer couldn't resolve to a top-level commit/push --
    and that it stays scoped to this repository."""

    def setUp(self):
        self.orig_check = hook.build.check
        self.calls = []

        def fake_check(**kw):
            self.calls.append(kw)
            return None
        hook.build.check = fake_check

    def tearDown(self):
        hook.build.check = self.orig_check

    def test_heredoc_commit_message_mentioning_push_also_gates_as_a_possible_push(self):
        """The lexer finds only the commit (the word "push" is inside the heredoc body, not a
        real top-level `git push`); the raw-text fail-safe still treats it as a possible push,
        since a hidden push slipping through is worse than an extra gate run."""
        command = (
            "git commit -q -m \"$(cat <<'EOF'\n"
            "Mentions git push in passing\n"
            "EOF\n"
            ")\""
        )
        commits, pushes, segs = classify(command)
        self.assertEqual(len(commits), 1)
        self.assertEqual(pushes, [])
        self.assertTrue(hook.PUSH.search(command))   # the raw text does mention "git push"
        refs = hook.push_refs_for(command, segs, pushes, scoped=True)
        self.assertEqual(refs, ["HEAD"])

    def test_commit_fallback_runs_the_staged_check(self):
        code, err = run_main('echo "please run git commit for me"')
        self.assertEqual(code, 0)
        self.assertTrue(self.calls and self.calls[-1].get("staged") is True)

    def test_push_refs_for_out_of_scope_command_is_empty(self):
        """A command that never touches this repo must not trip the push fail-safe, even though
        its raw text matches `git ... push`."""
        command = 'cd "E:\\Project\\Coldstarter" && git add -A && git commit -q -m "x" && git push'
        refs = hook.push_refs_for(command, [], [], scoped=False)
        self.assertEqual(refs, [])

    def test_coldstarter_command_passes_untouched(self):
        """The exact shape of a real false positive: cd to a different repo, then commit, push
        and an unrelated `gh release create`, all outside this repository."""
        command = ('cd "E:\\Project\\Coldstarter" && git add -A '
                   '&& git commit -q -m "release notes" -m "more notes" '
                   '&& git push && gh release create v1.0.0 --notes "done"')
        commits, pushes, segs = classify(command)
        self.assertEqual(commits, [])
        self.assertEqual(pushes, [])
        scoped = hook.in_scope(segs, str(ROOT))
        self.assertFalse(scoped)
        refs = hook.push_refs_for(command, segs, pushes, scoped)
        self.assertEqual(refs, [])


class MainEndToEndTests(unittest.TestCase):
    def test_non_git_command_with_pipe_and_quotes_passes_untouched(self):
        # deliberately no "git" anywhere, even in the quoted text: main()'s cheap early exit
        # (and the fail-safe, which is intentionally willing to cost a gate run on raw text
        # that merely mentions "git push"/"git commit" -- see FailSafeTests) must not fire here
        code, err = run_main('echo "a|b" | grep "just some text"')
        self.assertEqual(code, 0)
        self.assertEqual(err, "")

    def test_coldstarter_push_is_not_gated_by_main(self):
        orig_check = hook.build.check
        calls = []
        hook.build.check = lambda **kw: (calls.append(kw), None)[1]
        try:
            command = ('cd "E:\\Project\\Coldstarter" && git add -A '
                       '&& git commit -q -m "release notes" -m "more notes" '
                       '&& git push && gh release create v1.0.0 --notes "done"')
            code, err = run_main(command)
            self.assertEqual(code, 0)
            self.assertEqual(err, "")
            self.assertEqual(calls, [])   # never even asked whether index.html is current
        finally:
            hook.build.check = orig_check


class TempRepoTests(unittest.TestCase):
    """A throwaway repo, for the one thing that needs a real (but disposable) git history:
    checking that a genuinely unrelated prior git subcommand still blocks the commit."""

    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="pu-hook-test-")
        subprocess.run(["git", "init", "-q"], cwd=self.tmp, check=True)
        subprocess.run(["git", "config", "user.email", "test@example.com"], cwd=self.tmp, check=True)
        subprocess.run(["git", "config", "user.name", "Test"], cwd=self.tmp, check=True)
        Path(self.tmp, "a.txt").write_text("a\n", encoding="utf-8")
        subprocess.run(["git", "add", "a.txt"], cwd=self.tmp, check=True)
        subprocess.run(["git", "commit", "-q", "-m", "init"], cwd=self.tmp, check=True)

    def test_real_prior_git_subcommand_still_blocks(self):
        segs = hook.segments("git rm a.txt && git commit -m x", self.tmp)
        self.assertEqual(len(segs), 2)
        why = hook.commit_problem(segs, 1)
        self.assertIsNotNone(why)
        self.assertIn("git rm", why)

    def test_add_is_exempt_in_a_real_repo(self):
        segs = hook.segments("git add a.txt && git status", self.tmp)
        g = hook.parse_git(segs[0].tokens)
        self.assertEqual(g[0], "add")


if __name__ == "__main__":
    unittest.main()
