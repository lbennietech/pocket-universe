#!/usr/bin/env python3
"""
Pocket Universe: local server for agents
Copyright (c) 2026 Luke Bennie <lukebennie@gmail.com>. All rights reserved.

Serves the repo at http://localhost:8765/ so the Playwright browser tool (MCP)
can load the game. If a server is already answering, it just says so. It
waits until the page responds, then exits and leaves the server running.

    python tools/serve.py          # start (or confirm) the server
    python tools/serve.py --stop   # stop a server this script started
"""
import argparse
import os
import signal
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PORT = 8765
URL = f"http://localhost:{PORT}/"
PIDFILE = ROOT / "tools" / ".serve.pid"


def up():
    try:
        with urllib.request.urlopen(URL + "index.html", timeout=1) as r:
            return r.status == 200
    except OSError:
        return False


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--stop", action="store_true")
    a = ap.parse_args()
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
    if up():
        print(f"already serving {URL}")
        return
    flags = subprocess.CREATE_NEW_PROCESS_GROUP | subprocess.DETACHED_PROCESS if os.name == "nt" else 0
    proc = subprocess.Popen([sys.executable, "-m", "http.server", str(PORT), "--bind", "127.0.0.1"],
                            cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                            creationflags=flags, start_new_session=os.name != "nt")
    PIDFILE.write_text(str(proc.pid))
    for _ in range(50):
        if up():
            print(f"serving {URL} (pid {proc.pid})")
            return
        time.sleep(0.1)
    sys.exit(f"server didn't come up on {URL}")


if __name__ == "__main__":
    main()
