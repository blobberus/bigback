#!/usr/bin/env python3
"""Compact worklist for "update the site": what needs building, enriching or refining.

    python scripts/pending.py          # human/agent-readable summary
    python scripts/pending.py --json   # machine output

Sections: INBOX (build with recipe-ingest), BLOCKED (inbox items a builder gave up on),
CUSTOM (user-typed recipes awaiting enrichment), NOTES (open journal entries by recipe,
apply with recipe-refinement). Open only the files listed here.
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
from build_index import load  # noqa: E402

EXCERPT = 200
SNIPPET = 60


def clip(s, n):
    s = " ".join(str(s or "").split())
    return s if len(s) <= n else s[: n - 1].rstrip() + "…"


def inbox_items():
    items = []
    for p in sorted((ROOT / "inbox").glob("*/item.json")):
        it = load(p)
        if not isinstance(it, dict):
            items.append({"id": p.parent.name, "error": "unreadable item.json"})
            continue
        files = it.get("files") or []
        text = it.get("text") or ""
        items.append({
            "id": it.get("id") or p.parent.name,
            "kind": it.get("kind") or "file",
            "title": it.get("title") or "",
            "url": it.get("url"),
            "files": files,
            "missing": [f for f in files if not (ROOT / f).exists()],
            "hint": it.get("hint"),
            "text": clip(text, EXCERPT) if text else None,
            "textLen": len(text),
            "blocked": it.get("blocked"),
            "createdAt": it.get("createdAt"),
        })
    items.sort(key=lambda x: x.get("createdAt") or "")
    return items


def recipes():
    out = {}
    for p in sorted((ROOT / "recipes").glob("*.json")):
        if p.name != "index.json":
            r = load(p)
            if isinstance(r, dict) and r.get("slug"):
                out[r["slug"]] = r
    return out


def custom_recipes(rs):
    return [{
        "slug": s,
        "title": r.get("title") or s,
        "ingredients": len(r.get("ingredients") or []),
        "steps": len(r.get("steps") or []),
    } for s, r in rs.items() if r.get("status") == "custom"]


def open_notes(rs):
    lib = (load(ROOT / "data" / "library.json", {}) or {}).get("recipes") or {}
    groups = []
    for p in sorted((ROOT / "journal").glob("*.json")):
        j = load(p)
        if not isinstance(j, dict):
            continue
        entries = [e for e in j.get("entries") or [] if e.get("status") == "open"]
        if not entries:
            continue
        slug = j.get("slug") or p.stem
        r = rs.get(slug)
        steps = {s.get("id"): s.get("text") or "" for s in (r or {}).get("steps") or []}
        notes = []
        for e in sorted(entries, key=lambda e: e.get("createdAt") or ""):
            sid = e.get("stepId") if e.get("scope") == "step" else None
            n = {
                "id": e.get("id"),
                "kind": e.get("kind") or "note",
                "stepId": sid,
                "text": e.get("text") or "",
                "photo": e.get("photo"),
                "date": (e.get("createdAt") or "")[:10],
            }
            if sid:
                cur = steps.get(sid)
                snap = e.get("stepText") or ""
                n["step"] = clip(cur if cur is not None else snap, SNIPPET)
                n["stepState"] = "gone" if cur is None else ("changed" if snap and snap.strip() != cur.strip() else "same")
            notes.append(n)
        le = lib.get(slug) or {}
        groups.append({
            "slug": slug,
            "title": (r or {}).get("title") or slug,
            "exists": r is not None,
            "rating": le.get("rating"),
            "proficiency": le.get("proficiency"),
            "cooked": le.get("cooked") or 0,
            "notes": notes,
        })
    return groups


def text_report(inbox, custom, groups):
    lines = []
    todo = [i for i in inbox if not i.get("blocked")]
    blocked = [i for i in inbox if i.get("blocked")]

    def item_lines(i):
        head = f"- {i['id']} {i.get('kind', '?')}"
        if i.get("title"):
            head += f' "{i["title"]}"'
        if i.get("url"):
            head += f" {i['url']}"
        out = [head]
        if i.get("error"):
            out.append(f"  ERROR {i['error']}")
        if i.get("files"):
            out.append("  files: " + ", ".join(i["files"]))
        if i.get("missing"):
            out.append("  MISSING: " + ", ".join(i["missing"]))
        if i.get("hint"):
            out.append(f"  hint: {clip(i['hint'], EXCERPT)}")
        if i.get("text"):
            more = f" ({i['textLen']} chars - read item.json)" if i["textLen"] > EXCERPT else ""
            out.append(f"  text: {i['text']}{more}")
        if i.get("blocked"):
            out.append(f"  blocked: {i['blocked']}")
        return out

    if todo:
        lines.append(f"INBOX {len(todo)} -> build (skill recipe-ingest), then finalize_inbox.py <id> <slug>")
        for i in todo:
            lines += item_lines(i)
    if blocked:
        lines.append(f"BLOCKED {len(blocked)} -> retry only if the item now has what was asked for")
        for i in blocked:
            lines += item_lines(i)
    if custom:
        lines.append(f"CUSTOM {len(custom)} -> enrich (skill recipe-ingest, custom section)")
        for c in custom:
            lines.append(f"- {c['slug']} \"{c['title']}\" {c['ingredients']} ing, {c['steps']} steps")
    if groups:
        total = sum(len(g["notes"]) for g in groups)
        lines.append(f"NOTES {total} open in {len(groups)} recipe(s) -> skill recipe-refinement, resolve_note.py")
        for g in groups:
            ctx = []
            if g["rating"] is not None:
                ctx.append(f"rating {g['rating']}/10")
            if g["proficiency"] is not None:
                ctx.append(f"prof {g['proficiency']}/5")
            if g["cooked"]:
                ctx.append(f"cooked {g['cooked']}x")
            head = f"- {g['slug']}" + (f" ({', '.join(ctx)})" if ctx else "")
            if not g["exists"]:
                head += " RECIPE MISSING"
            lines.append(head)
            for n in g["notes"]:
                where = "recipe"
                if n["stepId"]:
                    flag = {"gone": " [step gone]", "changed": " [step edited since note]"}.get(n["stepState"], "")
                    where = f'{n["stepId"]} "{n["step"]}"{flag}'
                body = n["text"] or "(no text)"
                photo = f" photo: {n['photo']}" if n.get("photo") else ""
                lines.append(f"  {n['id']} {n['date']} {where}: {body}{photo}")
    return "\n".join(lines) if lines else "Nothing to do"


def main():
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    rs = recipes()
    inbox, custom, groups = inbox_items(), custom_recipes(rs), open_notes(rs)
    if "--json" in sys.argv:
        print(json.dumps({"inbox": inbox, "custom": custom, "notes": groups}, indent=2, ensure_ascii=False))
    else:
        print(text_report(inbox, custom, groups))


if __name__ == "__main__":
    main()
