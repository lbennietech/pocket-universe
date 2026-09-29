#!/usr/bin/env python3
"""
Pocket Universe: build the claude.ai copy
Copyright (c) 2026 Luke Bennie <lukebennie@gmail.com>. All rights reserved.

Writes pocket-universe.html, the version published as a private claude.ai
artifact, from index.html (first rebuilding index.html from src/ with
tools/build.py if src/ changed, so the artifact is never stale). The
artifact host supplies its own <html>, <head> and <body>, so this keeps only
the title, viewport, fonts, styles, markup and script. pocket-universe.html is ignored by git.

    python tools/build_artifact.py
"""
import re
import sys
from pathlib import Path

import build  # tools/build.py

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "index.html"
OUT = ROOT / "pocket-universe.html"

HEADER = """<!--
  Pocket Universe: a gravity sandbox for the browser.
  Copyright (c) 2026 Luke Bennie <lukebennie@gmail.com>. All rights reserved.
  https://github.com/lbennietech/pocket-universe
-->
<title>Pocket Universe</title>
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
"""

# A marker comment written into pocket-universe.html so a later run can tell
# whether index.html has changed since the artifact was last built.
STAMP_RE = re.compile(r"<!-- built from index\.html sha256:([0-9a-f]+) -->\n")


def strip_css_comments_and_indent(css):
    """Drop /* ... */ comments and leading indentation from a <style> block's
    contents. Safe here because the game's CSS never uses '/*' inside a string
    or url()."""
    css = re.sub(r"/\*.*?\*/", "", css, flags=re.S)
    lines = [line.strip() for line in css.splitlines()]
    return "\n".join(line for line in lines if line)


def strip_styles(html):
    def repl(m):
        return "<style>" + strip_css_comments_and_indent(m.group(1)) + "</style>"
    return re.sub(r"<style>(.*?)</style>", repl, html, flags=re.S)


def main():
    import hashlib

    try:
        build.ensure()
    except build.BuildError as e:
        sys.exit("FAIL: " + str(e))
    html = SOURCE.read_text(encoding="utf-8")
    source_hash = hashlib.sha256(html.encode("utf-8")).hexdigest()

    if OUT.exists():
        existing = OUT.read_text(encoding="utf-8")
        m = STAMP_RE.search(existing)
        if m and m.group(1) == source_hash:
            print(f"{OUT.name} is already up to date with {SOURCE.name}")
            return

    start = html.index("<style>")
    end = html.rindex("</script>") + len("</script>")
    body = strip_styles(html[start:end])
    stamp = f"<!-- built from {SOURCE.name} sha256:{source_hash} -->\n"
    out_text = stamp + HEADER + body + "\n"
    OUT.write_text(out_text, encoding="utf-8", newline="\n")
    print(f"wrote {OUT.name} ({OUT.stat().st_size:,} bytes)")


if __name__ == "__main__":
    main()
