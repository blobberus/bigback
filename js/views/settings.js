/**
 * views/settings.js — #/settings (WS4).
 *   Kitchen:    keep-screen-awake switch (live wake-lock status), timer sound, notifications, test alarm
 *   Appearance: theme Auto/Light/Dark (app.js applies prefs.theme), units US/Metric
 *   GitHub:     token (show/hide) + owner/repo/branch, "Save & test" → GitHub.check(), Disconnect,
 *               step-by-step fine-grained token instructions
 *   Password:   set / change / remove the site password (data/lock.json via store.saveLock, built by
 *               lock.js), "Lock this device". Setting it needs GitHub connected.
 *   About:      version, repo link, how updates work, Add to Home Screen, refresh app files
 * Settings is the one view allowed to import github.js (for the connection test).
 */
import { setTopbar, on, toast, confirmSheet, busy, sheet, reportError } from '../ui.js';
import { html } from '../util.js';
import { getPrefs, setPrefs, onPrefs } from '../prefs.js';
import { getLock, saveLock } from '../store.js';
import { makeLock, validLock, remember, forgetDevice, rememberedHere, supported as lockSupported, MIN_LENGTH } from '../lock.js';
import { APP_VERSION } from '../config.js';
import { GitHub } from '../github.js';
import { initWakeLock, wakeLockStatus, onWakeLock } from '../wakelock.js';
import { startTimer } from '../timers.js';

const TOKEN_URL = 'https://github.com/settings/personal-access-tokens/new';
const SHARE = html`<svg class="st-glyph" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12M8 7l4-4 4 4"/><path d="M6 11H5v10h14V11h-1"/></svg>`;
const DOTS = html`<svg class="st-glyph" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="5" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="12" cy="19" r="1.2"/></svg>`;
const NEW_TAB = html`<span class="sr-only"> (opens in a new tab)</span>`;
const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

function seg(name, value, options, labelledby) {
  return html`<div class="seg" role="group" aria-labelledby="${labelledby}">
    ${options.map(([v, label]) => html`<button type="button" data-${name}="${v}" aria-pressed="${String(v === value)}">${label}</button>`)}
  </div>`;
}

