/**
 * app.js — boot + hash router. Each route lazy-loads `js/views/<name>.js`, which must
 *   export async function render(root, params) → optional cleanup()
 * params = { ...routeParams, query: URLSearchParams }.
 *
 * Routes:
 *   #/                    library        #/playlist/<id>   library (playlist filter)
 *   #/r/<slug>            recipe         #/r/<slug>/cook   cook (step-by-step mode)
 *   #/add                 add (chooser)  #/add/custom  #/add/upload  #/edit/<slug>
 *   #/pending/<id>        pending        #/playlists       playlists
 *   #/convert             convert (weight / volume / temperature)
 *   #/settings            settings
 */
import { getPrefs, onPrefs } from './prefs.js';
import { onChange, revalidateAll, warmRecipes } from './store.js';
import { $, $$, reportError, toast } from './ui.js';
import { unlockGate } from './lock.js';

const ROUTES = [
  [/^$/, 'library', () => ({})],
  [/^playlist\/([\w-]+)$/, 'library', m => ({ playlist: m[1] })],
  [/^r\/([\w-]+)$/, 'recipe', m => ({ slug: m[1] })],
  [/^r\/([\w-]+)\/cook$/, 'cook', m => ({ slug: m[1] })],
  [/^add$/, 'add', () => ({ mode: 'choose' })],
  [/^add\/(custom|upload)$/, 'add', m => ({ mode: m[1] })],
  [/^edit\/([\w-]+)$/, 'add', m => ({ mode: 'edit', slug: m[1] })],
  [/^pending\/([\w-]+)$/, 'pending', m => ({ id: m[1] })],
  [/^playlists$/, 'playlists', () => ({})],
  [/^convert$/, 'convert', () => ({})],
  [/^settings$/, 'settings', () => ({})]
];
// Adding a recipe starts from the Recipes page (its topbar "Add" button), so it lights up Recipes.
const NAV_OF = { library: 'library', recipe: 'library', cook: 'library', pending: 'library', add: 'library', playlists: 'playlists', convert: 'convert', settings: 'settings' };

let cleanup = null, seq = 0, firstRoute = true;

/** After a client-side navigation: tell screen readers where they landed, and if the focused
 *  element was replaced with the old view, put focus on the new view instead of <body>. */
function announceRoute() {
  if (firstRoute) { firstRoute = false; return; }
  const live = document.getElementById('route-announcer');
  if (live) live.textContent = `${$('#topbar-title')?.textContent || document.title} page`;
  const f = document.activeElement;
  if (!f || f === document.body || !f.isConnected) $('#view')?.focus({ preventScroll: true });
}

