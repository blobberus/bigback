# Architecture

Static SPA (no build step) served by GitHub Pages; the git repo is the database.

```
Phone browser ──reads──▶ Pages (relative paths)        ← no token: read-only
              ──reads──▶ GitHub API contents (fresh)   ← token set
              ──writes─▶ GitHub Git Data API: blobs → tree → commit → ref (atomic)
Claude Code  ──"update the site"──▶ .claude/router/update-site.md
                                     ├─ inbox/*  → recipes/<slug>.json (+ sources/, media/)
                                     └─ journal open notes → recipe edits (+ status update)
Push to main ──▶ .github/workflows/pages.yml (validate, rebuild index, deploy)
```

## Front-end modules (`js/`)
| File | Role | Owner |
|---|---|---|
| `app.js` | boot, hash router, global listeners, mounts tools | core |
| `lock.js` | site password: `unlockGate()` before first render, lock screen, PBKDF2 config (data/lock.json), optional token vault | core |
| `config.js`, `prefs.js` | repo defaults; device-local prefs (token, wakeLock, theme) | core |
| `util.js` | `html` template (auto-escape), durations, fractions, image compression | core |
| `ui.js` | `toast`, `sheet`, `confirmSheet`, `promptSheet`, `setTopbar`, `on` (delegation) | core |
| `github.js` | REST client; `commit(message, builder)` atomic + conflict-retry | core |
| `store.js` | **only** data API views may use (see header for full contract) | core |
| `timers.js` | countdown timers: `startTimer({label, seconds, slug, stepId})` | WS4 |
| `stopwatch.js` | global stopwatch button/panel | WS4 |
| `wakelock.js` | Screen Wake Lock manager | WS4 |
| `units.js` | US ⇄ metric breakdown for an ingredient amount (`breakdown(ing, factor)`); temperatures in text (`findTemps`, `tempDetails`: °C/°F, oven dial, fan, convection); the converter page's tables and math (`CONVERTERS`, `convertUnit`, `parseAmount`, `fmtAmount`, `kitchenHint`) | core |
| `components/recipe-mentions.js` | ingredient names in steps → tap shows the amount (`mentionMatcher`, `bindMentions`) | WS2 |
| `components/back-nav.js` | in-app ← = history.back() to the page you came from (list → recipe → cook keep search, filters, scroll) | WS2 |
| `views/library.js` | list, search, filters, sort, playlist view | WS1 |
| `views/playlists.js` | playlist management | WS1 |
| `views/recipe.js` | recipe page, notes, photo journal, rating/tags | WS2 |
| `views/cook.js` | step-by-step cook mode | WS2 |
| `views/add.js` | chooser, custom form, upload form, edit | WS3 |
| `views/pending.js` | inbox item detail / delete | WS3 |
| `views/settings.js` | token, repo, wake lock, theme, site password | WS4 |
| `views/convert.js` | weight / volume / temperature converter (bottom-nav "Convert") | WS8 |

View contract: `export async function render(root, params) → cleanup?`. Use
`setTopbar()`, render with `root.innerHTML = html\`…\``, bind with `on(root, …)`.
Subscribe to `store.onChange` for re-render and return the unsubscribe as cleanup.
A view that awaits a read before painting checks `location.hash` is unchanged first: if you
left meanwhile, `root` already holds the next page (and the router never runs that cleanup).

## CSS
`css/base.css` holds tokens + shared components (`.btn`, `.chip`, `.input`, `.field`,
`.seg`, `.switch`, `.card`, `.panel`, `.sheet`, `.empty`, `.section-title`). Feature
files (`library.css`, `recipe.css`, `editor.css`, `tools.css`) use tokens only — never
hard-coded colors. Mobile-first; tap targets ≥ 44px; inputs 16px (no iOS zoom).

## Images
`<img src="${mediaUrl(p)}" data-fallback="${rawUrl(p)}">` — the global handler in
`app.js` swaps to raw.githubusercontent when Pages hasn't redeployed a fresh upload.

## Loading and caching
- **Data** (`store.js`): snapshot-first. A file read before on this device paints at once from
  its localStorage copy while the live file is fetched behind it; a changed live copy fires
  `onChange({ type: 'refresh' })` and the open view repaints. One network read per file per
  page load; coming back to the app after a minute re-checks what's in memory.
- **Gate** (`lock.js`): a remembered device opens on its last copy of `data/lock.json`; the
  live file is checked right after and locks the app if the password changed.

## Why these choices
- **Repo as DB**: free, versioned, and agents edit plain JSON with full history.
- **One file per recipe / journal**: small diffs, model edits don't clobber user data.
- **library.json separate**: user-owned fields (tags, rating, proficiency, playlists)
  are never touched by recipe rewrites.
- **Atomic multi-file commits**: an upload (image + item + index) lands all-or-nothing.
