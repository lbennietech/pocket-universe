#!/usr/bin/env python3
"""
Pocket Universe: Claude usage report
Copyright (c) 2026 Luke Bennie <lukebennie@gmail.com>. All rights reserved.

Reads this project's Claude Code session transcripts (kept locally under
~/.claude/projects/<slug>/, one .jsonl per session and one per sub-agent run)
and prices every run by model, so /audit can see where the usage goes without
spending model tokens on it. Prints a short table, then any findings in the
audit format for triage.

Prices are Anthropic API list prices, used as a proxy for how fast a run eats
a Pro plan's usage limit; they are not the plan's own meter. Only sessions run
on this machine are counted.

    python tools/usage_report.py                  # everything so far
    python tools/usage_report.py --since last     # since the last --save
    python tools/usage_report.py --since 2026-09-29 --save

--save appends a summary to .claude/usage-history.json, which the next report
compares against.
"""

import argparse
import collections
import datetime as dt
import glob
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HISTORY = os.path.join(ROOT, ".claude", "usage-history.json")

# $ per million tokens: input, cache read, output. Cache writes are priced
# from input: x1.25 for the 5-minute cache, x2 for the 1-hour cache.
PRICES = {"opus": (4.0, 0.20, 20.0), "sonnet": (2.0, 0.20, 10.0),
          "haiku": (1.0, 0.10, 5.0), "fable": (10.0, 0.25, 50.0)}
BIG_WRITE = 20000      # a cache write this big after an idle gap is a re-cache
MAIN_PEAK = 250000     # main-session context worth flagging (compaction is at 200K)
FORK_PEAK = 200000


def family(model):
    for f in PRICES:
        if model and f in model:
            return f
    return "sonnet"


def when(stamp):
    return dt.datetime.fromisoformat(stamp.replace("Z", "+00:00"))


def read_run(path, cutoff=None):
    """One transcript: per-message usage, deduplicated by message id (a
    streamed message is logged several times; keep the largest counts).
    Messages before cutoff are skipped, so a session that spans it counts
    only its later part."""
    msgs = {}
    for line in open(path, encoding="utf-8", errors="replace"):
        try:
            d = json.loads(line)
        except ValueError:
            continue
        m = d.get("message")
        if d.get("type") != "assistant" or not isinstance(m, dict) or not m.get("id"):
            continue
        u = m.get("usage") or {}
        cc = u.get("cache_creation") or {}
        cur = msgs.setdefault(m["id"], {"model": m.get("model"), "t": d.get("timestamp")})
        for key, val in (("in", u.get("input_tokens")), ("read", u.get("cache_read_input_tokens")),
                         ("out", u.get("output_tokens")), ("w", u.get("cache_creation_input_tokens")),
                         ("w5", cc.get("ephemeral_5m_input_tokens")), ("w1", cc.get("ephemeral_1h_input_tokens"))):
            cur[key] = max(cur.get(key, 0), val or 0)
    run = {"cost": 0.0, "turns": 0, "peak": 0, "idle_cost": 0.0, "idle_n": 0,
           "start": None, "model": collections.Counter()}
    last = None
    for m in sorted(msgs.values(), key=lambda m: m["t"] or ""):
        if not m["t"]:
            continue
        t = when(m["t"])
        if cutoff and t < cutoff:
            last = t
            continue
        run["turns"] += 1
        p_in, p_read, p_out = PRICES[family(m["model"])]
        w5, w1 = m.get("w5", 0), m.get("w1", 0)
        if not (w5 or w1):
            w1 = m.get("w", 0)
        write = (w5 * 1.25 + w1 * 2) * p_in / 1e6
        run["cost"] += m["in"] * p_in / 1e6 + write + m["read"] * p_read / 1e6 + m["out"] * p_out / 1e6
        run["peak"] = max(run["peak"], m["in"] + m["w"] + m["read"])
        run["model"][family(m["model"])] += 1
        run["start"] = run["start"] or t
        ttl = 3600 if w1 > w5 else 300
        if last and (t - last).total_seconds() > ttl and m["w"] > BIG_WRITE:
            run["idle_n"] += 1
            run["idle_cost"] += write
        last = t
    run["model"] = run["model"].most_common(1)[0][0] if run["model"] else "-"
    return run


