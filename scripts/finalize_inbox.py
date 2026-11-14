#!/usr/bin/env python3
"""Finish building an inbox item once recipes/<slug>.json has been written.

    python scripts/finalize_inbox.py <inbox-id> <slug>

1. git mv every uploaded file in inbox/<id>/ to sources/<slug>/ (renames on clashes)
2. set recipe.source.files to the archived paths
3. git rm inbox/<id>/item.json and remove the folder
4. add a blank data/library.json entry for <slug> if missing (never edits existing ones)
5. rebuild recipes/index.json
Safe to re-run: already-moved files are detected; a missing inbox folder is accepted
only if <slug> already has a library entry. Exits 1 loudly on anything odd.
"""
import re
import shutil
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
import build_index  # noqa: E402

SLUG = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
JUNK = (".gitkeep", ".DS_Store", "Thumbs.db", "desktop.ini")


def die(msg):
    print(f"ERROR {msg}")
    sys.exit(1)


def rel(p):
    return p.relative_to(ROOT).as_posix()


def git(*args):
    return subprocess.run(["git", *args], cwd=ROOT, capture_output=True, text=True)


def tracked(p):
    return git("ls-files", "--error-unmatch", "--", rel(p)).returncode == 0


def write_json(path, obj):
    path.write_text(build_index.dump(obj), encoding="utf-8", newline="\n")


def free_dest(dest_dir, name, src):
    """sources/<slug>/<name>, or name-2.ext, name-3.ext… if taken by a different file."""
    dest = dest_dir / name
    stem, suffix, n = dest.stem, dest.suffix, 2
    while dest.exists():
        if src.exists() and dest.read_bytes() == src.read_bytes():
            return dest, True  # identical file already archived
        dest = dest_dir / f"{stem}-{n}{suffix}"
        n += 1
    return dest, False


def move(src, dest):
    dest.parent.mkdir(parents=True, exist_ok=True)
    if tracked(src):
        r = git("mv", "--", rel(src), rel(dest))
        if r.returncode != 0:
            die(f"git mv {rel(src)} -> {rel(dest)} failed: {r.stderr.strip()}")
        return "git mv"
    shutil.move(str(src), str(dest))
    return "moved (untracked)"


def remove(p):
    if tracked(p):
        r = git("rm", "-q", "-f", "--", rel(p))
        if r.returncode != 0:
            die(f"git rm {rel(p)} failed: {r.stderr.strip()}")
    elif p.exists():
        p.unlink()


def main():
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    if len(sys.argv) != 3:
        die("usage: python scripts/finalize_inbox.py <inbox-id> <slug>")
    item_id, slug = sys.argv[1], sys.argv[2]
    if not SLUG.match(slug):
        die(f"slug '{slug}' must be kebab-case [a-z0-9-]")

    rpath = ROOT / "recipes" / f"{slug}.json"
    recipe = build_index.load(rpath)
    if not isinstance(recipe, dict):
        die(f"write {rel(rpath)} first (missing or invalid JSON)")
    if recipe.get("slug") != slug:
        die(f"{rel(rpath)} has slug '{recipe.get('slug')}', expected '{slug}'")
    if recipe.get("status") != "built" or not (recipe.get("profile") or "").strip():
        die(f"{rel(rpath)} must have status 'built' and a profile before finalizing")

    lpath = ROOT / "data" / "library.json"
    lib = build_index.load(lpath)
    if not isinstance(lib, dict):
        die(f"cannot read {rel(lpath)}")
    lib.setdefault("recipes", {})

    folder = ROOT / "inbox" / item_id
    item_path = folder / "item.json"
    dest_dir = ROOT / "sources" / slug
    src_info = recipe.get("source") or {"type": "text", "url": None, "files": [], "author": None}
    recipe["source"] = src_info
    archived = [f for f in src_info.get("files") or [] if not f.startswith("inbox/")]

    if not folder.exists():
        mine = [f for f in src_info.get("files") or [] if f.startswith(f"inbox/{item_id}/")]
        if not mine and slug not in lib["recipes"]:
            ids = sorted(p.name for p in (ROOT / "inbox").iterdir() if p.is_dir())
            die(f"inbox/{item_id} not found | inbox ids: {', '.join(ids) or 'none'}")
        print(f"inbox/{item_id} already gone - finishing up")
        for f in mine:  # recovering from a run that died after moving files
            prior = dest_dir / Path(f).name
            if not prior.exists():
                die(f"{f} is gone and {rel(prior)} doesn't exist - find the file by hand")
            archived.append(rel(prior))
        if not mine:
            archived = list(src_info.get("files") or [])  # leave as-is
    else:
        item = build_index.load(item_path, {}) if item_path.exists() else {}
        if not isinstance(item, dict):
            die(f"{rel(item_path)} is not valid JSON - fix or remove it by hand")
        listed = [ROOT / f for f in item.get("files") or []]
        for junk in JUNK:
            if (folder / junk).exists():
                remove(folder / junk)
        on_disk = [p for p in sorted(folder.iterdir()) if p.is_file() and p.name != "item.json"]
        srcs = list(dict.fromkeys(listed + on_disk))  # listed first, then strays; no dupes
        for src in srcs:
            if src.parent != folder:
                die(f"{rel(src)} is outside inbox/{item_id}/ - refusing to move it")
            if not src.exists():
                prior = dest_dir / src.name
                if prior.exists():
                    print(f"already archived: {rel(prior)}")
                    archived.append(rel(prior))
                    continue
                die(f"listed file missing: {rel(src)}")
            dest, same = free_dest(dest_dir, src.name, src)
            if same:
                remove(src)
                print(f"duplicate of {rel(dest)} - removed {rel(src)}")
            else:
                how = move(src, dest)
                print(f"{how}: {rel(src)} -> {rel(dest)}")
            archived.append(rel(dest))
        if item_path.exists():
            remove(item_path)
        leftovers = [p.name for p in folder.iterdir()] if folder.exists() else []
        if leftovers:
            die(f"inbox/{item_id}/ still has: {', '.join(leftovers)} - not removed")
        try:
            if folder.exists():
                folder.rmdir()
            print(f"removed inbox/{item_id}/")
        except OSError:
            print(f"inbox/{item_id}/ is empty but couldn't be deleted (harmless: git ignores empty dirs)")

    files = list(dict.fromkeys(archived))
    if src_info.get("files") != files:
        src_info["files"] = files
        write_json(rpath, recipe)
        print(f"{rel(rpath)}: source.files = {files}")

    if slug not in lib["recipes"]:
        now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        lib["recipes"][slug] = {"tags": [], "rating": None, "proficiency": None,
                                "addedAt": now, "cooked": 0, "lastCooked": None}
        write_json(lpath, lib)
        print(f"library: added blank entry for {slug}")
    else:
        print("library: entry exists (untouched)")

    text = build_index.dump(build_index.build())
    cur = build_index.INDEX.read_text(encoding="utf-8") if build_index.INDEX.exists() else ""
    if text != cur:
        build_index.INDEX.write_text(text, encoding="utf-8", newline="\n")
        print("index updated")
    else:
        print("index unchanged")


if __name__ == "__main__":
    main()
