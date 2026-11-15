#!/usr/bin/env python3
"""Turn a recipe video link into things Claude can read: caption, transcript, frame sheets.

    python .claude/skills/recipe-video/reel.py <url> [--out DIR] [--sheets N] [--model small]
                                               [--no-video] [--no-transcript]

Instagram (reel / p / tv links): the caption, author, cover image and the video file come from
Instagram's public embed page (no login, no cookies, stdlib only). Other sites (TikTok, YouTube,
Facebook…) and Instagram posts the embed page won't serve: falls back to yt-dlp if installed.

Then, when the optional packages are installed (pip install -r requirements.txt next to this file):
  frames      PyAV + Pillow → sheets/sheet-NN.jpg: contact sheets of evenly spaced frames, each
              stamped with its time, so on-screen text (amounts, temps) can be read with the Read tool
  transcript  faster-whisper (CPU, int8) → transcript.txt with [m:ss] stamps: what the cook says

Writes into DIR (default: a temp folder, printed): meta.json, caption.txt, cover.jpg, video.mp4,
transcript.txt, sheets/. Prints a compact report. Exit 0 = got something; 2 = nothing usable
(private, removed, login wall) — the report says what to ask the user for.
"""
import argparse
import html
import json
import os
import re
import sys
import tempfile
import urllib.request

os.environ.setdefault("HF_HUB_DISABLE_SYMLINKS_WARNING", "1")   # Windows: harmless cache warning
from pathlib import Path

UA = "Mozilla/5.0"   # a full browser UA gets the JavaScript app shell; this gets the server-rendered embed
IG = re.compile(r"(?:instagram\.com|instagr\.am)/(?:[\w.]+/)?(?:reels?|p|tv)/([\w-]+)", re.I)
LINK = re.compile(r"https?://[^\s)>\]]+", re.I)
TEASE = re.compile(r"link in (?:my )?bio|recipe (?:is )?in (?:my )?bio|comment\s+[\"“']?\w+|dm (?:me|for)|on my (?:blog|website|site)|full recipe (?:at|on)", re.I)


def get(url, timeout=30):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Language": "en-US,en;q=0.9"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def instagram(code):
    """Public embed page → dict(caption, author, video_url, cover_url, duration, taken_at, items)."""
    page = get(f"https://www.instagram.com/p/{code}/embed/captioned/").decode("utf-8", "replace")
    out = {"source": "instagram embed", "shortcode": code, "caption": "", "author": None,
           "video_url": None, "cover_url": None, "duration": None, "taken_at": None, "items": []}
    m = re.search(r'"contextJSON":("(?:[^"\\]|\\.)*")', page)
    media = None
    if m:
        try:
            media = (json.loads(json.loads(m.group(1))).get("gql_data") or {}).get("shortcode_media")
        except ValueError:
            media = None
    if media:
        edges = (media.get("edge_media_to_caption") or {}).get("edges") or []
        out["caption"] = edges[0]["node"].get("text", "") if edges else ""
        out["author"] = (media.get("owner") or {}).get("username")
        out["video_url"] = media.get("video_url")
        out["cover_url"] = media.get("display_url")
        out["duration"] = media.get("video_duration")
        out["taken_at"] = media.get("taken_at_timestamp")
        for e in (media.get("edge_sidecar_to_children") or {}).get("edges") or []:   # carousel posts
            n = e.get("node") or {}
            out["items"].append({"video_url": n.get("video_url"), "image_url": n.get("display_url")})
    if not out["caption"]:   # older/lighter embed markup: caption only as HTML
        c = re.search(r'class="Caption"[^>]*>(.*?)</div>', page, re.S)
        if c:
            t = html.unescape(re.sub(r"<[^>]+>", "", re.sub(r"<br\s*/?>", "\n", c.group(1)))).strip()
            out["caption"] = re.sub(r"^\S+\s*\n+", "", t, count=1) if t else ""   # drop the leading username line
        a = re.search(r'class="CaptionUsername"[^>]*>([^<]+)<', page)
        if a and not out["author"]:
            out["author"] = a.group(1).strip()
    if not out["cover_url"]:
        img = re.search(r'class="EmbeddedMediaImage"[^>]*src="([^"]+)"', page)
        if img:
            out["cover_url"] = html.unescape(img.group(1))
    return out


