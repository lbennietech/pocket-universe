#!/usr/bin/env python3
"""
Pocket Universe hook: protect the benchmark baseline
Copyright (c) 2026 Luke Bennie <lukebennie@gmail.com>. All rights reserved.

PreToolUse hook for Edit/Write. bench/baseline.json may only change through
`python bench/run_bench.py --baseline`, so edits to it are denied.
"""
import json
import sys


def main():
    try:
        data = json.load(sys.stdin)
    except ValueError:
        return 0
    path = str((data.get("tool_input") or {}).get("file_path", "")).replace("\\", "/")
    if path.endswith("bench/baseline.json"):
        print(json.dumps({"hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "deny",
            "permissionDecisionReason": "bench/baseline.json only changes through `python bench/run_bench.py --baseline`, and only when the numbers genuinely improved or the measuring method changed."
        }}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
