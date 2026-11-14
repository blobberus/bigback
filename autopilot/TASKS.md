# Build ledger

Goal: ship the full recipe vault (see `CLAUDE.md`). Commit target for 2026-11-14: **50**.
Mark items `[x]` in the same commit that completes them. `[~]` = in progress on a branch
(note the branch). Workstreams are independent — run them as parallel agents.

## WS0 — Foundation (main session)
- [x] CLAUDE.md, docs/SCHEMA.md, ledger, autopilot runner
- [x] App shell: index.html, css/base.css, js/app.js (hash router), js/config.js
- [x] js/util.js, js/ui.js helpers
- [x] js/github.js — read + atomic multi-file commit via Git Data API
- [x] js/store.js — data layer contract (index, recipe, library, journal, inbox writes)
- [x] scripts/build_index.py + scripts/validate.py + scripts/smoke.py (headless Edge)
- [x] Sample recipe + data/library.json seed
- [x] GitHub Pages deploy workflow (.github/workflows/pages.yml)
- [x] docs/ARCHITECTURE.md

## WS1 — Library view (`js/views/library.js`, `css/library.css`)
- [x] Recipe cards grid (image, title, time, rating, proficiency, tags) + pending inbox cards
- [x] Search box (title/summary/tags)
- [x] Filter sheet: tags, rating (incl. Unrated), proficiency (incl. Not set), untagged, playlist, source type
- [x] Sort: recent, title, rating, proficiency, time
- [x] Playlists: create/rename/delete, add/remove recipes, playlist view (`#/playlist/<id>`)
- [x] Inline edit on card long-press or recipe page: tags, rating /10, proficiency /5

## WS2 — Recipe view (`js/views/recipe.js`, `css/recipe.css`)
- [x] Header: hero image, title, summary, times, servings, source link
- [x] Collapsible "Flavor profile & deliverables" (profile paragraph)
- [x] Ingredients with checkboxes + serving scaler (qty/qtyMax, fraction display)
- [x] Steps with tap-to-complete, step timers as buttons (timers[] + auto-detected durations)
- [x] Per-step note composer + general recipe notes; submit → journal commit; show history with status
- [x] Photo journal: upload photo + note, gallery grid, lightbox showing note
- [x] Tags / rating / proficiency editor on the recipe page; "Cooked it" counter
- [x] Cook mode: large text, one step at a time, swipe/next/prev

## WS3 — Add & edit (`js/views/add.js`, `css/editor.css`)
- [x] Choice screen: Custom recipe vs Upload file/link
- [x] Custom form: title, summary, servings, times, ingredients (smart line parse), steps, hero photo
- [x] Image compression (canvas → JPEG ≤1600px) before upload
- [x] Upload: file (PDF/image/any), link (YouTube/Instagram/web), pasted text, hint → inbox commit
- [x] Edit existing recipe (reuses custom form; preserves ids)
- [x] Delete recipe / delete pending item (with confirm sheet, not window.confirm)

## WS4 — Kitchen tools & PWA (`js/timers.js`, `js/stopwatch.js`, `js/wakelock.js`, `js/views/settings.js`, `css/tools.css`, `sw.js`)
- [x] Countdown timer manager: multiple timers, persist across reload (endAt), tray UI
- [x] Alarm: WebAudio beeps + vibrate + Notification; dismiss/snooze +1 min
- [x] Global collapsible stopwatch (button reachable from every screen): start/pause/lap/reset, persists
- [x] Wake lock setting (Screen Wake Lock API, re-acquire on visibilitychange, status indicator)
- [x] Settings view: GitHub token + repo, wake lock, theme, units pref, test connection
- [x] PWA: manifest, icons, service worker (app-shell cache, network-first data)

## WS5 — Agent brain (`.claude/`, `scripts/`)
- [x] Research-backed skill `.claude/skills/recipe-refinement/` (feedback → precise recipe edits)
- [x] Skill `.claude/skills/recipe-ingest/` (raw PDF/video/link/text → schema recipe + profile)
- [x] Router `.claude/router/update-site.md` + slash command `.claude/commands/update-site.md`
- [x] `scripts/pending.py` compact worklist output; `scripts/finalize_inbox.py` helper (git mv + library entry)

## WS6 — Integration & polish (after WS1–5 merge)
- [x] Merge branches, resolve conflicts, smoke-test (`python scripts/smoke.py`)
- [x] README with phone setup (PAT creation, Pages enable, add-to-home-screen)
- [x] Accessibility pass (labels, focus, contrast, reduced motion)
- [x] Empty states + offline banner + error toasts for failed commits
- [x] Dark mode check, safe-area insets, 360px width check (`tests/layout.html`)

## WS7 — Follow-ups from workstream reports (2026-11-14)
- [x] store: `unmarkCooked(slug)` (decrement, restore previous lastCooked) + "Undo" action in the toast after "I cooked this" (js/store.js, js/views/recipe.js)
- [x] Cook mode: replace promptSheet note composer with a sheet that keeps a draft in sessionStorage if dismissed (js/views/cook.js)
- [x] Recipe page: allow deleting applied/kept notes too (confirmSheet) (js/components/recipe-journal.js)
- [x] Library cards: add `-webkit-touch-callout: none; user-select: none` on long-press targets so iOS link preview doesn't fight the ⋯ editor (css/library.css)
- [x] Editor parser: a short step line ending in ":" should stay a step when it's the only line of its paragraph and followed by a blank line (js/components/editor-parse.js + tests/editor-parse.html)
- [x] Library: "Playlist order" sort when viewing a playlist (js/views/library.js)
- [x] Shared test page `tests/util.html` for util.js parseDurations / fmtQty / scaleQty / slugify (~25 assertions)

## WS8 — User requests
- [x] Site password: lock screen on every device, set/change/remove in Settings, remember this device (js/lock.js, data/lock.json, tests/lock.html)
- [x] Ingredient names in steps link to their amount (bubble above the word); ingredient amounts, including ones in notes, open a US + metric breakdown (js/components/recipe-mentions.js, js/units.js, tests/ingredients.html)
- [x] Token vault (token restored by the site password); Home Screen app auto-updates (sw.js VERSION stamped per code change, reload on controllerchange)
- [x] Sheets: swipe down / tap outside to close, page behind locked (js/ui.js, tests/sheet.html); proficiency labelled on cards + recipe page; shorter bottom menu (50px)
- [x] No "I cooked this" button: the cook log is the days with journal photos; photos carry `cookedOn` (EXIF date or picked) (js/components/recipe-journal.js, js/util.js takenOn)

## Polish backlog (only if all above done and commit target not met)
- Shopping list from selected recipes; unit toggle (US/metric); print view;
  "recently cooked" shelf; export/import library JSON; keyboard shortcuts on desktop.
