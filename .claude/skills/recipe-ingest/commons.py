#!/usr/bin/env python3
"""Find and set an openly licensed hero photo (Wikimedia Commons) for a recipe.

    python .claude/skills/recipe-ingest/commons.py search "<dish>" [--out DIR]
        → numbered candidates (CC0 / public domain / CC BY / CC BY-SA, ≥900 px) and a contact
          sheet DIR/candidates.jpg to look at with the Read tool
    python .claude/skills/recipe-ingest/commons.py use <slug> "File:<title>.jpg"
        → media/<slug>/hero.jpg (≤1600 px) + recipe.image (the site shows no photo credits)

Needs Pillow (pip install pillow). Commons asks for a descriptive User-Agent and rate-limits
bursts (HTTP 429): wait a minute and retry.
"""
import argparse
import io
import json
import re
import sys
import tempfile
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
UA = "bigback-recipe-vault/1.0 (personal recipe site; hero image lookup)"
API = "https://commons.wikimedia.org/w/api.php"
FREE = re.compile(r"^(cc0|public domain|pd\b|cc by(-sa)? [1-4]\.0)", re.I)


def get(url):
    return urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": UA}), timeout=60).read()


def api(**p):
    return json.loads(get(API + "?" + urllib.parse.urlencode({"action": "query", "format": "json", **p})))


def meta(ii):
    md = ii.get("extmetadata") or {}
    artist = re.sub(r"\s+", " ", re.sub(r"<[^>]+>", "", (md.get("Artist") or {}).get("value", ""))).strip()
    return artist[:80] or "Unknown", (md.get("LicenseShortName") or {}).get("value", "")


def search(q, out):
    from PIL import Image, ImageDraw
    d = api(generator="search", gsrsearch=f"{q} filetype:bitmap", gsrnamespace=6, gsrlimit=16,
            prop="imageinfo", iiprop="url|size|extmetadata|mime", iiurlwidth=400)
    pages = sorted((d.get("query") or {}).get("pages", {}).values(), key=lambda x: x.get("index", 0))
    hits = []
    for pg in pages:
        ii = (pg.get("imageinfo") or [{}])[0]
        artist, lic = meta(ii)
        if ii.get("mime") in ("image/jpeg", "image/png") and ii.get("width", 0) >= 900 and FREE.match(lic):
            hits.append((pg["title"], ii, artist, lic))
    hits = hits[:8]
    if not hits:
        print(f"no openly licensed photos for {q!r}; try a broader or different name")
        return
    sheet = Image.new("RGB", (1600, 600), "white")
    draw = ImageDraw.Draw(sheet)
    for i, (title, ii, artist, lic) in enumerate(hits):
        try:
            im = Image.open(io.BytesIO(get(ii["thumburl"]))).convert("RGB")
            im.thumbnail((400, 300))
            x, y = (i % 4) * 400, (i // 4) * 300
            sheet.paste(im, (x, y))
            draw.rectangle([x, y, x + 30, y + 24], fill="black")
            draw.text((x + 8, y + 6), str(i), fill="yellow")
        except Exception:
            pass
        print(f'{i}  "{title}"  {ii["width"]}x{ii["height"]}  {lic}  {artist[:40]}')
    out.mkdir(parents=True, exist_ok=True)
    sheet.save(out / "candidates.jpg", quality=80)
    print(f"contact sheet: {out / 'candidates.jpg'}")


def use(slug, title):
    from PIL import Image
    rp = ROOT / "recipes" / f"{slug}.json"
    r = json.loads(rp.read_text(encoding="utf-8"))
    pg = next(iter(api(titles=title, prop="imageinfo", iiprop="url|extmetadata", iiurlwidth=1600)["query"]["pages"].values()))
    if "imageinfo" not in pg:
        sys.exit(f"not found on Commons: {title}")
    ii = pg["imageinfo"][0]
    artist, lic = meta(ii)
    if not FREE.match(lic):
        sys.exit(f"{title}: license {lic!r} isn't open enough")
    img = Image.open(io.BytesIO(get(ii.get("thumburl") or ii["url"]))).convert("RGB")
    img.thumbnail((1600, 1600))
    dest = ROOT / "media" / slug / "hero.jpg"
    dest.parent.mkdir(parents=True, exist_ok=True)
    img.save(dest, quality=82, optimize=True, progressive=True)
    out = {k: (f"media/{slug}/hero.jpg" if k == "image" else v) for k, v in r.items() if k != "imageCredit"}
    sys.path.insert(0, str(ROOT / "scripts"))
    import build_index
    rp.write_text(build_index.dump(out), encoding="utf-8", newline="\n")
    print(f"{slug}: media/{slug}/hero.jpg {img.size[0]}x{img.size[1]} | {artist} | {lic}")


def main():
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("search")
    s.add_argument("query")
    s.add_argument("--out", default=None)
    u = sub.add_parser("use")
    u.add_argument("slug")
    u.add_argument("title")
    a = ap.parse_args()
    if a.cmd == "search":
        search(a.query, Path(a.out or tempfile.mkdtemp(prefix="commons-")))
    else:
        use(a.slug, a.title)


if __name__ == "__main__":
    main()
