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
 *   #/settings            settings
 */
import { getPrefs, onPrefs } from './prefs.js';
import { onChange } from './store.js';
import { $, $$, reportError, toast } from './ui.js';

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
  [/^settings$/, 'settings', () => ({})]
];
const NAV_OF = { library: 'library', recipe: 'library', cook: 'library', pending: 'library', add: 'add', playlists: 'playlists', settings: 'settings' };

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
    if (my === seq) { cleanup = typeof c === 'function' ? c : null; announceRoute(); }
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

function boot() {
  applyTheme(getPrefs());
  onPrefs(applyTheme);
  window.addEventListener('hashchange', route);
  route();

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

  // Kitchen tools are global — mounted once, survive navigation.
  for (const [file, fn] of [['./timers.js', 'mount'], ['./stopwatch.js', 'mount'], ['./wakelock.js', 'initWakeLock']]) {
    import(file).then(m => m[fn]?.()).catch(e => console.error(file, e));
  }

  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

boot();
