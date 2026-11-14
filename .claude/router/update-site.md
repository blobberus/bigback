# Router: "update the site"

Triggers: "update the site", "build recipes", "process notes/feedback", "sync", `/update-site`.
Follow these steps in order. Don't explore the repo — `pending.py` tells you what to open.

## 0. Sync
```bash
git status --short          # must be clean; if not, commit coherent work or ask the user
git pull --rebase           # the phone commits straight to main
python scripts/pending.py   # the whole worklist, compact (--json for machine output)
```
`Nothing to do` → run `python scripts/validate.py`, push any unpushed commits, tell the
user "Nothing to do — the site is up to date", stop.

## 1. Build inbox items (section INBOX)
Each item → one `recipes/<slug>.json` via skill `.claude/skills/recipe-ingest/SKILL.md`.
- **1–2 items:** do them yourself, one at a time: build → finalize → commit.
- **>2 items:** spawn one subagent per item **in a single message** (parallel). Paste the
  brief below with that item's `pending.py` block. Subagents only write the recipe (or set
  `blocked`); **you** run `finalize_inbox.py` and commit, sequentially, afterwards —
  parallel `git mv` / library writes would race on `.git/index.lock` and `library.json`.
  If two subagents report the same slug, rename the second recipe file and its `slug`
  field to `<slug>-2` before finalizing.

Subagent brief (fill the `<…>`):
> Build inbox item `<id>` of the Bigback recipe vault into a recipe. Read
> `.claude/skills/recipe-ingest/SKILL.md` and follow it exactly (it points to
> `docs/SCHEMA.md`). Item summary: `<paste its pending.py block>`. Read
> `inbox/<id>/item.json` and its files only — don't open other recipes. Pick a slug from
> the title; if `recipes/<slug>.json` exists, append `-2`, `-3`… Write
> `recipes/<slug>.json` (status "built") and nothing else. If the source doesn't contain
> enough for a faithful recipe, don't invent one: set `"blocked": "<what's needed>"` in
> item.json instead. Don't run git, finalize_inbox.py or build_index.py. Reply with one
> line: `built <slug> "<title>"` or `blocked <id>: <reason>`.

Per built item (sequential):
```bash
python scripts/finalize_inbox.py <id> <slug>   # git mv originals → sources/<slug>/, library entry, index
python scripts/validate.py                     # 0 errors before committing
git add -A recipes/<slug>.json recipes/index.json sources/<slug> inbox/<id> data/library.json
git commit -m "Build recipe: <Title>"
```
Blocked item: `git add inbox/<id>/item.json && git commit -m "Block inbox item: <id>"`.

Section BLOCKED: retry only if the item now contains what the reason asked for (e.g. it
asked for the caption and `text` is now filled) — then set `blocked` to null and build
normally. Otherwise leave it and list it in the report.

## 2. Enrich custom recipes (section CUSTOM)
User-typed recipes (`status: "custom"`) → recipe-ingest skill, section "Custom-recipe
enrichment". Keep the user's wording; set `status: "built"`. Then:
```bash
python scripts/build_index.py && python scripts/validate.py
git add recipes/<slug>.json recipes/index.json && git commit -m "Enrich recipe: <Title>"
```

## 3. Apply open notes (section NOTES)
Per recipe, follow `.claude/skills/recipe-refinement/SKILL.md`: open `recipes/<slug>.json`
and `journal/<slug>.json` only; classify every open note; edit the recipe; close each note:
```bash
python scripts/resolve_note.py <slug> <note-id>[,<id>…] applied|kept "<one line: what changed>"
python scripts/validate.py
git add recipes/<slug>.json journal/<slug>.json recipes/index.json
git commit -m "Refine <Title> from <N> notes"   # all kept → "Log <N> notes on <Title>"
```
More than 3 recipes with substantial notes: you may run one subagent per recipe (brief:
follow the refinement skill for `<slug>`, edit `recipes/<slug>.json`, run resolve_note.py,
no git, reply with one line per note). Then `python scripts/build_index.py` and commit per
recipe yourself.

## 4. Verify and push
```bash
python scripts/build_index.py && python scripts/validate.py   # must end "0 errors"
git push
```
Push rejected (the phone committed meanwhile) → `git pull --rebase`; on conflicts:
- `recipes/index.json` → never hand-merge: `python scripts/build_index.py`, `git add` it.
- `journal/<slug>.json` → take the remote copy (during a rebase that's
  `git checkout --ours <file>`), re-run your `resolve_note.py` calls (new phone notes
  stay open), `git add` it.
- `data/library.json` → take the remote copy the same way, re-run
  `finalize_inbox.py <id> <slug>` for each new recipe (only re-adds missing blank
  entries), `git add` it.
- `git rebase --continue`, validate, push again.

## 5. Report to the user (short)
```
Built: <Title> (<source type>), …
Enriched: <Title>, …
Refined: <Title> — <what changed, ≤1 line>; kept <N> personal notes
Blocked: <title or url> — <what's needed>
```
Omit empty lines. The details live in each note's resolution and the recipe changelog.

## Hard rules
- Never change user-owned data in `data/library.json` (tags, rating, proficiency, cooked,
  lastCooked, playlists). The only write allowed is `finalize_inbox.py` adding a blank
  entry for a new recipe.
- Journal: never delete entries or edit `text`/`photo`/`stepText`/`createdAt`; change only
  `status`, `resolution`, `resolvedAt`, and only through `resolve_note.py`.
- Ingredient/step ids are permanent: keep them; new ones = next unused number; never reuse.
- `recipes/index.json` is generated — never hand-edit it.
- Token efficiency: open only the files `pending.py` lists; don't read other recipes,
  `sources/`, `js/` or `css/`. Re-run `pending.py` to check progress instead of re-reading.
- One commit per recipe, imperative subjects as above; push at the end of the run.