function view(p) {
  const unsupported = wakeLockStatus() === 'unsupported';
  return html`<div class="st">
    <section class="st-sec" aria-labelledby="st-h-kitchen">
      <h2 class="section-title" id="st-h-kitchen">Kitchen</h2>
      <div class="panel st-panel st-list">
        <label class="switch st-switch">
          <input type="checkbox" data-pref="wakeLock" aria-describedby="st-wake"${p.wakeLock ? ' checked' : ''}${unsupported ? ' disabled' : ''}>
          <span></span>
          <div class="st-text"><strong>Keep screen awake</strong><small id="st-wake" class="st-wake"></small></div>
        </label>
        <label class="switch st-switch">
          <input type="checkbox" data-pref="sound" aria-describedby="st-sound"${p.sound ? ' checked' : ''}>
          <span></span>
          <div class="st-text"><strong>Timer sound</strong><small id="st-sound">Beeps until you dismiss a finished timer. The alert and vibration happen either way.</small></div>
        </label>
        <div class="st-row">
          <div class="st-text"><strong>Notifications</strong><small id="st-notify"></small></div>
          <button type="button" class="btn btn-sm btn-soft" data-act="notify" aria-label="Allow notifications" hidden>Allow</button>
        </div>
        <div class="st-row">
          <div class="st-text"><strong>Test alarm</strong><small>Starts a 3-second timer so you can hear and feel the alarm.</small></div>
          <button type="button" class="btn btn-sm btn-soft" data-act="test">Test alarm</button>
        </div>
      </div>
    </section>

    <section class="st-sec" aria-labelledby="st-h-look">
      <h2 class="section-title" id="st-h-look">Appearance</h2>
      <div class="panel st-panel st-list">
        <div class="st-row">
          <div class="st-text"><strong id="st-theme-l">Theme</strong><small>Auto follows your phone's light or dark setting.</small></div>
          ${seg('theme', p.theme, [['auto', 'Auto'], ['light', 'Light'], ['dark', 'Dark']], 'st-theme-l')}
        </div>
        <div class="st-row">
          <div class="st-text"><strong id="st-units-l">Measurements</strong><small>Preferred units where a recipe offers both.</small></div>
          ${seg('units', p.units, [['us', 'US'], ['metric', 'Metric']], 'st-units-l')}
        </div>
      </div>
    </section>

    <section class="st-sec" aria-labelledby="st-h-sync">
      <h2 class="section-title" id="st-h-sync">GitHub sync</h2>
      <div class="panel st-panel">
        <p class="st-why">Your recipe vault lives in a GitHub repository. Browsing works without signing in, but
          <strong>saving</strong> — recipes, uploads, notes, photos, ratings and playlists — writes to that repo,
          so this device needs an access token that can write to it.</p>
        <div class="st-conn" data-conn="gh" data-state="off" role="status" aria-live="polite">
          <span class="st-conn-dot" aria-hidden="true"></span>
          <div class="st-text"><strong class="st-conn-title"></strong><small class="st-conn-sub"></small></div>
        </div>
        <form class="st-form" data-form="gh" autocomplete="off" novalidate>
          <div class="field">
            <label for="st-token">Access token</label>
            <div class="st-secret">
              <input id="st-token" class="input" type="password" name="token" value="${p.token}" placeholder="github_pat_…"
                autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" aria-describedby="st-token-hint">
              <button type="button" class="btn btn-ghost st-reveal" data-act="reveal" aria-label="Show token" aria-controls="st-token">Show</button>
            </div>
            <p class="hint" id="st-token-hint">Stored only on this device (localStorage). It's never committed to the repo and only ever sent to GitHub.</p>
          </div>
          <div class="st-grid">
            <div class="field"><label for="st-owner">Owner</label>
              <input id="st-owner" class="input" name="owner" value="${p.owner}" autocapitalize="off" autocorrect="off" spellcheck="false"></div>
            <div class="field"><label for="st-repo">Repository</label>
              <input id="st-repo" class="input" name="repo" value="${p.repo}" autocapitalize="off" autocorrect="off" spellcheck="false"></div>
            <div class="field"><label for="st-branch">Branch</label>
              <input id="st-branch" class="input" name="branch" value="${p.branch}" autocapitalize="off" autocorrect="off" spellcheck="false"></div>
          </div>
          <div class="st-actions">
            <button type="submit" class="btn btn-primary st-save">Save &amp; test</button>
            <button type="button" class="btn st-danger" data-act="disconnect"${p.token ? '' : ' hidden'}>Disconnect</button>
          </div>
        </form>
        <details class="st-howto"${p.token ? '' : ' open'}>
          <summary>How to make a token (about 2 minutes)</summary>
          <ol class="st-steps">
            <li>Open <a href="${TOKEN_URL}" target="_blank" rel="noopener">github.com/settings/personal-access-tokens/new${NEW_TAB}</a>
              while signed in as <strong class="st-owner-name">${p.owner}</strong>.</li>
            <li>Name it something like <em>Bigback phone</em> and pick an expiration. When it expires, make a new one and paste it here.</li>
            <li><strong>Repository access</strong>: choose <em>Only select repositories</em>, then pick <strong class="st-repo-name">${p.repo}</strong>.</li>
            <li><strong>Repository permissions</strong> → <strong>Contents</strong>: <em>Read and write</em>. (Metadata: Read-only is added automatically.)</li>
            <li>Tap <strong>Generate token</strong>, copy it, paste it above and tap <strong>Save &amp; test</strong>.</li>
          </ol>
        </details>
      </div>
    </section>

    <section class="st-sec" aria-labelledby="st-h-lock">
      <h2 class="section-title" id="st-h-lock">Password</h2>
      <div class="panel st-panel">
        <div class="st-conn" data-conn="lock" data-state="busy" role="status" aria-live="polite">
          <span class="st-conn-dot" aria-hidden="true"></span>
          <div class="st-text"><strong class="st-conn-title">Checking…</strong><small class="st-conn-sub"></small></div>
        </div>
        <div class="st-actions">
          <button type="button" class="btn btn-primary" data-act="lock-set" hidden>Set password</button>
          <button type="button" class="btn" data-act="lock-forget" hidden>Lock this device</button>
          <button type="button" class="btn st-danger" data-act="lock-remove" hidden>Remove password</button>
        </div>
        <p class="hint st-lock-note">This adds a lock screen to the app on every device. It isn't encryption: the recipe files in the
          public GitHub repo can still be read there.</p>
      </div>
    </section>

    <section class="st-sec" aria-labelledby="st-h-about">
      <h2 class="section-title" id="st-h-about">About</h2>
      <div class="panel st-panel">
        <dl class="st-dl">
          <div><dt>Version</dt><dd>${APP_VERSION}</dd></div>
          <div><dt>Repository</dt><dd><a class="st-repo-link" href="https://github.com/${p.owner}/${p.repo}" target="_blank" rel="noopener" aria-describedby="st-new-tab">${p.owner}/${p.repo}</a><span id="st-new-tab" hidden>Opens in a new tab</span></dd></div>
          <div><dt>Running as</dt><dd>${standalone() ? 'Home Screen app' : 'Browser tab'}</dd></div>
        </dl>

        <h3 class="st-h3">How updates work</h3>
        <ol class="st-steps">
          <li>Uploads, notes, photos and ratings you save here land in the repo right away.</li>
          <li>Then tell Claude <q>update the site</q>. It turns uploads into finished recipes and folds your notes into them.</li>
          <li>The site redeploys in a minute or two. Reopen Bigback to see the changes.</li>
        </ol>

        <h3 class="st-h3">Add to Home Screen</h3>
        <div class="st-tips">
          <p><strong>iPhone / iPad</strong> — in Safari tap Share ${SHARE} → <em>Add to Home Screen</em>.</p>
          <p><strong>Android</strong> — in Chrome tap the menu ${DOTS} → <em>Install app</em> (or <em>Add to Home screen</em>).</p>
          <p class="muted small">It opens full-screen like an app, keeps your last-seen recipes for offline use, and on iOS 18.4+ can keep the screen awake.</p>
        </div>
        <div class="st-actions st-refresh" hidden>
          <button type="button" class="btn btn-sm" data-act="refresh">Refresh app files</button>
          <span class="hint">Fetches the newest version now instead of on the next open.</span>
        </div>
      </div>
    </section>
  </div>`;
}