def ytdlp(url, out_dir, want_video):
    """Fallback for TikTok / YouTube / blocked Instagram: yt-dlp metadata (+ a single-file mp4)."""
    try:
        import yt_dlp  # noqa: F401
    except ImportError:
        return None, "yt-dlp not installed (pip install yt-dlp)"
    import yt_dlp
    opts = {"quiet": True, "no_warnings": True, "noprogress": True, "noplaylist": True, "outtmpl": str(out_dir / "video.%(ext)s"),
            "format": "b[ext=mp4]/b" if want_video else "b", "skip_download": not want_video}
    try:
        with yt_dlp.YoutubeDL(opts) as y:
            info = y.extract_info(url, download=want_video)
    except Exception as e:  # login wall, removed, geo-blocked…
        msg = re.sub(r"\x1b\[[0-9;]*m", "", str(e)).splitlines()[0]   # drop terminal colors
        return None, f"yt-dlp: {msg[:200]}"
    files = sorted(out_dir.glob("video.*"))
    return {"source": f"yt-dlp ({info.get('extractor_key')})", "caption": info.get("description") or "",
            "title": info.get("title"), "author": info.get("uploader") or info.get("channel"),
            "duration": info.get("duration"), "cover_url": info.get("thumbnail"), "video_file": str(files[0]) if files else None,
            "subtitles": sorted((info.get("subtitles") or {}).keys())}, None


def stamp(sec):
    sec = int(sec or 0)
    return f"{sec // 60}:{sec % 60:02d}"


