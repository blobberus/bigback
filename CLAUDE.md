# CLAUDE.md — Bigback Recipe Vault

## Goal
A phone-first personal recipe vault for a home chef (intermediate→advanced skill,
homestyle kitchen, basic pantry). Static site on GitHub Pages; the repo **is** the
database. The browser writes to the repo through the GitHub API (user's PAT stored
in localStorage). Agents turn raw uploads + user feedback into polished recipes.

## Routing — read only what the task needs
| User says / task | Go to |
|---|---|
| "update the site", "build recipes", "process notes/feedback", "sync" | `.claude/router/update-site.md` (follow it exactly) |
| Changing a recipe because of feedback | skill `.claude/skills/recipe-refinement/SKILL.md` |
| Formatting a raw upload into a recipe | skill `.claude/skills/recipe-ingest/SKILL.md` |
| Data shapes (recipe, library, journal, inbox) | `docs/SCHEMA.md` |
| Front-end code map / module contracts | `docs/ARCHITECTURE.md` |
| Continuing unfinished build work | `autopilot/TASKS.md` (ledger) — then `autopilot/PROMPT.md` rules |

## Token-efficiency rules
- Don't read `recipes/*.json` wholesale. Run `python scripts/pending.py` to see what
  needs work (inbox items + open notes), then open only those files.
- `recipes/index.json` is generated — never hand-edit; run `python scripts/build_index.py`.
- Front-end: each view is one file in `js/views/`; shared contracts live in
  `js/store.js` (data) and `js/github.js` (writes). Read the contract header comments
  before reading implementations.
- Check `git log --oneline -15` + `autopilot/TASKS.md` to resume instead of re-exploring.

## Repo map (data)
- `recipes/<slug>.json` — built recipes (model-owned content)
- `recipes/index.json` — generated list manifest (+ pending inbox summary)
- `inbox/<id>/item.json` (+ files) — **non-built** uploads waiting for "update the site"
- `sources/<slug>/` — archived originals after a build
- `media/<slug>/` — recipe images; `media/<slug>/journal/` — user photos
- `journal/<slug>.json` — user notes (step/general) + photo notes; `status: open|applied|kept`
- `data/library.json` — user-owned: tags, rating /10, proficiency /5, playlists

Ownership rule: the model edits recipe content; it never changes the user's tags,
rating, proficiency or playlists (exception: adding blank entries for new recipes).

## Conventions
- No build step, no npm. Vanilla ES modules, hash router, mobile-first CSS.
- Python 3 stdlib only for scripts (`python scripts/…`). Node is not installed.
- Step and ingredient `id`s are stable forever — notes reference them.
- Small, focused commits with imperative messages; push to `main` after each batch.
- Local preview: `python -m http.server 8080` from repo root → http://localhost:8080
- Verify before committing: `python scripts/validate.py` (data + sw.js precache list) and
  `python scripts/smoke.py [routes…]` (headless Edge; routes without "#/", e.g. `r/<slug>`;
  `tests/*.html` pages also work). New JS/CSS files must be added to `SHELL` in `sw.js`.

## Session continuity
Status of the build lives in `autopilot/TASKS.md`. An hourly Windows scheduled task
(`autopilot/run.ps1`, task name `BigbackAutopilot`) re-prompts a headless Claude to
continue unchecked tasks. Create `autopilot/STOP` to halt it.
