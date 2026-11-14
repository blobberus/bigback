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
- [ ] Recipe cards grid (image, title, time, rating, proficiency, tags) + pending inbox cards
- [ ] Search box (title/summary/tags)
- [ ] Filter sheet: tags, rating (incl. Unrated), proficiency (incl. Not set), untagged, playlist, source type
- [ ] Sort: recent, title, rating, proficiency, time
- [ ] Playlists: create/rename/delete, add/remove recipes, playlist view (`#/playlist/<id>`)
- [ ] Inline edit on card long-press or recipe page: tags, rating /10, proficiency /5

## WS2 — Recipe view (`js/views/recipe.js`, `css/recipe.css`)
- [ ] Header: hero image, title, summary, times, servings, source link
- [ ] Collapsible "Flavor profile & deliverables" (profile paragraph)
- [ ] Ingredients with checkboxes + serving scaler (qty/qtyMax, fraction display)
- [ ] Steps with tap-to-complete, step timers as buttons (timers[] + auto-detected durations)
- [ ] Per-step note composer + general recipe notes; submit → journal commit; show history with status
- [ ] Photo journal: upload photo + note, gallery grid, lightbox showing note
- [ ] Tags / rating / proficiency editor on the recipe page; "Cooked it" counter
- [ ] Cook mode: large text, one step at a time, swipe/next/prev

## WS3 — Add & edit (`js/views/add.js`, `css/editor.css`)
- [ ] Choice screen: Custom recipe vs Upload file/link
- [ ] Custom form: title, summary, servings, times, ingredients (smart line parse), steps, hero photo
- [ ] Image compression (canvas → JPEG ≤1600px) before upload
- [ ] Upload: file (PDF/image/any), link (YouTube/Instagram/web), pasted text, hint → inbox commit
- [ ] Edit existing recipe (reuses custom form; preserves ids)
- [ ] Delete recipe / delete pending item (with confirm sheet, not window.confirm)

## WS4 — Kitchen tools & PWA (`js/timers.js`, `js/stopwatch.js`, `js/wakelock.js`, `js/views/settings.js`, `css/tools.css`, `sw.js`)
- [x] Countdown timer manager: multiple timers, persist across reload (endAt), tray UI
- [x] Alarm: WebAudio beeps + vibrate + Notification; dismiss/snooze +1 min
- [x] Global collapsible stopwatch (button reachable from every screen): start/pause/lap/reset, persists
- [x] Wake lock setting (Screen Wake Lock API, re-acquire on visibilitychange, status indicator)
- [x] Settings view: GitHub token + repo, wake lock, theme, units pref, test connection
- [x] PWA: manifest, icons, service worker (app-shell cache, network-first data)

## WS5 — Agent brain (`.claude/`, `scripts/`)
- [ ] Research-backed skill `.claude/skills/recipe-refinement/` (feedback → precise recipe edits)
- [ ] Skill `.claude/skills/recipe-ingest/` (raw PDF/video/link/text → schema recipe + profile)
- [ ] Router `.claude/router/update-site.md` + slash command `.claude/commands/update-site.md`
- [ ] `scripts/pending.py` compact worklist output; `scripts/finalize_inbox.py` helper (git mv + library entry)

## WS6 — Integration & polish (after WS1–5 merge)
- [ ] Merge branches, resolve conflicts, smoke-test with `python -m http.server`
- [ ] README with phone setup (PAT creation, Pages enable, add-to-home-screen)
- [ ] Accessibility pass (labels, focus, contrast, reduced motion)
- [ ] Empty states + offline banner + error toasts for failed commits
- [ ] Dark mode check, safe-area insets, 360px width check

## Polish backlog (only if all above done and commit target not met)
- Shopping list from selected recipes; unit toggle (US/metric); print view;
  "recently cooked" shelf; export/import library JSON; keyboard shortcuts on desktop.