function parse() {
  // Split before decoding so an encoded "&" in a search ("mac %26 cheese") stays in its value.
  const h = location.hash.replace(/^#\/?/, '');
  const i = h.indexOf('?');
  const path = decodeURIComponent(i < 0 ? h : h.slice(0, i)), qs = i < 0 ? '' : h.slice(i + 1);
  for (const [re, view, fn] of ROUTES) {
    const m = path.replace(/\/+$/, '').match(re);
    if (m) return { view, params: { ...fn(m), query: new URLSearchParams(qs) } };
  }
  return { view: 'library', params: { query: new URLSearchParams() } };
}

async function route() {
  const my = ++seq;
  const { view, params } = parse();
  const root = $('#view');
  try { cleanup?.(); } catch (e) { console.error(e); }
  cleanup = null;
  const nav = params.playlist ? 'playlists' : NAV_OF[view];
  // aria-current must carry a value: an empty attribute means "false" to screen readers.
  $$('.bottomnav [data-nav]').forEach(a => (a.dataset.nav === nav ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current')));
  document.body.dataset.view = view;
  root.setAttribute('aria-busy', 'true');
  try {
    const mod = await import(`./views/${view}.js`);
    if (my !== seq) return;                       // user navigated again meanwhile
    root.innerHTML = '';
    root.scrollTop = 0; window.scrollTo(0, 0);
    const c = await mod.render(root, params);
    if (my !== seq) {                             // finished after the user moved on: undo its
      try { if (typeof c === 'function') c(); } catch (e) { console.error(e); }   // listeners + subscriptions
      return;
    }
    cleanup = typeof c === 'function' ? c : null;
    announceRoute();
  } catch (e) {
    console.error(e);
    if (my === seq) root.innerHTML = `<div class="empty"><p>Couldn't open this page.</p><p class="muted small">${String(e.message || e).replace(/</g, '&lt;')}</p><a class="btn" href="#/">Back to recipes</a></div>`;
  } finally {
    if (my === seq) root.removeAttribute('aria-busy');
  }
}

function applyTheme({ theme }) {
  const root = document.documentElement;
  root.dataset.theme = theme === 'auto' ? '' : theme;
  // Status bar / task-switcher colour follows a forced in-app theme, not just the OS setting.
  const bg = getComputedStyle(root).getPropertyValue('--bg').trim();
  $$('meta[name="theme-color"]').forEach(m => {
    m.dataset.auto ??= m.content;
    m.content = theme === 'auto' || !bg ? m.dataset.auto : bg;
  });
}

async function boot() {
  applyTheme(getPrefs());
  onPrefs(applyTheme);
  const useSW = 'serviceWorker' in navigator && location.protocol === 'https:';
  if (useSW) {
    // A new deploy's service worker took over: this page is still running the old code, and its
    // next lazy imports would come from the new cache (old + new modules mixed). Reload once —
    // timers, the stopwatch, checked ingredients and drafts all survive it.
    if (navigator.serviceWorker.controller) {
      let reloading = false;
      const busy = () => document.querySelector('.sheet-backdrop') || /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '');
      const reload = () => { if (!reloading && !busy()) { reloading = true; location.reload(); } };
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        reload();
        // Typing or in a sheet → wait for the next navigation or app switch.
        window.addEventListener('hashchange', reload);
        document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reload(); });
      });
    }
  }

  // Fetch the first view's code while the lock check runs; route() then reuses the module.
  import(`./views/${parse().view}.js`).catch(() => {});

  // Site password (data/lock.json): nothing renders until it's unlocked or this device is remembered.
  document.documentElement.classList.add('is-gating');
  await unlockGate();

  window.addEventListener('hashchange', route);
  const firstView = route();

  // Home Screen apps resume from memory: after a while away, re-check the files on screen
  // (they repaint only if something changed, e.g. a recipe built since).
  let hiddenAt = 0;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') hiddenAt = Date.now();
    else if (hiddenAt && Date.now() - hiddenAt > 60000) { hiddenAt = 0; revalidateAll(); }
  });

  // Write failures from batched library saves.
  let warnedRead = false;
  onChange(ev => {
    if (ev.type === 'error') reportError(ev.error);
    if (ev.type === 'read-error' && !warnedRead && navigator.onLine) {
      warnedRead = true;
      toast(ev.error?.status === 401 ? 'GitHub token rejected — showing the public copy. Check Settings.' : 'Couldn’t reach GitHub — showing the public copy.', { type: 'error' });
    }
  });

  // <img data-fallback="raw-url">: fresh uploads aren't on Pages until it redeploys.
  document.addEventListener('error', e => {
    const img = e.target;
    if (img.tagName === 'IMG' && img.dataset.fallback && img.src !== img.dataset.fallback) {
      img.src = img.dataset.fallback; delete img.dataset.fallback;
    }
  }, true);

  const offline = () => document.body.classList.toggle('is-offline', !navigator.onLine);
  window.addEventListener('online', () => { offline(); toast('Back online', { type: 'ok' }); });
  // The banner only appears visually; say it too.
  window.addEventListener('offline', () => { offline(); toast('Offline — showing saved copies'); });
  offline();

  // Below: work that shouldn't compete with the first view for the network (4 s at most).
  const settle = p => Promise.race([p, new Promise(r => setTimeout(r, 4000))]);

  // Kitchen tools are global — mounted once, survive navigation.
  settle(firstView).then(() => {
    for (const [file, fn] of [['./timers.js', 'mount'], ['./stopwatch.js', 'mount'], ['./wakelock.js', 'initWakeLock']]) {
      import(file).then(m => m[fn]?.()).catch(e => console.error(file, e));
    }
    // A moment later: copies of the recipes not opened on this device yet, and the recipe
    // page's code, so the first tap on a recipe opens at once (offline too).
    setTimeout(() => {
      import('./views/recipe.js').catch(() => {});
      if (navigator.onLine && !navigator.connection?.saveData) warmRecipes().catch(() => {});
    }, 1500);
  });

  // First visit: the install downloads the whole shell, so it waits for the view and its eager
  // photo (a recipe's hero; list thumbnails are lazy). Later launches: the browser checks sw.js
  // on its own; Home Screen apps resume from memory without a page load, so also check
  // whenever the app comes back to the foreground.
  const eagerImages = () => Promise.all([...document.querySelectorAll('#view img:not([loading="lazy"])')].map(i => i.decode().catch(() => {})));
  if (useSW) settle(firstView.then(eagerImages)).then(() => navigator.serviceWorker.register('sw.js')).then(reg => {
    let last = Date.now();
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible' || Date.now() - last < 30000) return;
      last = Date.now();
      reg.update().catch(() => {});
    });
  }).catch(() => {});
}

boot();
