#!/usr/bin/env python3
"""
Pocket Universe: build the claude.ai copy
Copyright (c) 2026 Luke Bennie <lukebennie@gmail.com>. All rights reserved.

Writes pocket-universe.html, the version published as a private claude.ai
artifact, from index.html. The artifact host supplies its own <html>, <head>
and <body>, so this keeps only the title, viewport, fonts, styles, markup and
script. pocket-universe.html is ignored by git.

    python tools/build_artifact.py
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

HEADER = """<!--
  Pocket Universe: a gravity sandbox for the browser.
  Copyright (c) 2026 Luke Bennie <lukebennie@gmail.com>. All rights reserved.
  https://github.com/lbennietech/pocket-universe
-->
<title>Pocket Universe</title>
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
"""


def main():
    html = (ROOT / "index.html").read_text(encoding="utf-8")
    start = html.index('<link rel="preconnect"')
    end = html.rindex("</script>") + len("</script>")
    out = ROOT / "pocket-universe.html"
    out.write_text(HEADER + html[start:end] + "\n", encoding="utf-8", newline="\n")
    print(f"wrote {out.name} ({out.stat().st_size:,} bytes)")


if __name__ == "__main__":
    main()
