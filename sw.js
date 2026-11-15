/**
 * sw.js — offline support (WS4). app.js registers it on https only.
 *
 * Caches (VERSION is replaced at deploy with a hash of the app files — .github/workflows/pages.yml —
 * so every code change moves phones onto a fresh shell cache; app.js then reloads once):
 *   bb-shell-<VERSION>  app shell — cache-first. Installed whole from SHELL and then served
 *                       without asking the network: its contents only change with VERSION, and
 *                       the browser re-checks sw.js on every launch (app.js also on resume), so
 *                       a code deploy still lands on the next launch, as one consistent set.
 *                       Launches cost no shell requests; data-only deploys (ratings, notes)
 *                       cost none either.
 *   bb-data-v1          same-origin JSON under recipes/, data/, journal/, inbox/ — network-first,
 *                       cache fallback when offline/slow (key ignores the ?t= cache-buster).
 *                       Nothing cached → network error, so store.js falls back to its snapshot.
 *   bb-media-v1         images (media/ etc.) — cache-first, trimmed to MEDIA_MAX entries.
 *                       Uploads get unique names (hero-<id>.jpg, journal/<id>.jpg) and never
 *                       change; a fixed name (hero.jpg) can be replaced in place, so a copy of
 *                       one that is over a day old is re-checked in the background.
 * Never intercepted: non-GET, Range requests, other origins (api.github.com,
 * raw.githubusercontent.com, …).
 *
 * SHELL must list every app file. When you add a JS/CSS file, add it here (anything missing
 * is still cached on first use, it just isn't available offline before that).
 */
const VERSION = '5';
const SHELL_CACHE = `bb-shell-${VERSION}`;
const DATA_CACHE = 'bb-data-v1';
const MEDIA_CACHE = 'bb-media-v1';
const KEEP = [SHELL_CACHE, DATA_CACHE, MEDIA_CACHE];
const MEDIA_MAX = 300;
const DATA_TIMEOUT = 6000;
const MEDIA_RECHECK = 24 * 3600e3;

const SHELL = [
  './', 'index.html', 'manifest.webmanifest',
  'css/base.css', 'css/library.css', 'css/recipe.css', 'css/editor.css', 'css/tools.css',
  'js/app.js', 'js/config.js', 'js/lock.js', 'js/prefs.js', 'js/util.js', 'js/ui.js', 'js/github.js', 'js/store.js',
  'js/timers.js', 'js/stopwatch.js', 'js/wakelock.js', 'js/units.js',
  'js/views/library.js', 'js/views/playlists.js', 'js/views/recipe.js', 'js/views/cook.js',
  'js/views/add.js', 'js/views/pending.js', 'js/views/settings.js', 'js/views/convert.js',
  'js/components/meta-editor.js', 'js/components/back-nav.js', 'js/components/recipe-icons.js', 'js/components/recipe-ingredients.js',
  'js/components/recipe-journal.js', 'js/components/recipe-mentions.js', 'js/components/recipe-state.js', 'js/components/recipe-steps.js',
  'js/components/editor-drafts.js', 'js/components/editor-form.js', 'js/components/editor-icons.js',
  'js/components/editor-ids.js', 'js/components/editor-parse.js', 'js/components/editor-upload.js',
  'assets/icons/icon.svg', 'assets/icons/icon-180.png', 'assets/icons/icon-192.png',
  'assets/icons/icon-512.png', 'assets/icons/maskable-512.png'
];
const DATA_DIRS = ['recipes/', 'data/', 'journal/', 'inbox/'];
const SHELL_EXT = /\.(?:html|js|mjs|css|webmanifest|svg|png|ico|woff2?)$/i;
const IMAGE_EXT = /\.(?:jpe?g|png|webp|gif|avif|heic|svg)$/i;
const UNIQUE_NAME = /\/journal\/|-[a-z0-9]{6,}\.[a-z0-9]+$/i;    // never rewritten in place

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    // 'no-cache' revalidates with the server, so a file the page has just downloaded comes back
    // as a 304 instead of a second copy. A file the server doesn't have (404) is skipped; a
    // network failure fails the install, so the browser retries on a later launch instead of
    // keeping a shell with holes in it (the old version keeps working meanwhile).
    await Promise.all(SHELL.map(async p => {
      const res = await fetch(new Request(p, { cache: 'no-cache' }));
      if (cacheable(res)) await cache.put(p, res);
    }));
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
    if (rel === '' || rel === 'index.html') return event.respondWith(fromShell(event, scope, scope));
    return event.respondWith(networkFirst(event, url.href, SHELL_CACHE));
  }
  if (rel.endsWith('.json') && DATA_DIRS.some(d => rel.startsWith(d))) {
    return event.respondWith(networkFirst(event, req, DATA_CACHE));
  }
  if (rel.startsWith('assets/') || rel.startsWith('css/') || rel.startsWith('js/') || (SHELL_EXT.test(rel) && !rel.includes('/'))) {
    return event.respondWith(fromShell(event, req, stripSearch(url)));
  }
  if (req.destination === 'image' || IMAGE_EXT.test(rel)) {
    return event.respondWith(cacheFirst(event, req, stripSearch(url), !UNIQUE_NAME.test(rel)));
  }
  // Anything else (PDFs in inbox/, sources/ …) goes straight to the network.
});

const stripSearch = url => { const u = new URL(url); u.search = ''; u.hash = ''; return u.href; };
const cacheable = r => r && r.ok && (r.type === 'basic' || r.type === 'default');

/** Shell: this version's cache. A file that isn't in it (skipped at install) is fetched and kept;
 *  'no-cache' so Pages' 10-minute HTTP max-age can't hand back a previous deploy's copy.
 *  `fetchable` is a URL or a non-navigate Request. */
async function fromShell(event, fetchable, key) {
  const cache = await caches.open(SHELL_CACHE);
  const hit = await cache.match(key, { ignoreSearch: true });
  if (hit) return hit;
  try {
    const res = await fetch(new Request(fetchable, { cache: 'no-cache' }));
    if (cacheable(res)) event.waitUntil(cache.put(key, res.clone()));
    return res;
  } catch {
    return Response.error();
  }
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

/** Images: cache first; fill on miss. `mutable` (a fixed file name): re-check a day-old copy behind it. */
async function cacheFirst(event, req, key, mutable) {
  const cache = await caches.open(MEDIA_CACHE);
  const hit = await cache.match(key);
  if (hit) {
    if (mutable && !(Date.now() - Date.parse(hit.headers.get('date') || '') < MEDIA_RECHECK)) {
      event.waitUntil(fetch(key, { cache: 'no-cache' })
        .then(res => (cacheable(res) ? cache.put(key, res) : null)).catch(() => null));
    }
    return hit;
  }
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