def frame_sheets(video, out_dir, sheets):
    """Evenly spaced frames → contact sheets (3×2 tiles, 480px wide each, time-stamped)."""
    try:
        import av
        from PIL import Image, ImageDraw
    except ImportError:
        return [], "frames skipped: pip install av pillow"
    try:
        with av.open(str(video)) as c:
            st = c.streams.video[0]
            dur = float(st.duration * st.time_base) if st.duration else (c.duration or 0) / 1e6
            n = max(6, min(6 * sheets, int(dur // 1.5) or 6))   # ~one frame per 1.5 s, capped
            want = [dur * (i + 0.5) / n for i in range(n)]
            frames, k = [], 0
            for f in c.decode(st):
                t = float(f.pts * st.time_base) if f.pts is not None else 0.0
                if k < len(want) and t >= want[k]:
                    im = f.to_image()
                    im.thumbnail((480, 480 * 2))
                    frames.append((t, im))
                    k += 1
                    while k < len(want) and t >= want[k]:
                        k += 1
                if k >= len(want):
                    break
    except Exception as e:
        return [], f"frames failed: {e}"
    sd = out_dir / "sheets"
    sd.mkdir(exist_ok=True)
    paths = []
    for s in range(0, len(frames), 6):
        group = frames[s:s + 6]
        w = max(im.width for _, im in group)
        h = max(im.height for _, im in group)
        sheet = Image.new("RGB", (w * 3, h * 2), "white")
        d = ImageDraw.Draw(sheet)
        for j, (t, im) in enumerate(group):
            x, y = (j % 3) * w, (j // 3) * h
            sheet.paste(im, (x, y))
            d.rectangle([x, y, x + 64, y + 26], fill="black")
            d.text((x + 6, y + 6), stamp(t), fill="yellow")
        p = sd / f"sheet-{s // 6 + 1:02d}.jpg"
        sheet.save(p, quality=80)
        paths.append(str(p))
    return paths, None


def transcribe(video, out_dir, model_name):
    try:
        from faster_whisper import WhisperModel
    except ImportError:
        return None, "transcript skipped: pip install faster-whisper"
    try:
        model = WhisperModel(model_name, device="cpu", compute_type="int8")
        segs, info = model.transcribe(str(video), vad_filter=True, beam_size=5)
        lines = [f"[{stamp(s.start)}] {s.text.strip()}" for s in segs]   # generator: runs here
    except Exception as e:
        return None, f"transcript failed: {e}"
    text = "\n".join(lines)
    (out_dir / "transcript.txt").write_text(text, encoding="utf-8")
    return {"language": info.language, "probability": round(info.language_probability, 2), "text": text}, None


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("url")
    ap.add_argument("--out", help="output folder (default: a new temp folder)")
    ap.add_argument("--sheets", type=int, default=4, help="max frame sheets, 6 frames each (default 4)")
    ap.add_argument("--model", default="small", help="faster-whisper model: tiny|base|small|medium (default small)")
    ap.add_argument("--no-video", action="store_true", help="caption/metadata only")
    ap.add_argument("--no-transcript", action="store_true")
    a = ap.parse_args()
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    out = Path(a.out or tempfile.mkdtemp(prefix="reel-"))
    out.mkdir(parents=True, exist_ok=True)
    notes, meta, video = [], None, None

    m = IG.search(a.url)
    if m:
        try:
            meta = instagram(m.group(1))
            if not (meta["caption"] or meta["video_url"] or meta["cover_url"]):
                notes.append("instagram embed: empty (private, removed, or embedding disabled)")
                meta = None
        except Exception as e:
            notes.append(f"instagram embed: {e}")
    if meta and meta.get("video_url") and not a.no_video:
        try:
            (out / "video.mp4").write_bytes(get(meta["video_url"], timeout=120))
            video = out / "video.mp4"
        except Exception as e:
            notes.append(f"video download: {e}")
    # No embed data, or a caption but no video (the embed sometimes omits video_url): ask yt-dlp.
    if meta is None or (not video and not a.no_video):
        alt, err = ytdlp(a.url, out, not a.no_video)
        if alt:
            if meta is not None:   # keep the embed's caption/author; take yt-dlp's video
                alt = {**alt, **{k: v for k, v in meta.items() if v}, "source": f"{meta['source']} + {alt['source']}"}
            meta = alt
            video = Path(alt["video_file"]) if alt.get("video_file") else video
        elif err:
            notes.append(err)
    if meta is None:
        print(json.dumps({"ok": False, "url": a.url, "notes": notes,
                          "ask_user": "Couldn't open this video. Ask for the caption pasted into the item, or screenshots."}, ensure_ascii=False, indent=2))
        sys.exit(2)

    if meta.get("cover_url"):
        try:
            (out / "cover.jpg").write_bytes(get(meta["cover_url"]))
        except Exception as e:
            notes.append(f"cover: {e}")
    cap = meta.get("caption") or ""
    (out / "caption.txt").write_text(cap, encoding="utf-8")

    sheets, tr = [], None
    if video and video.exists():
        sheets, err = frame_sheets(video, out, a.sheets)
        if err:
            notes.append(err)
        if not a.no_transcript:
            tr, err = transcribe(video, out, a.model)
            if err:
                notes.append(err)

    report = {
        "ok": True, "url": a.url, "out": str(out), "via": meta.get("source"),
        "author": meta.get("author"), "title": meta.get("title"), "duration_s": meta.get("duration"),
        "caption_links": LINK.findall(cap),
        "caption_teases_recipe_elsewhere": bool(TEASE.search(cap)),
        "caption": cap,
        "transcript": tr,
        "frame_sheets": sheets,
        "cover": str(out / "cover.jpg") if (out / "cover.jpg").exists() else None,
        "video": str(video) if video else None,
        "carousel_items": len(meta.get("items") or []),
        "notes": notes,
    }
    (out / "meta.json").write_text(json.dumps({k: v for k, v in report.items() if k != "transcript"}, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
