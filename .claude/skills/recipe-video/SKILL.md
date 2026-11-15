---
name: recipe-video
description: Read a recipe video from nothing but its link (Instagram reel/post, TikTok, YouTube Short or video, Facebook) by pulling the caption, a time-stamped speech transcript and frame sheets of the on-screen text, so it can be built with recipe-ingest. Use whenever an inbox item or the user gives a video link, and before ever blocking a video upload as too thin.
---

# Recipe video → readable text and frames

Claude can't watch video, so `reel.py` turns the link into three things it can read:

| Output | From | What it gives you |
|---|---|---|
| `caption` | Instagram's public embed page (no login) or yt-dlp | Often the whole recipe; links to a written version |
| `transcript` | faster-whisper on the video's audio (CPU) | What the cook says, `[m:ss]` stamped |
| `frame_sheets` | PyAV, evenly spaced frames, 6 per sheet, each stamped m:ss | On-screen text (amounts, temps), pan sizes, doneness cues |

## 1. Run it
```bash
python .claude/skills/recipe-video/reel.py "<url>" --out "<scratchpad>/video-<inbox-id>"
```
- About 1–2 minutes for a 1-minute reel. The first run downloads the speech model (~480 MB) once.
- Long videos (>10 min, e.g. YouTube): add `--model base` (faster). For YouTube, try the
  recipe-ingest YouTube row first (description + subtitles); transcribing is the fallback.
- `--no-video` = caption and metadata only (seconds; no packages needed).
- Exit 2 / `"ok": false` → nothing reachable (private account, removed, login wall, rate limit).
  Block the item with the `ask_user` line, adjusted to the reason in `notes`.

Setup, once per machine (already done on the owner's PC):
`python -m pip install --user -r .claude/skills/recipe-video/requirements.txt`.
Without the packages the Instagram caption still works; the report's `notes` say what was skipped.

## 2. Read the report, in this order
1. **`caption_links`**: a written recipe on the creator's site beats the video. Fetch it with
   `python .claude/skills/recipe-ingest/extract.py jsonld <url>` and build from that, using the
   video only to settle doubts.
2. **`caption`**: if it lists ingredients with amounts, it is the recipe.
3. **`frame_sheets`**: Read every sheet (Read tool, one image each). Note on-screen amounts and
   temperatures with their time stamps, and what the cook actually does (heat, pan, texture).
4. **`transcript`**: the method, times, temperatures, and the cook's tips. Speech-to-text slips
   are common with numbers and brand names; trust the on-screen text or caption over it.

Priority when sources disagree: linked written recipe > caption > on-screen text > narration >
what's visible. Amounts you can only see (a pour, a handful) are fine to estimate: mark the
ingredient note "≈, eyeballed in video". Never invent an ingredient nobody shows or names.

## 3. Teasers and dead ends
- `caption_teases_recipe_elsewhere: true` (“comment CARBONARA for the recipe”, “link in bio”):
  the DM or bio isn't reachable. If the transcript plus frames give the ingredients and rough
  amounts, build it (log "amounts from the video; the written recipe is DM-only"). If not, block:
  "The recipe is sent by DM. Paste it into the item or add screenshots".
- A carousel post (`carousel_items` > 0) with only photos: the caption is the recipe.

## 4. Building
Then follow `.claude/skills/recipe-ingest/SKILL.md` as usual, with:
- `source`: `type` instagram | tiktok | youtube | web, `url` = the link, `author` = `@handle`
  (or channel), `files` = [] (nothing is archived: the video, frames and transcript stay in the
  scratchpad and are never committed).
- `image`: null. The cover is the creator's photo; the repo and site are public.
- changelog: say what it was built from ("Built from the reel's caption, narration and on-screen
  text; amounts for X and Y eyeballed").

## Limits
- Public posts only. Never ask for or use the owner's Instagram login or cookies: it isn't
  needed, and Instagram restricts accounts it sees used by tools.
- Many links in a row can hit Instagram's anonymous rate limit (empty embed); wait a few
  minutes before retrying, or ask for the caption.
- This reads one public post the owner chose, for their own recipe vault, and keeps only the
  recipe. Don't bulk-download, and don't commit downloaded media.
- How it works: the embed page `instagram.com/p/<code>/embed/captioned/` is server-rendered for
  a plain `Mozilla/5.0` user agent (a full browser UA gets an empty app shell); its
  `contextJSON` carries the caption, author and usually `video_url`. When `video_url` is
  missing, yt-dlp fetches the video anonymously. If Instagram changes the page, fix `instagram()`
  in `reel.py`, and use yt-dlp alone until then.
