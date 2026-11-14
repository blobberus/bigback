#!/usr/bin/env python3
"""Source helpers for recipe-ingest (Python stdlib only, compact output).

    python .claude/skills/recipe-ingest/extract.py jsonld <url | saved.html>
        schema.org Recipe JSON-LD -> name, author, yield, times (min), ingredients, steps.
        Exit 2 if the page has no Recipe JSON-LD (then use WebFetch on the page text).
    python .claude/skills/recipe-ingest/extract.py vtt <file.vtt | file.srt>
        auto-subtitles -> de-duplicated plain transcript (rolling captions collapsed).
"""
import html
import json
import re
import sys
import urllib.request
from pathlib import Path

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36"
LD = re.compile(r'<script[^>]+type=["\']application/ld\+json["\'][^>]*>(.*?)</script>', re.S | re.I)
DUR = re.compile(r"P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$")


def fetch(src):
    p = Path(src)
    if p.exists():
        return p.read_text(encoding="utf-8", errors="replace")
    req = urllib.request.Request(src, headers={"User-Agent": UA, "Accept-Language": "en"})
    with urllib.request.urlopen(req, timeout=25) as r:
        return r.read().decode(r.headers.get_content_charset() or "utf-8", errors="replace")


def walk(node):
    if isinstance(node, list):
        for n in node:
            yield from walk(n)
    elif isinstance(node, dict):
        yield node
        for k in ("@graph", "mainEntity", "itemListElement"):
            if k in node:
                yield from walk(node[k])


def is_recipe(d):
    t = d.get("@type")
    return "Recipe" in (t if isinstance(t, list) else [t])


def minutes(v):
    m = DUR.match(str(v or "").strip())
    if not m or not any(m.groups()):
        return None
    d, h, mi, s = (float(x) if x else 0 for x in m.groups())
    return round(d * 1440 + h * 60 + mi + s / 60)


def text(v):
    if isinstance(v, dict):
        v = v.get("name") or v.get("text") or ""
    if isinstance(v, list):
        return ", ".join(text(x) for x in v)
    s = " ".join(html.unescape(re.sub(r"<[^>]+>", " ", str(v or ""))).split())
    return re.sub(r"\s+([.,;:!?)])", lambda m: m.group(1), s)


def steps(node, out, prefix=""):
    if isinstance(node, str):
        for para in re.split(r"\n+", node):
            if text(para):
                out.append(prefix + text(para))
    elif isinstance(node, list):
        for n in node:
            steps(n, out, prefix)
    elif isinstance(node, dict):
        if "HowToSection" in str(node.get("@type")):
            out.append(f"## {text(node.get('name'))}")
            steps(node.get("itemListElement") or [], out, prefix)
        else:
            out.append(prefix + text(node.get("text") or node.get("name")))


def cmd_jsonld(src):
    page = fetch(src)
    recipe = None
    for block in LD.findall(page):
        try:
            data = json.loads(block.strip())
        except ValueError:
            continue
        recipe = next((d for d in walk(data) if is_recipe(d)), None)
        if recipe:
            break
    if not recipe:
        print("no schema.org Recipe JSON-LD found - use WebFetch on the page text")
        sys.exit(2)
    print(f"name: {text(recipe.get('name'))}")
    print(f"author: {text(recipe.get('author'))}")
    if recipe.get("description"):
        print(f"description: {text(recipe['description'])[:300]}")
    print(f"yield: {text(recipe.get('recipeYield'))}")
    print("time (min): " + ", ".join(f"{k}={minutes(recipe.get(k + 'Time'))}" for k in ("prep", "cook", "total")))
    print("ingredients:")
    for line in recipe.get("recipeIngredient") or []:
        print(f"- {text(line)}")
    out = []
    steps(recipe.get("recipeInstructions") or [], out)
    print("steps:")
    n = 0
    for s in (o for o in out if o):
        if not s.startswith("## "):
            n += 1
            s = f"{n}. {s}"
        print(s)
    notes = [text(recipe.get(k)) for k in ("recipeNotes", "notes") if recipe.get(k)]
    for n in notes:
        print(f"notes: {n[:600]}")


def cmd_vtt(src):
    lines, recent = [], []
    for raw in Path(src).read_text(encoding="utf-8", errors="replace").splitlines():
        line = html.unescape(re.sub(r"<[^>]+>", "", raw)).strip()
        if (not line or "-->" in line or line.isdigit()
                or line.startswith(("WEBVTT", "Kind:", "Language:", "NOTE"))):
            continue
        if line in recent:  # rolling auto-captions repeat the previous line
            continue
        lines.append(line)
        recent = (recent + [line])[-3:]
    print(" ".join(lines))


def main():
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    if len(sys.argv) != 3 or sys.argv[1] not in ("jsonld", "vtt"):
        print(__doc__.strip())
        sys.exit(1)
    try:
        (cmd_jsonld if sys.argv[1] == "jsonld" else cmd_vtt)(sys.argv[2])
    except OSError as e:
        print(f"ERROR {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
