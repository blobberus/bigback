/**
 * sw.js — offline support (WS4). app.js registers it on https only.
 *
 * Caches (bump VERSION to move everyone onto a fresh shell cache):
 *   bb-shell-<VERSION>  app shell — stale-while-revalidate. Served instantly from cache and
 *                       revalidated in the background; when any shell file has changed, the
 *                       whole cached shell is refetched so lazily-loaded views don't mix old
 *                       and new code for more than one load.
 *   bb-data-v1          same-origin JSON under recipes/, data/, journal/, inbox/ — network-first,
 *                       cache fallback when offline/slow (key ignores the ?t= cache-buster).
 *                       Nothing cached → network error, so store.js falls back to its snapshot.
 *   bb-media-v1         images (media/ etc.) — cache-first, trimmed to MEDIA_MAX entries.
 * Never intercepted: non-GET, Range requests, other origins (api.github.com,
 * raw.githubusercontent.com, …).
 *
 * SHELL must list every app file. When you add a JS/CSS file, add it here (anything missing
 * is still cached on first use, it just isn't available offline before that).
 */
const VERSION = '4';
const SHELL_CACHE = `bb-shell-${VERSION}`;
const DATA_CACHE = 'bb-data-v1';
const MEDIA_CACHE = 'bb-media-v1';
const KEEP = [SHELL_CACHE, DATA_CACHE, MEDIA_CACHE];
const MEDIA_MAX = 300;
const DATA_TIMEOUT = 6000;

const SHELL = [
  './', 'index.html', 'manifest.webmanifest',
  'css/base.css', 'css/library.css', 'css/recipe.css', 'css/editor.css', 'css/tools.css',
  'js/app.js', 'js/config.js', 'js/lock.js', 'js/prefs.js', 'js/util.js', 'js/ui.js', 'js/github.js', 'js/store.js',
  'js/timers.js', 'js/stopwatch.js', 'js/wakelock.js', 'js/units.js',
  'js/views/library.js', 'js/views/playlists.js', 'js/views/recipe.js', 'js/views/cook.js',
  'js/views/add.js', 'js/views/pending.js', 'js/views/settings.js',
  'js/components/meta-editor.js', 'js/components/recipe-icons.js', 'js/components/recipe-ingredients.js',
  'js/components/recipe-journal.js', 'js/components/recipe-mentions.js', 'js/components/recipe-state.js', 'js/components/recipe-steps.js',
  'js/components/editor-drafts.js', 'js/components/editor-form.js', 'js/components/editor-icons.js',
  'js/components/editor-ids.js', 'js/components/editor-parse.js', 'js/components/editor-upload.js',
  'assets/icons/icon.svg', 'assets/icons/icon-180.png', 'assets/icons/icon-192.png',
  'assets/icons/icon-512.png', 'assets/icons/maskable-512.png'
];
const DATA_DIRS = ['recipes/', 'data/', 'journal/', 'inbox/'];
const SHELL_EXT = /\.(?:html|js|mjs|css|webmanifest|svg|png|ico|woff2?)$/i;
const IMAGE_EXT = /\.(?:jpe?g|png|webp|gif|avif|heic|svg)$/i;

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    // fetch + put (not addAll): a single missing file must not abort the whole install.
    await Promise.all(SHELL.map(p => fetch(new Request(p, { cache: 'reload' }))
      .then(res => (cacheable(res) ? cache.put(p, res) : null))
      .catch(() => null)));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k.startsWith('bb-') && !KEEP.includes(k)).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET' || req.headers.has('range')) return;
  const url = new URL(req.url);
  const scope = self.registration.scope;
  if (url.origin !== self.location.origin || !url.href.startsWith(scope)) return;
  const rel = url.pathname.slice(new URL(scope).pathname.length);     // e.g. "recipes/x.json"
  if (rel === 'sw.js') return;

  if (req.mode === 'navigate') {
    if (rel === '' || rel === 'index.html') return event.respondWith(staleWhileRevalidate(event, scope, scope));
    return event.respondWith(networkFirst(event, url.href, SHELL_CACHE));
  }
  if (rel.endsWith('.json') && DATA_DIRS.some(d => rel.startsWith(d))) {
    return event.respondWith(networkFirst(event, req, DATA_CACHE));
  }
  if (rel.startsWith('assets/') || rel.startsWith('css/') || rel.startsWith('js/') || (SHELL_EXT.test(rel) && !rel.includes('/'))) {
    return event.respondWith(staleWhileRevalidate(event, req, stripSearch(url)));
  }
  if (req.destination === 'image' || IMAGE_EXT.test(rel)) {
    return event.respondWith(cacheFirst(event, req, stripSearch(url)));
  }
  // Anything else (PDFs in inbox/, sources/ …) goes straight to the network.
});

