#!/usr/bin/env python3
"""
Pocket Universe: local server for agents
Copyright (c) 2026 Luke Bennie <lukebennie@gmail.com>. All rights reserved.

Serves the repo at http://localhost:8765/ so the Playwright browser tool (MCP)
can load the game. If a server is already answering, it just says so. It
waits until the page responds, then exits and leaves the server running.

The game is built from src/ (tools/build.py). This server rebuilds index.html
whenever the page is requested and src/ has changed since the last build, so
a reload always shows the current source. If index.html was edited by hand,
the page shows the build error instead.

    python tools/serve.py          # start (or confirm) the server
    python tools/serve.py --stop   # stop a server this script started

Inside a Windows virtualenv, python.exe is a launcher that starts the real
interpreter as a child, so --stop may leave the server running; close it
from Task Manager or use a non-venv Python.
"""
import argparse
import io
import os
import signal
import subprocess
import sys
import threading
import time
import urllib.request
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import build  # tools/build.py

ROOT = Path(__file__).resolve().parent.parent
PORT = 8765
URL = f"http://localhost:{PORT}/"
PIDFILE = ROOT / "tools" / ".serve.pid"
BUILDS = "X-Pocket-Universe-Build"   # response header: this server rebuilds from src/
BUILD_LOCK = threading.Lock()        # one rebuild at a time across request threads


def up():
    """None if nothing answers, else whether the server rebuilds index.html from src/."""
    try:
        with urllib.request.urlopen(URL + "index.html", timeout=1) as r:
            return r.headers.get(BUILDS) == "1" if r.status == 200 else None
    except OSError:
        return None


class Handler(SimpleHTTPRequestHandler):
    """Serves the repo, rebuilding index.html from src/ first when it's asked for."""

    def send_head(self):
        if self.path.split("?")[0].split("#")[0] not in ("/", "/index.html"):
            return super().send_head()
        try:
            # rebuild and read under one lock, so a concurrent rebuild can't hand out a mixed file
            with BUILD_LOCK:
                build.ensure(quiet=True)
                body = build.OUT.read_bytes()
        except Exception as e:   # show the cause in the browser, whatever it is
            self.send_error(500, "index.html can't be rebuilt from src/", f"{type(e).__name__}: {e}")
            return None
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        return io.BytesIO(body)

    def end_headers(self):
        self.send_header(BUILDS, "1")
        super().end_headers()

    def log_message(self, *args):
        pass


def serve():
    ThreadingHTTPServer(("127.0.0.1", PORT), partial(Handler, directory=str(ROOT))).serve_forever()


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--stop", action="store_true")
    ap.add_argument("--child", action="store_true", help=argparse.SUPPRESS)   # the server process itself
    a = ap.parse_args()
    if a.child:
        serve()
        return
    if a.stop:
        if PIDFILE.exists():
            pid = int(PIDFILE.read_text())
            try:
                os.kill(pid, signal.SIGTERM)
            except OSError:
                pass
            PIDFILE.unlink()
            print("stopped")
        else:
            print("no server started by this script")
        return
    try:
        build.ensure()
    except build.BuildError as e:
        sys.exit("FAIL: " + str(e))
    state = up()
    if state is not None:
        print(f"already serving {URL}")
        if not state:
            print("WARNING: that server doesn't rebuild index.html from src/, so it can show a stale build. "
                  "Stop it (python tools/serve.py --stop, or close it) and run this again.")
        return
    flags = subprocess.CREATE_NEW_PROCESS_GROUP | subprocess.DETACHED_PROCESS if os.name == "nt" else 0
    proc = subprocess.Popen([sys.executable, str(Path(__file__).resolve()), "--child"],
                            cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                            creationflags=flags, start_new_session=os.name != "nt")
    for _ in range(50):
        if up() is not None:
            # only remember a server that actually answered
            PIDFILE.write_text(str(proc.pid))
            print(f"serving {URL} (pid {proc.pid})")
            return
        time.sleep(0.1)
    proc.kill()
    sys.exit(f"server didn't come up on {URL} (is something else using port {PORT}?)")


if __name__ == "__main__":
    main()