const ERR = {
  401: () => ['GitHub rejected this token (401)', "Check that it was copied in full and hasn't expired or been revoked."],
  403: () => ['GitHub refused access (403)', 'The token may be missing permissions, or GitHub is rate-limiting. Try again in a minute.'],
  404: v => [`Can't see ${v.owner}/${v.repo} (404)`, `Check the owner and repository names, and that the token's repository access includes ${v.repo}.`]
};

/** Set/change password sheet → the new password, or null if cancelled. */
function passwordSheet(change) {
  const field = (id, label, extra = '') => html`<div class="field"><label for="${id}">${label}</label>
    <input id="${id}" class="input" type="password" autocomplete="new-password" autocapitalize="off" autocorrect="off" spellcheck="false"${extra}></div>`;
  const body = html`<div class="st-pwform">
    <input class="sr-only" type="text" name="username" value="Bigback" autocomplete="username" tabindex="-1" aria-hidden="true">
    ${field('st-pw1', change ? 'New password' : 'Password', ' autofocus')}
    ${field('st-pw2', 'Type it again')}
    <p class="st-pw-err" role="alert"></p>
    <p class="hint">Saved to your repo as a salted hash, never as the password itself. This device stays unlocked;
      every other device asks for it once, then remembers it. If you forget it, set a new one from a device that's
      still unlocked, or delete <code>data/lock.json</code> in the repo on GitHub.</p>
  </div>`;
  const valid = w => {
    const a = w.querySelector('#st-pw1'), b = w.querySelector('#st-pw2'), err = w.querySelector('.st-pw-err');
    if (a.value.length < MIN_LENGTH) { err.textContent = `Use at least ${MIN_LENGTH} characters.`; a.focus(); return undefined; }
    if (a.value !== b.value) { err.textContent = "The two passwords don't match."; b.focus(); return undefined; }
    return a.value;
  };
  return sheet({
    title: change ? 'Change password' : 'Set a password', body,
    actions: [{ label: 'Cancel', value: null }, { label: 'Save', kind: 'primary', value: valid }],
    onOpen: (w, close) => {
      w.querySelector('#st-pw1').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); w.querySelector('#st-pw2').focus(); } });
      w.querySelector('#st-pw2').addEventListener('keydown', e => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        const v = valid(w);
        if (v !== undefined) close(v);
      });
    }
  });
}