const stripSearch = url => { const u = new URL(url); u.search = ''; u.hash = ''; return u.href; };
const stamp = r => r.headers.get('etag') || r.headers.get('last-modified') || '';
const cacheable = r => r && r.ok && (r.type === 'basic' || r.type === 'default');

/**
 * Shell: answer from cache, refresh in the background. `fetchable` is a URL or a non-navigate
 * Request; 'no-cache' makes the refresh revalidate past Pages' 10-minute HTTP max-age.
 */
async function staleWhileRevalidate(event, fetchable, key) {
  const cache = await caches.open(SHELL_CACHE);
  const cached = await cache.match(key, { ignoreSearch: true });
  const fresh = fetch(new Request(fetchable, { cache: 'no-cache' }))
    .then(async res => {
      if (cacheable(res)) {
        const changed = cached && stamp(cached) !== stamp(res);
        await cache.put(key, res.clone());
        if (changed) await refreshShell(cache, key);
      }
      return res;
    })
    .catch(() => null);
  event.waitUntil(fresh);
  return cached || (await fresh) || Response.error();
}

let lastRefresh = 0;
/** A shell file changed upstream → refetch every cached shell entry so the next load is consistent. */
async function refreshShell(cache, skip) {
  if (Date.now() - lastRefresh < 30000) return;
  lastRefresh = Date.now();
  const reqs = await cache.keys();
  await Promise.all(reqs.filter(r => r.url !== skip).map(r =>
    fetch(new Request(r.url, { cache: 'no-cache' }))
      .then(res => (cacheable(res) ? cache.put(r, res) : null))
      .catch(() => null)));
}

/** Data: network first (cached under the URL without ?query), cache when offline or slow. */
async function networkFirst(event, req, cacheName) {
  const cache = await caches.open(cacheName);
  const key = stripSearch(typeof req === 'string' ? req : req.url);
  const net = fetch(req).then(async res => {
    if (cacheable(res)) await cache.put(key, res.clone());
    return res;
  });
  const timeout = new Promise(resolve => setTimeout(resolve, DATA_TIMEOUT, 'timeout'));
  try {
    const first = await Promise.race([net, timeout]);
    if (first !== 'timeout') return first;
    const hit = await cache.match(key);
    if (hit) { event.waitUntil(net.catch(() => null)); return hit; }
    return await net;
  } catch {
    // Offline: last good copy, else a network error (store.js then uses its own snapshot).
    return (await cache.match(key)) || Response.error();
  }
}

/** Images: cache first; fill on miss. */
async function cacheFirst(event, req, key) {
  const cache = await caches.open(MEDIA_CACHE);
  const hit = await cache.match(key);
  if (hit) return hit;
  try {
    const res = await fetch(req);
    if (cacheable(res)) {
      await cache.put(key, res.clone());
      event.waitUntil(trim(cache));
    }
    return res;
  } catch {
    return Response.error();
  }
}

async function trim(cache) {
  const keys = await cache.keys();
  if (keys.length > MEDIA_MAX) await Promise.all(keys.slice(0, keys.length - MEDIA_MAX).map(k => cache.delete(k)));
}

/** Timer notifications (timers.js) → focus the open app, or open it. */
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || '', self.registration.scope).href;
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const win = wins.find(w => w.url.startsWith(self.registration.scope));
    if (win) return win.focus();
    return self.clients.openWindow(target);
  })());
});
