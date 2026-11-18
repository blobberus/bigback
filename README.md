# Bigback — Recipe Vault

A phone-first personal recipe vault. Live at **https://blobberus.github.io/bigback/**.

- **Add recipes two ways:** type one yourself (ingredients, steps, photo), or upload a
  PDF / photo / YouTube · Instagram · TikTok · web link / pasted text to the inbox.
- **"Update the site":** tell Claude Code that in this repo and it builds every inbox
  upload into a formatted recipe, enriches the ones you typed, and folds your notes and
  feedback into the recipes (`.claude/router/update-site.md`).
- **In the kitchen:** tap-to-start step timers, a global stopwatch on every screen,
  keep-screen-awake, ingredient checkboxes, a serving scaler and a step-by-step cook mode.
- **Your library:** tags, rating /10, proficiency /5, playlists and filters, including
  Unrated, Not set and Untagged as their own categories.
- **Journal:** notes on a single step or the whole recipe, plus photos with notes. All of
  it is saved to the repo, and Claude reads it the next time you update.

## Phone setup (once per device)
1. **Create a token.** Go to github.com → Settings → Developer settings → Fine-grained tokens →
   [Generate new token](https://github.com/settings/personal-access-tokens/new).
   - Repository access: **Only select repositories → bigback**
   - Repository permissions: **Contents → Read and write**
2. Open the site → **Settings → GitHub sync**, paste the token, then **Save & test**.
   The token is stored only on that device (localStorage).
3. **Add it to your Home Screen.** On iOS: Share → Add to Home Screen. On Android: ⋮ → Install app.
4. Settings → **Keep screen awake** if you want the screen on while cooking.
5. Optional: Settings → **Password → Set password**. Every device then shows a lock screen once
   and remembers itself after the right password. Forgot it? Delete `data/lock.json` in the repo.
6. With a password set, the token is kept with it automatically (Settings → Password → **Keep my
   GitHub token with the password**, on by default). Phones can wipe site storage (iPhone keeps a
   Home Screen app's storage separate from Safari, and private tabs forget everything); entering
   the password brings the token back. The encrypted copy is public, so use a long password.

New versions install themselves: the app checks when it opens or comes back to the foreground and
reloads once onto the new code.

Without a token the site is read-only.

**Sharing one recipe:** on a recipe, tap **Share** (top right) → **Create share link**, then send
it. The link (`share.html?r=<recipe>`) opens just that recipe, read-only, with no password: no
notes, photos, ratings, other recipes or editing. **Stop sharing** in the same sheet turns it off.

> The repo is **public**, so recipes, notes and photos are visible to anyone with the link.
> The site password only locks the app; the files stay readable on GitHub.
> If you want them private, make the repo private. GitHub Pages on private repos needs a
> paid plan; the alternative is to run it locally.

## How data flows
```
phone ── commit via GitHub API ──▶ inbox/  journal/  data/library.json  recipes/ (custom)
Claude "update the site" ──▶ recipes/<slug>.json  sources/  (notes marked applied/kept)
push to main ──▶ GitHub Actions validates, rebuilds index, deploys Pages
```
See `docs/SCHEMA.md` for every file shape and `docs/ARCHITECTURE.md` for the code map.

## Local development
```
python -m http.server 8080          # http://localhost:8080
python scripts/validate.py          # data checks
python scripts/smoke.py             # headless-browser check of every route
python scripts/pending.py           # what "update the site" would work on
```
No build step and no npm. Plain HTML, CSS and ES modules.

## Autopilot (build continuation)
`autopilot/run.ps1` runs hourly through the Windows scheduled task **BigbackAutopilot**.
It starts a headless Claude Code session that continues the unchecked items in
`autopilot/TASKS.md`. Pause it with `New-Item autopilot/STOP`; remove it with
`powershell -File autopilot/uninstall.ps1`. Logs are written to `autopilot/logs/`.
