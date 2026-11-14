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

let cleanup = null, seq = 0;

function parse() {
  const h = decodeURIComponent(location.hash.replace(/^#\/?/, ''));
  const [path, qs = ''] = h.split('?');
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
  $$('.bottomnav [data-nav]').forEach(a => a.toggleAttribute('aria-current', a.dataset.nav === NAV_OF[view]));
  document.body.dataset.view = view;
  root.setAttribute('aria-busy', 'true');
  try {
    const mod = await import(`./views/${view}.js`);
    if (my !== seq) return;                       // user navigated again meanwhile
    root.innerHTML = '';
    root.scrollTop = 0; window.scrollTo(0, 0);
    const c = await mod.render(root, params);
    if (my === seq) cleanup = typeof c === 'function' ? c : null;
  } catch (e) {
    console.error(e);
    if (my === seq) root.innerHTML = `<div class="empty"><p>Couldn't open this page.</p><p class="muted small">${String(e.message || e).replace(/</g, '&lt;')}</p><a class="btn" href="#/">Back to recipes</a></div>`;
  } finally {
    if (my === seq) root.removeAttribute('aria-busy');
  }
}

function applyTheme({ theme }) {
  document.documentElement.dataset.theme = theme === 'auto' ? '' : theme;
}

function boot() {
  applyTheme(getPrefs());
  onPrefs(applyTheme);
  window.addEventListener('hashchange', route);
  route();

  // Write failures from batched library saves.
  onChange(ev => { if (ev.type === 'error') reportError(ev.error); });

  // <img data-fallback="raw-url">: fresh uploads aren't on Pages until it redeploys.
  document.addEventListener('error', e => {
    const img = e.target;
    if (img.tagName === 'IMG' && img.dataset.fallback && img.src !== img.dataset.fallback) {
      img.src = img.dataset.fallback; delete img.dataset.fallback;
    }
  }, true);

  const offline = () => document.body.classList.toggle('is-offline', !navigator.onLine);
  window.addEventListener('online', () => { offline(); toast('Back online', { type: 'ok' }); });
  window.addEventListener('offline', offline);
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
