#!/usr/bin/env python3
"""Validate repo data against docs/SCHEMA.md. Exit 1 on errors (warnings don't fail).

    python scripts/validate.py
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
import build_index  # noqa: E402

SLUG = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
ING_ID = re.compile(r"^i\d+$")
STEP_ID = re.compile(r"^s\d+$")
SOURCE_TYPES = {"custom", "pdf", "youtube", "instagram", "tiktok", "web", "image", "text"}
NOTE_STATUS = {"open", "applied", "kept"}

errors, warnings = [], []
err = lambda where, msg: errors.append(f"{where}: {msg}")
warn = lambda where, msg: warnings.append(f"{where}: {msg}")


def load(path):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except ValueError as e:
        err(path.relative_to(ROOT).as_posix(), f"invalid JSON ({e})")
    except OSError:
        pass
    return None


def check_recipe(p):
    where = p.relative_to(ROOT).as_posix()
    r = load(p)
    if not isinstance(r, dict):
        return None
    slug = r.get("slug")
    if slug != p.stem:
        err(where, f"slug '{slug}' must match filename")
    if not slug or not SLUG.match(slug or ""):
        err(where, "slug must be kebab-case")
    for k in ("title", "ingredients", "steps"):
        if not r.get(k):
            err(where, f"missing '{k}'")
    status = r.get("status", "built")
    if status not in ("built", "custom"):
        err(where, f"status '{status}' must be built|custom")
    if status == "built" and not (r.get("profile") or "").strip():
        err(where, "built recipes need a 'profile' paragraph")
    if (r.get("source") or {}).get("type", "custom") not in SOURCE_TYPES:
        err(where, f"source.type must be one of {sorted(SOURCE_TYPES)}")
    if r.get("image") and not (ROOT / r["image"]).exists():
        warn(where, f"image not found: {r['image']}")
    for f in (r.get("source") or {}).get("files") or []:
        if not (ROOT / f).exists():
            warn(where, f"source file not found: {f}")

    seen = set()
    for i, ing in enumerate(r.get("ingredients") or []):
        iid = ing.get("id")
        if not iid or not ING_ID.match(iid):
            err(where, f"ingredient #{i + 1} id '{iid}' must look like i1")
        elif iid in seen:
            err(where, f"duplicate ingredient id {iid}")
        seen.add(iid)
        if not ing.get("item"):
            err(where, f"ingredient {iid} missing 'item'")
        for q in ("qty", "qtyMax"):
            if ing.get(q) is not None and not isinstance(ing[q], (int, float)):
                err(where, f"ingredient {iid} {q} must be a number or null")

    seen = set()
    for i, st in enumerate(r.get("steps") or []):
        sid = st.get("id")
        if not sid or not STEP_ID.match(sid):
            err(where, f"step #{i + 1} id '{sid}' must look like s1")
        elif sid in seen:
            err(where, f"duplicate step id {sid}")
        seen.add(sid)
        if not (st.get("text") or "").strip():
            err(where, f"step {sid} has no text")
        for t in st.get("timers") or []:
            if not isinstance(t.get("seconds"), int) or t["seconds"] <= 0:
                err(where, f"step {sid} timer seconds must be a positive integer")
    return r


def main():
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    recipes = {}
    for p in sorted((ROOT / "recipes").glob("*.json")):
        if p.name != "index.json":
            r = check_recipe(p)
            if r:
                recipes[r.get("slug")] = r

    lib_path = ROOT / "data" / "library.json"
    lib = load(lib_path) if lib_path.exists() else None
    if lib is None:
        warn("data/library.json", "missing")
    else:
        for slug, e in (lib.get("recipes") or {}).items():
            w = f"data/library.json[{slug}]"
            if slug not in recipes:
                warn(w, "entry for a recipe that doesn't exist")
            if e.get("rating") is not None and not (isinstance(e["rating"], int) and 1 <= e["rating"] <= 10):
                err(w, "rating must be 1-10 or null")
            if e.get("proficiency") is not None and not (isinstance(e["proficiency"], int) and 1 <= e["proficiency"] <= 5):
                err(w, "proficiency must be 1-5 or null")
            if not isinstance(e.get("tags", []), list):
                err(w, "tags must be a list")
        for slug in recipes:
            if slug not in (lib.get("recipes") or {}):
                warn("data/library.json", f"no entry for '{slug}' (add a blank one)")
        for pl in lib.get("playlists") or []:
            for s in pl.get("recipes") or []:
                if s not in recipes:
                    warn(f"playlist {pl.get('name')}", f"unknown recipe '{s}'")

    for p in sorted((ROOT / "journal").glob("*.json")):
        where = p.relative_to(ROOT).as_posix()
        j = load(p)
        if not isinstance(j, dict):
            continue
        r = recipes.get(p.stem)
        if r is None:
            warn(where, "journal for a recipe that doesn't exist")
        step_ids = {s.get("id") for s in (r or {}).get("steps") or []}
        ids = set()
        for e in j.get("entries") or []:
            if e.get("id") in ids:
                err(where, f"duplicate entry id {e.get('id')}")
            ids.add(e.get("id"))
            if e.get("status") not in NOTE_STATUS:
                err(where, f"{e.get('id')}: status must be open|applied|kept")
            if e.get("scope") == "step" and r and e.get("stepId") not in step_ids:
                warn(where, f"{e.get('id')}: stepId {e.get('stepId')} no longer exists")
            if e.get("photo") and not (ROOT / e["photo"]).exists():
                warn(where, f"{e.get('id')}: photo not found {e['photo']}")

    for p in sorted((ROOT / "inbox").glob("*/item.json")):
        it = load(p) or {}
        for f in it.get("files") or []:
            if not (ROOT / f).exists():
                err(p.relative_to(ROOT).as_posix(), f"file missing: {f}")

    # Service worker precache must list every shipped JS/CSS file (offline support).
    sw = ROOT / "sw.js"
    if sw.exists():
        sw_text = sw.read_text(encoding="utf-8")
        for f in sorted([*ROOT.glob("js/**/*.js"), *ROOT.glob("css/*.css")]):
            rel = f.relative_to(ROOT).as_posix()
            if f"'{rel}'" not in sw_text:
                err("sw.js", f"SHELL precache list is missing {rel} (add it and bump VERSION)")

    expected = build_index.dump(build_index.build())
    idx = ROOT / "recipes" / "index.json"
    if not idx.exists() or idx.read_text(encoding="utf-8") != expected:
        err("recipes/index.json", "stale - run python scripts/build_index.py")

    for w in warnings:
        print("warn ", w)
    for e in errors:
        print("ERROR", e)
    print(f"{len(recipes)} recipes · {len(errors)} errors · {len(warnings)} warnings")
    sys.exit(1 if errors else 0)


if __name__ == "__main__":
    main()
