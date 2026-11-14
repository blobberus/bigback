#!/usr/bin/env python3
"""Regenerate recipes/index.json from recipes/*.json, journal/*.json and inbox/*/item.json.

    python scripts/build_index.py          # write
    python scripts/build_index.py --check  # exit 1 if the index is stale (CI)

Mirrors summarize() in js/store.js — keep the two in sync.
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
INDEX = ROOT / "recipes" / "index.json"


def load(path, fallback=None):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return fallback


def dump(obj):
    return json.dumps(obj, indent=2, ensure_ascii=False) + "\n"


def summarize(r, open_notes):
    return {
        "slug": r["slug"],
        "title": r.get("title") or r["slug"],
        "summary": r.get("summary") or "",
        "image": r.get("image"),
        "time": r.get("time") or {},
        "servings": r.get("servings"),
        "status": r.get("status") or "built",
        "sourceType": (r.get("source") or {}).get("type") or "custom",
        "updatedAt": r.get("updatedAt") or r.get("createdAt"),
        "openNotes": open_notes,
    }


def build():
    recipes = []
    for p in sorted((ROOT / "recipes").glob("*.json")):
        if p.name == "index.json":
            continue
        r = load(p)
        if not isinstance(r, dict) or not r.get("slug"):
            print(f"skip (unreadable): {p.relative_to(ROOT)}", file=sys.stderr)
            continue
        j = load(ROOT / "journal" / f"{r['slug']}.json", {}) or {}
        open_notes = sum(1 for e in j.get("entries", []) if e.get("status") == "open")
        recipes.append(summarize(r, open_notes))
    recipes.sort(key=lambda x: x["title"].lower())

    pending = []
    for p in sorted((ROOT / "inbox").glob("*/item.json")):
        it = load(p)
        if not isinstance(it, dict):
            continue
        label = it.get("title") or it.get("url") or (it.get("files") or ["upload"])[0].split("/")[-1]
        pending.append({
            "id": it.get("id") or p.parent.name,
            "kind": it.get("kind") or "file",
            "title": label,
            "url": it.get("url"),
            "createdAt": it.get("createdAt"),
        })
    pending.sort(key=lambda x: x.get("createdAt") or "")
    return {"recipes": recipes, "pending": pending}


def main():
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    text = dump(build())
    current = INDEX.read_text(encoding="utf-8") if INDEX.exists() else ""
    if "--check" in sys.argv:
        if text != current:
            print("recipes/index.json is stale - run: python scripts/build_index.py")
            sys.exit(1)
        print("index up to date")
        return
    if text != current:
        INDEX.write_text(text, encoding="utf-8", newline="\n")
        print("wrote recipes/index.json")
    else:
        print("index unchanged")


if __name__ == "__main__":
    main()