/** → { ok: true|false|null(unreachable), state, title, sub } */
async function verify(vals) {
  try {
    const r = await new GitHub(vals).check();
    const branchNote = r.defaultBranch && r.defaultBranch !== vals.branch ? ` Saving to “${vals.branch}” (the default branch is “${r.defaultBranch}”).` : '';
    if (r.canPush) return { ok: true, state: 'ok', title: `Connected to ${r.fullName} · can write ✓`, sub: `${r.private ? 'Private' : 'Public'} repository. Saving is on for this device.${branchNote}` };
    return { ok: true, state: 'warn', title: `Connected to ${r.fullName}, but read-only`, sub: `This token can't write. On GitHub, edit the token: Repository permissions → Contents → Read and write.${branchNote}` };
  } catch (e) {
    const s = e?.status;
    if (ERR[s]) { const [title, sub] = ERR[s](vals); return { ok: false, state: 'error', title, sub }; }
    if (!s) return { ok: null, state: 'warn', title: "Couldn't reach GitHub", sub: 'Check your connection and try again.' };
    return { ok: false, state: 'error', title: `GitHub said ${s}`, sub: e.body || e.message || '' };
  }
}

export async function render(root) {
  setTopbar({ title: 'Settings' });
  initWakeLock();
  root.innerHTML = view(getPrefs());
  const $ = s => root.querySelector(s);
  let alive = true, checkSeq = 0;

  const conn = $('.st-conn[data-conn="gh"]');
  function setConn(state, title, sub = '', box = conn) {
    box.dataset.state = state;
    box.querySelector('.st-conn-title').textContent = title;
    box.querySelector('.st-conn-sub').textContent = sub;
  }

  let lockOn = false, lockSeq = 0;
  async function paintLock({ force = false } = {}) {
    const my = ++lockSeq;
    let cfg = null;
    try { cfg = await getLock({ force }); } catch { /* treat as no password */ }
    if (!alive || my !== lockSeq) return;
    lockOn = validLock(cfg);
    const connected = !!getPrefs().token, here = rememberedHere();
    let sub = !lockOn ? 'Anyone with the link can open Bigback.'
      : here === 'session' ? "Every device asks for it once. This one isn't remembered, so it asks again after you close Bigback."
      : 'Every device asks for it once, then remembers it.';
    if (!connected) sub += ` Connect GitHub above to ${lockOn ? 'change or remove it' : 'set one'}.`;
    setConn(lockOn ? 'ok' : 'off', lockOn ? 'Password is on' : 'No password', sub, $('.st-conn[data-conn="lock"]'));
    const set = $('[data-act="lock-set"]');
    set.hidden = false;
    set.textContent = lockOn ? 'Change password' : 'Set password';
    set.classList.toggle('btn-primary', !lockOn);
    set.disabled = !connected;
    $('[data-act="lock-remove"]').hidden = !lockOn;
    $('[data-act="lock-remove"]').disabled = !connected;
    $('[data-act="lock-forget"]').hidden = !lockOn;
  }

  async function onLock(act, el) {
    if (act === 'lock-forget') {
      forgetDevice();
      location.reload();
      return;
    }
    if (act === 'lock-remove') {
      const ok = await confirmSheet('Anyone with the link will be able to open Bigback again, on every device.',
        { title: 'Remove the password?', ok: 'Remove', danger: true });
      if (!ok || !alive) return;
      try {
        await busy(el, saveLock(null));
        forgetDevice();
        toast('Password removed', { type: 'ok' });
      } catch (e) { reportError(e); }
      if (alive) paintLock();
      return;
    }
    // lock-set
    if (!lockSupported()) { toast('Open the https site to set a password.', { type: 'error' }); return; }
    const change = lockOn;
    const pw = await passwordSheet(change);
    if (!pw || !alive) return;
    try {
      await busy(el, (async () => {
        const { config, key } = await makeLock(pw);
        await saveLock(config);
        remember(key, true);
      })());
      toast(change ? 'Password changed. Other devices will ask for the new one.' : 'Password set. This device is remembered.', { type: 'ok' });
    } catch (e) { reportError(e); }
    if (alive) paintLock();
  }
  const notConnected = () => setConn('off', 'Not connected', 'Browsing works. Add a token below to save changes from this device.');

  function paintWake() {
    const s = wakeLockStatus(), want = getPrefs().wakeLock, el = $('#st-wake');
    let text, state = s;
    if (s === 'unsupported') {
      text = window.isSecureContext
        ? 'Not supported on this browser — iOS needs 16.4+, Home-Screen app 18.4+.'
        : 'Needs a secure (https) connection to work.';
    } else if (!want) { text = 'Off — your screen sleeps as usual.'; state = 'off'; }
    else if (s === 'active') text = 'Active — the screen stays on while Bigback is open.';
    else if (s === 'error') text = "Couldn't keep the screen on (battery saver can block it). Tap anywhere to retry.";
    else { text = 'On — waiting for the page to be visible.'; state = 'pending'; }
    el.textContent = text;
    el.dataset.state = state;
    const box = $('input[data-pref="wakeLock"]');
    if (box.checked !== want) box.checked = want;
  }

  function paintNotify() {
    const el = $('#st-notify'), btn = $('[data-act="notify"]');
    let text, ask = false;
    if (!('Notification' in window)) text = 'Not available in this browser. On iPhone, add Bigback to your Home Screen first (iOS 16.4+).';
    else if (Notification.permission === 'granted') text = 'On — you get an alert when a timer finishes while Bigback is in the background.';
    else if (Notification.permission === 'denied') text = 'Blocked — allow notifications for this site in your browser settings.';
    else { text = 'Get an alert when a timer finishes while Bigback is in the background.'; ask = true; }
    el.textContent = text;
    btn.hidden = !ask;
  }

  function paintSegs() {
    const p = getPrefs();
    root.querySelectorAll('[data-theme]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.theme === p.theme)));
    root.querySelectorAll('[data-units]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.units === p.units)));
    $('input[data-pref="sound"]').checked = !!p.sound;
  }

  function paintRepo(p = getPrefs()) {
    $('[data-act="disconnect"]').hidden = !p.token;
    $('.st-owner-name').textContent = p.owner;
    $('.st-repo-name').textContent = p.repo;
    const a = $('.st-repo-link');
    a.href = `https://github.com/${encodeURIComponent(p.owner)}/${encodeURIComponent(p.repo)}`;
    a.textContent = `${p.owner}/${p.repo}`;
  }

  const form = $('form[data-form="gh"]');
  const values = () => {
    const f = new FormData(form), v = k => String(f.get(k) || '').trim();
    return { token: v('token').replace(/^["']|["']$/g, ''), owner: v('owner'), repo: v('repo'), branch: v('branch') || 'main' };
  };

  async function check(vals, { save }) {
    const my = ++checkSeq;
    setConn('busy', 'Checking with GitHub…');
    const r = await (save ? busy($('.st-save'), verify(vals)) : verify(vals));
    if (!alive || my !== checkSeq) return;
    if (!save) return setConn(r.state, r.title, r.sub);
    if (r.ok === false) {
      setConn(r.state, r.title, `${r.sub} Nothing was saved.`);
      return;
    }
    setPrefs(vals);
    paintRepo();
    if (r.ok) {
      setConn(r.state, r.title, r.sub);
      toast(r.state === 'ok' ? 'GitHub connected' : 'Saved — but this token is read-only', { type: r.state === 'ok' ? 'ok' : 'info' });
      $('.st-howto').open = false;
    } else {
      setConn('warn', 'Saved, not tested', "Couldn't reach GitHub to test it. It will be used once you're online.");
      toast('Saved');
    }
  }

  async function onSave(e) {
    e.preventDefault();
    const vals = values();
    if (!vals.owner || !vals.repo) {
      setConn('error', 'Owner and repository are required', 'They come from the repo URL: github.com/owner/repository.');
      return;
    }
    if (!vals.token) {
      checkSeq++;
      setPrefs(vals); paintRepo(); notConnected();
      toast('Saved');
      return;
    }
    await check(vals, { save: true });
  }

  async function onAct(e, el) {
    const act = el.dataset.act;
    if (act.startsWith('lock-')) return onLock(act, el);
    if (act === 'reveal') {
      const input = $('#st-token'), show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      el.textContent = show ? 'Hide' : 'Show';
      el.setAttribute('aria-label', show ? 'Hide token' : 'Show token');
    } else if (act === 'disconnect') {
      const ok = await confirmSheet('Saving recipes, notes and photos will be off on this device until you add a token again. Browsing keeps working.',
        { title: 'Disconnect GitHub?', ok: 'Disconnect', danger: true });
      if (!ok || !alive) return;
      checkSeq++;
      setPrefs({ token: '' });
      $('#st-token').value = '';
      paintRepo(); notConnected();
      toast('Token removed from this device');
    } else if (act === 'test') {
      startTimer({ label: 'Test alarm', seconds: 3 });
      toast(getPrefs().sound ? 'Alarm in 3 seconds…' : 'Alarm in 3 seconds — timer sound is off, so no beeps');
    } else if (act === 'notify') {
      try { await Notification.requestPermission(); } catch { /* old Safari: callback form */ }
      if (alive) paintNotify();
    } else if (act === 'refresh') {
      el.disabled = true;
      try {
        const reg = await navigator.serviceWorker?.getRegistration?.();
        await reg?.update?.();
        const keys = await caches.keys();
        await Promise.all(keys.filter(k => k.startsWith('bb-shell')).map(k => caches.delete(k)));
      } catch { /* reload anyway */ }
      location.reload();
    }
  }

  paintWake(); paintNotify(); paintRepo(); paintLock({ force: true });
  if (navigator.serviceWorker?.controller && 'caches' in window) $('.st-refresh').hidden = false;

  const p = getPrefs();
  if (!p.token) notConnected();
  else if (!navigator.onLine) setConn('warn', 'Token saved', "You're offline, so it can't be checked right now.");
  else check(p, { save: false });

  const offs = [
    on(root, 'change', 'input[data-pref]', (e, el) => setPrefs({ [el.dataset.pref]: el.checked })),
    on(root, 'click', '[data-theme]', (e, el) => setPrefs({ theme: el.dataset.theme })),
    on(root, 'click', '[data-units]', (e, el) => setPrefs({ units: el.dataset.units })),
    on(root, 'click', '[data-act]', onAct),
    on(root, 'submit', 'form[data-form="gh"]', onSave),
    onWakeLock(paintWake),
    onPrefs(() => { paintWake(); paintSegs(); paintLock(); })
  ];
  return () => { alive = false; offs.forEach(off => off()); };
}
