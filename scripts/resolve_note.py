#!/usr/bin/env python3
"""Close journal notes after refinement: set status, resolution, resolvedAt; rebuild index.

    python scripts/resolve_note.py <slug> <note-id>[,<note-id>...] <applied|kept> "<resolution>"

Only touches status/resolution/resolvedAt - never the user's note text.
"""
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
import build_index  # noqa: E402

STATUSES = ("applied", "kept")


def die(msg):
    print(f"ERROR {msg}")
    sys.exit(1)


def write_index():
    text = build_index.dump(build_index.build())
    cur = build_index.INDEX.read_text(encoding="utf-8") if build_index.INDEX.exists() else ""
    if text != cur:
        build_index.INDEX.write_text(text, encoding="utf-8", newline="\n")
        return "index updated"
    return "index unchanged"


def main():
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    args = sys.argv[1:]
    if len(args) != 4:
        die("usage: " + __doc__.strip().splitlines()[2].strip())
    slug, ids, status, resolution = args
    if status not in STATUSES:
        die(f"status must be one of {'|'.join(STATUSES)}, got '{status}'")
    resolution = " ".join(resolution.split())
    if not resolution:
        die("resolution text is required (one line telling the user what changed)")

    path = ROOT / "journal" / f"{slug}.json"
    j = build_index.load(path)
    if not isinstance(j, dict):
        die(f"cannot read {path.relative_to(ROOT).as_posix()}")
    entries = {e.get("id"): e for e in j.get("entries") or []}
    wanted = [i.strip() for i in ids.split(",") if i.strip()]
    missing = [i for i in wanted if i not in entries]
    if missing:
        opened = [k for k, e in entries.items() if e.get("status") == "open"]
        die(f"note(s) not found in {slug}: {', '.join(missing)} | open: {', '.join(opened) or 'none'}")

    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    for i in wanted:
        e = entries[i]
        prev = e.get("status")
        e["status"], e["resolution"], e["resolvedAt"] = status, resolution, now
        print(f"{i}: {prev} -> {status}" + ("" if prev == "open" else " (was already resolved; overwritten)"))
    path.write_text(build_index.dump(j), encoding="utf-8", newline="\n")
    left = sum(1 for e in j.get("entries") or [] if e.get("status") == "open")
    print(f"{slug}: {left} open left · {write_index()}")


if __name__ == "__main__":
    main()