def runs(project_dir, cutoff):
    for session in glob.glob(os.path.join(project_dir, "*.jsonl")):
        sid = os.path.basename(session)[:-6]
        r = read_run(session, cutoff)
        r.update(kind="main session", desc="", sid=sid[:8])
        yield r
        for path in glob.glob(os.path.join(project_dir, sid, "subagents", "*.jsonl")):
            meta_path = path[:-6] + ".meta.json"
            meta = json.load(open(meta_path, encoding="utf-8")) if os.path.exists(meta_path) else {}
            r = read_run(path, cutoff)
            r.update(kind=meta.get("agentType", "?"), desc=meta.get("description", ""), sid=sid[:8])
            yield r


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[1])
    ap.add_argument("--since", help="YYYY-MM-DD, or 'last' for the last --save")
    ap.add_argument("--save", action="store_true", help="append a summary to .claude/usage-history.json")
    ap.add_argument("--project-dir", help="transcript folder (default: derived from the repo path)")
    args = ap.parse_args()
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")

    project_dir = args.project_dir or os.path.join(
        os.path.expanduser("~"), ".claude", "projects", re.sub(r"[^A-Za-z0-9]", "-", ROOT))
    if not os.path.isdir(project_dir):
        sys.exit(f"No transcripts found at {project_dir} (pass --project-dir).")
    history = json.load(open(HISTORY, encoding="utf-8")) if os.path.exists(HISTORY) else []
    since = None
    if args.since == "last":
        since = history[-1]["until"] if history else None
    elif args.since:
        since = args.since
    cutoff = when(since + "T00:00:00Z") if since and len(since) == 10 else (when(since) if since else None)

    all_runs = [r for r in runs(project_dir, cutoff) if r["turns"]]
    if not all_runs:
        print(f"No Claude usage since {since}.")
        return
    total = sum(r["cost"] for r in all_runs)
    kinds = collections.defaultdict(list)
    for r in all_runs:
        kinds[r["kind"]].append(r)

    period = f"{min(r['start'] for r in all_runs):%Y-%m-%d} to {max(r['start'] for r in all_runs):%Y-%m-%d}"
    print(f"Claude usage, {period}: {len(all_runs)} run{'s' if len(all_runs) > 1 else ''}, ${total:.2f} at API list prices "
          f"(a proxy for plan usage, not its meter)\n")
    print(f"{'kind':22} {'runs':>4} {'share':>6} {'$/run':>6} {'turns/run':>9} {'peak ctx':>9} {'idle re-cache':>13}")
    rows = sorted(kinds.items(), key=lambda kv: -sum(r["cost"] for r in kv[1]))
    summary = {}
    for kind, rs in rows:
        cost = sum(r["cost"] for r in rs)
        idle = sum(r["idle_cost"] for r in rs)
        summary[kind] = {"share": round(cost / total, 3), "per_run": round(cost / len(rs), 2),
                         "turns": round(sum(r["turns"] for r in rs) / len(rs))}
        print(f"{kind[:22]:22} {len(rs):4} {100 * cost / total:5.1f}% {cost / len(rs):6.2f} "
              f"{sum(r['turns'] for r in rs) / len(rs):9.0f} {max(r['peak'] for r in rs) // 1000:8}K "
              f"{100 * idle / cost if cost else 0:12.0f}%")
    print("\nMost expensive runs:")
    for r in sorted(all_runs, key=lambda r: -r["cost"])[:5]:
        print(f"  {r['cost']:6.2f}  {r['kind'][:18]:18} {r['model']:6} {r['turns']:4} turns  "
              f"{r['start']:%m-%d %H:%M}  {r['desc'][:50]}")

    # Findings in the audit format, for triage.
    findings = []

    def finding(title, evidence, share, proposal):
        impact = 4 if share >= 0.2 else 3 if share >= 0.1 else 2
        if share * total < 2:  # a big share of a small period is still small
            impact = 1
        findings.append(f"### [USAGE-###] {title}\n- **Area:** usage\n- **Evidence:** {evidence}\n"
                        f"- **Impact:** {impact}   **Dev effort:** 1\n- **Proposal:** {proposal}")

    for r in all_runs:
        if r["kind"] == "main session" and r["peak"] > MAIN_PEAK:
            finding(f"Main session {r['sid']} grew to {r['peak'] // 1000}K tokens",
                    f"session {r['sid']}, {r['turns']} turn{'s' if r['turns'] > 1 else ''}, ${r['cost']:.2f} ({100 * r['cost'] / total:.0f}% of the period)",
                    r["cost"] / total,
                    "Check `autoCompactWindow` in `.claude/settings.json` is set and honoured, and follow "
                    "\"Keeping this session lean\" in the iterate skill (partial reads, /clear between batches).")
    for kind, rs in rows:
        cost = sum(r["cost"] for r in rs)
        idle = sum(r["idle_cost"] for r in rs)
        if idle > 1.0 and idle / cost > 0.25:
            agent_file = os.path.join(ROOT, ".claude", "agents", kind + ".md")
            has_1h = os.path.exists(agent_file) and "cacheTtl: 1h" in open(agent_file, encoding="utf-8").read()
            finding(f"{kind} re-caches its context after idle gaps",
                    f"{sum(r['idle_n'] for r in rs)} re-caches cost ${idle:.2f} of its ${cost:.2f}",
                    idle / total,
                    ("It already has a one-hour cache, so its gaps are longer than an hour: resume it sooner "
                     "after reviews, or start a fresh agent with a short brief instead of resuming."
                     if has_1h else
                     "Give the agent `experimental: cacheTtl: 1h` in its frontmatter, or stop it waiting on long "
                     "commands (benchmarks) and long reviews between rounds."))
    high = [r for r in all_runs if re.search(r"/code-review (high|xhigh|max)", r["desc"])]
    if high:
        cost = sum(r["cost"] for r in high)
        finding(f"{len(high)} /code-review run{'s' if len(high) > 1 else ''} above medium",
                f"${cost:.2f} for the lead agents alone, before their sub-agents; " +
                ", ".join(f"{r['start']:%m-%d} {r['desc'][:30]}" for r in high[:3]),
                cost / total, "Keep to the levels the iterate skill names (high only for Deep items or on request).")
    forks = [r for r in all_runs if r["kind"] == "fork" and r["peak"] > FORK_PEAK]
    if forks:
        cost = sum(r["cost"] for r in forks)
        finding(f"{len(forks)} fork{'s' if len(forks) > 1 else ''} started with a large copied context",
                f"peak {max(r['peak'] for r in forks) // 1000}K tokens, ${cost:.2f}", cost / total,
                "Use a typed agent with a short brief instead of a fork when the session is large.")
    if history:
        prev = history[-1]["kinds"]
        for kind, s in summary.items():
            p = prev.get(kind)
            if p and p["turns"] and s["turns"] > 1.5 * p["turns"] and s["per_run"] > 1.5 * p["per_run"]:
                finding(f"{kind} runs got longer and costlier",
                        f"{p['turns']} -> {s['turns']} turns/run, ${p['per_run']} -> ${s['per_run']} per run "
                        f"since {history[-1]['until']}", s["share"],
                        "Read two recent runs' briefs and reports to see why (scope creep, a missing result in the "
                        "brief, a tool that stopped working) before changing its model or effort.")

    print(f"\nFindings ({len(findings)}):" if findings else "\nNo findings.")
    for f in findings:
        print("\n" + f)
    print("\nModel or effort changes trade quality for usage: flag them for the user's decision rather "
          "than applying them.")

    if args.save:
        history.append({"until": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"), "since": since, "total_usd": round(total, 2),
                        "runs": len(all_runs), "kinds": summary})
        with open(HISTORY, "w", encoding="utf-8", newline="\n") as fh:
            json.dump(history, fh, indent=1)
            fh.write("\n")
        print(f"\nSaved to {os.path.relpath(HISTORY, ROOT)}.")


if __name__ == "__main__":
    main()
