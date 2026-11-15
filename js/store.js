/**
 * store.js — the app's data layer. Views never call fetch/GitHub directly.
 *
 * READS (work without a token; with a token they hit the GitHub API so they're fresh)
 *   getIndex({force})            → { recipes:[summary], pending:[item] }
 *   getRecipe(slug)              → recipe | null
 *   getLibrary()                 → { recipes:{slug:entry}, playlists:[] }
 *   entryFor(lib, slug)          → entry with blank defaults (tags [], rating null, proficiency null, pinnedAt null)
 *   allTags(lib)                 → sorted unique tags
 *   getJournal(slug)             → { slug, entries:[] }
 *   getPending(id)               → inbox item | null
 *   mediaUrl(path) / rawUrl(path)  image src + fallback (use <img data-fallback>)
 *   getLock({force})             → data/lock.json config | null (site password; see lock.js)
 *   peekLock()                   → this device's last copy of data/lock.json, no network
 *                                  (undefined = never read here); lock.js opens the app on it
 *   revalidateAll()              → background-refresh every file read so far (app resume)
 *   warmRecipes()                → idle time: snapshot the recipes (+ journals) this device has
 *                                  no copy of yet, two at a time, so they open at once and offline
 *
 * CACHING  Each file is read from the network at most once per page load (concurrent reads
 *   share one request) and kept in memory. Reads are snapshot-first: a file this device has
 *   read before (localStorage `bb.cache:<path>`) resolves at once from that copy while the
 *   live file is fetched behind it; when the live copy differs, it replaces the snapshot and
 *   onChange fires { type: 'refresh', paths: [path] } so the open view repaints. A local
 *   write always wins over a background refresh that was already in flight. {force: true}
 *   waits for the network (offline → the snapshot). A failed read never overwrites a
 *   snapshot; a missing file (404) is a real answer and is stored as the fallback.
 *
 * WRITES (need a token → throw NotConnectedError otherwise). Each is one atomic commit.
 *   Library (optimistic + batched ~1.2s into one commit):
 *     setTags(slug, tags) setRating(slug, n|null) setProficiency(slug, n|null)
 *     setPinned(slug, bool) — pinnedAt timestamp on the entry; pinned recipes head the Recipes list
 *     createPlaylist(name)→id renamePlaylist(id,name) deletePlaylist(id)
 *     addToPlaylist(id, slug) removeFromPlaylist(id, slug)  flushLibrary()
 *   Recipes:  saveRecipe(recipe, { heroFile, isNew }) → slug      deleteRecipe(slug)
 *   Inbox:    uploadToInbox({ kind, title, url, text, hint, files }) → id    deletePending(id)
 *   Journal:  addNote(slug, { scope, stepId, stepText, text })
 *             addPhoto(slug, file, { text, scope, stepId, stepText, cookedOn })   cookedOn "YYYY-MM-DD"
 *               (default today): the cook log ("Cooked 3×") counts the days photos were cooked on
 *             deleteEntry(slug, entryId)
 *   Password: saveLock(config | null, { message })   set/replace data/lock.json, or delete it (no password)
 *
 * EVENTS   onChange(fn) — fn({ type, paths }) after any read refresh or write.
 */
import { GitHub, toJsonText } from './github.js';
import { getPrefs } from './prefs.js';
import { rawBase } from './config.js';
import { nowIso, localDay, uid, slugify, blobToBase64, compressImage, fileExt, debounce } from './util.js';

export class NotConnectedError extends Error {
  constructor() { super('Connect GitHub in Settings to save changes.'); this.name = 'NotConnectedError'; }
}

const P = {
  index: 'recipes/index.json',
  library: 'data/library.json',
  lock: 'data/lock.json',
  recipe: s => `recipes/${s}.json`,
  journal: s => `journal/${s}.json`,
  inboxItem: id => `inbox/${id}/item.json`
};
const EMPTY_INDEX = { recipes: [], pending: [] };
const EMPTY_LIB = { schemaVersion: 1, recipes: {}, playlists: [] };

/* ---------- cache + events ---------- */
const mem = new Map();        // path → parsed copy for this page load
const seen = new Map();       // path → JSON text of that copy (tells a real change from a re-read)
const fallbacks = new Map();  // path → what a missing file reads as
const writes = new Map();     // path → count of local writes; a refresh started before one is dropped
const inflight = new Map();   // path → the network read in progress (concurrent reads share it)
const subs = new Set();
export const onChange = fn => (subs.add(fn), () => subs.delete(fn));
const emit = ev => subs.forEach(fn => { try { fn(ev); } catch (e) { console.error(e); } });
const clone = o => (o == null ? o : JSON.parse(JSON.stringify(o)));
const SNAP = 'bb.cache:';
function fromSnap(path) { try { const s = localStorage.getItem(SNAP + path); return s ? JSON.parse(s) : undefined; } catch { return undefined; } }
/** Keep a copy read from the repo: memory + snapshot. */
function keep(path, data) {
  const text = JSON.stringify(data);
  mem.set(path, data); seen.set(path, text);
  try { localStorage.setItem(SNAP + path, text); } catch { /* quota */ }
}
/** This device changed the file (write, optimistic library edit, delete). */
function local(path, data) {
  writes.set(path, (writes.get(path) || 0) + 1);
  if (data === undefined) {
    mem.delete(path); seen.delete(path);
    try { localStorage.removeItem(SNAP + path); } catch { /* private mode */ }
  } else keep(path, data);
}

function client() { const p = getPrefs(); return p.token ? new GitHub(p) : null; }
function requireClient() { const c = client(); if (!c) throw new NotConnectedError(); return c; }

/** One network read of `path` → parsed JSON, or undefined when the file doesn't exist.
 *  Rejects when the repo can't be reached (offline, 5xx, broken JSON). */
function fetchLive(path) {
  if (inflight.has(path)) return inflight.get(path);
  const fromSite = async () => {
    const r = await fetch(`${path}?t=${Date.now()}`, { cache: 'no-store' });
    if (r.ok) return r.json();
    if (r.status === 404) return undefined;
    throw new Error(`${path}: HTTP ${r.status}`);
  };
  const p = (async () => {
    const c = client();
    if (!c) return fromSite();
    try { return (await c.readJson(path, null)) ?? undefined; }   // missing file → undefined
    catch (e) {                        // bad/expired token or API hiccup → public copy
      console.warn('GitHub read failed, using site copy', path, e);
      emit({ type: 'read-error', error: e, paths: [path] });
      return fromSite();
    }
  })().finally(() => inflight.delete(path));
  inflight.set(path, p);
  return p;
}

/** Background read: swap in the live copy and announce it, unless nothing changed. */
function revalidate(path) {
  const n = writes.get(path);
  fetchLive(path).then(data => {
    if (writes.get(path) !== n) return;                  // a local write is newer
    if (data === undefined) data = clone(fallbacks.get(path));
    if (JSON.stringify(data) === seen.get(path)) return;
    keep(path, data);
    emit({ type: 'refresh', paths: [path] });
  }, () => { /* offline: the snapshot stays */ });
}

async function load(path, fallback, { force = false } = {}) {
  if (!fallbacks.has(path)) fallbacks.set(path, clone(fallback));
  if (!force && mem.has(path)) return mem.get(path);
  if (!force) {
    const s = fromSnap(path);
    if (s !== undefined) {             // paint the last copy now; the live one follows
      mem.set(path, s); seen.set(path, JSON.stringify(s));
      revalidate(path);
      return s;
    }
  }
  const n = writes.get(path);
  try {
    let data = await fetchLive(path);
    if (writes.get(path) !== n && mem.has(path)) return mem.get(path);
    if (data === undefined) data = clone(fallback);
    keep(path, data);
    return data;
  } catch (e) {
    const s = fromSnap(path);          // offline → last known copy
    if (s === undefined) { console.warn('load failed', path, e); return clone(fallback); }
    mem.set(path, s); seen.set(path, JSON.stringify(s));
    return s;
  }
}

/** The app came back to the foreground: re-check every file already read (lock.js owns lock.json). */
export function revalidateAll() {
  for (const path of mem.keys()) if (path !== P.lock && !inflight.has(path)) revalidate(path);
}
export const peekLock = () => (mem.has(P.lock) ? mem.get(P.lock) : fromSnap(P.lock));

/* ---------- reads ---------- */
export async function getIndex({ force = false } = {}) {
  const idx = await load(P.index, EMPTY_INDEX, { force });
  idx.recipes ||= []; idx.pending ||= [];
  return idx;
}
export const getRecipe = (slug, opts) => load(P.recipe(slug), null, opts);
export const getJournal = async (slug, opts) => {
  const j = await load(P.journal(slug), { slug, entries: [] }, opts);
  j.entries ||= []; return j;
};
export const getPending = (id, opts) => load(P.inboxItem(id), null, opts);
export async function getLibrary(opts) { return normLib(await load(P.library, EMPTY_LIB, opts)); }
export const getLock = opts => load(P.lock, null, opts);

/** Idle-time warm-up: the index's recipes (and journals) this device has no copy of yet, two at
 *  a time, into the snapshot only (not memory, so revalidateAll stays small). A recipe opened
 *  later then paints at once (and offline) and is refreshed behind as usual. Stops at the first
 *  network failure or full storage. */
export async function warmRecipes({ parallel = 2 } = {}) {
  const idx = await getIndex();
  const has = p => { try { return mem.has(p) || localStorage.getItem(SNAP + p) != null; } catch { return true; } };
  const todo = idx.recipes.flatMap(r => [[P.recipe(r.slug), null], [P.journal(r.slug), { slug: r.slug, entries: [] }]])
    .filter(([p]) => !has(p));
  let stop = false;
  const worker = async () => {
    for (let job; !stop && (job = todo.shift());) {
      const [p, fallback] = job, n = writes.get(p);
      try {
        const data = await fetchLive(p);
        if (!has(p) && writes.get(p) === n) localStorage.setItem(SNAP + p, JSON.stringify(data === undefined ? fallback : data));
      } catch { stop = true; }
    }
  };
  await Promise.all(Array.from({ length: parallel }, worker));
}

function normLib(lib) {
  lib ||= clone(EMPTY_LIB);
  lib.schemaVersion ||= 1; lib.recipes ||= {}; lib.playlists ||= [];
  return lib;
}
export const blankEntry = () => ({ tags: [], rating: null, proficiency: null, addedAt: nowIso() });
export function entryFor(lib, slug) {
  const e = lib?.recipes?.[slug];
  return { ...blankEntry(), addedAt: null, pinnedAt: null, ...(e || {}), tags: [...(e?.tags || [])] };
}
export function allTags(lib) {
  const s = new Set();
  Object.values(lib?.recipes || {}).forEach(e => (e.tags || []).forEach(t => s.add(t)));
  return [...s].sort((a, b) => a.localeCompare(b));
}

export function mediaUrl(path) { return path ? path.replace(/^\/+/, '') : ''; }
export function rawUrl(path) { return path ? rawBase(getPrefs()) + path.replace(/^\/+/, '') : ''; }

/* ---------- generic write ---------- */
/**
 * builder({ read, readJson, json }) → files[]. Re-run automatically if the branch moved.
 * `json(path, obj)` returns a file entry and records obj so the cache updates on success.
 */
async function write(message, builder) {
  const c = requireClient();
  let files = [];
  await c.commit(message, async read => {
    const readJson = async (p, fb) => { const t = await read(p); if (t == null) return clone(fb); try { return JSON.parse(t); } catch { return clone(fb); } };
    const json = (path, obj) => ({ path, text: toJsonText(obj), obj });
    files = await builder({ read, readJson, json });
    return files;
  });
  for (const f of files) {
    if (f.delete) local(f.path, undefined);
    else if (f.obj !== undefined) local(f.path, f.obj);
  }
  emit({ type: 'write', message, paths: files.map(f => f.path) });
}

/* ---------- site password (lock.js builds the config) ---------- */
export async function saveLock(config, { message } = {}) {
  await write(message || (config ? 'Set site password' : 'Remove site password'), async ({ read, json }) => {
    if (config) return [json(P.lock, config)];
    return (await read(P.lock)) != null ? [{ path: P.lock, delete: true }] : [];
  });
  if (!config) local(P.lock, null);
}

/* ---------- index helpers (mirror scripts/build_index.py) ---------- */
export function summarize(r, openNotes = 0) {
  return {
    slug: r.slug, title: r.title, summary: r.summary || '', image: r.image || null,
    time: r.time || {}, servings: r.servings ?? null, status: r.status || 'built',
    sourceType: r.source?.type || 'custom', updatedAt: r.updatedAt || r.createdAt || null, openNotes
  };
}
function upsertIndex(idx, summary) {
  idx.recipes = (idx.recipes || []).filter(x => x.slug !== summary.slug);
  idx.recipes.push(summary);
  idx.recipes.sort((a, b) => a.title.localeCompare(b.title));
  return idx;
}
const countOpen = j => (j?.entries || []).filter(e => e.status === 'open').length;

/* ---------- library (optimistic, batched) ---------- */
let queue = [];
const flushSoon = debounce(() => flushLibrary().catch(err => emit({ type: 'error', error: err })), 1200);

function mutateLibrary(label, fn) {
  requireClient();
  const lib = normLib(mem.get(P.library) || clone(EMPTY_LIB));
  fn(lib);                                   // optimistic local apply
  local(P.library, lib);
  emit({ type: 'library', paths: [P.library] });
  queue.push({ label, fn });
  flushSoon();
}

export async function flushLibrary() {
  if (!queue.length) return;
  const batch = queue; queue = [];
  const labels = [...new Set(batch.map(b => b.label))];
  try {
    await write(`Library: ${labels.slice(0, 4).join('; ')}${labels.length > 4 ? '…' : ''}`, async ({ readJson, json }) => {
      const lib = normLib(await readJson(P.library, EMPTY_LIB));
      batch.forEach(b => b.fn(lib));
      return [json(P.library, lib)];
    });
    // Edits queued while this commit was in flight: keep them visible locally.
    if (queue.length) {
      const lib = normLib(mem.get(P.library));
      queue.forEach(q => q.fn(lib));
      local(P.library, lib);
      emit({ type: 'library', paths: [P.library] });
    }
  } catch (e) {
    await load(P.library, EMPTY_LIB, { force: true }).catch(() => {});
    emit({ type: 'library', paths: [P.library] });
    throw e;
  }
}
// Don't lose a pending batch when the phone locks or the tab closes.
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushSoon.flush(); });
}

const ensure = (lib, slug) => (lib.recipes[slug] ||= blankEntry());
const name = s => s.replace(/-/g, ' ');
export const setTags = (slug, tags) => mutateLibrary(`tags ${name(slug)}`, lib => {
  ensure(lib, slug).tags = [...new Set(tags.map(t => t.trim().toLowerCase()).filter(Boolean))];
});
export const setRating = (slug, n) => mutateLibrary(`rate ${name(slug)} ${n ?? '-'}/10`, lib => { ensure(lib, slug).rating = n == null ? null : Math.max(1, Math.min(10, Math.round(n))); });
export const setProficiency = (slug, n) => mutateLibrary(`proficiency ${name(slug)} ${n ?? '-'}/5`, lib => { ensure(lib, slug).proficiency = n == null ? null : Math.max(1, Math.min(5, Math.round(n))); });
export const setPinned = (slug, on) => mutateLibrary(`${on ? 'pin' : 'unpin'} ${name(slug)}`, lib => {
  const e = ensure(lib, slug);
  if (on) e.pinnedAt ||= nowIso(); else delete e.pinnedAt;
});
export function createPlaylist(plName) {
  const id = 'pl-' + Math.random().toString(36).slice(2, 6);
  const at = nowIso();
  mutateLibrary(`new playlist ${plName}`, lib => { if (!lib.playlists.some(p => p.id === id)) lib.playlists.push({ id, name: plName, recipes: [], createdAt: at }); });
  return id;
}
const withPl = (id, fn) => lib => { const p = lib.playlists.find(x => x.id === id); if (p) fn(p, lib); };
export const renamePlaylist = (id, n) => mutateLibrary(`rename playlist ${n}`, withPl(id, p => { p.name = n; }));
export const deletePlaylist = id => mutateLibrary('delete playlist', lib => { lib.playlists = lib.playlists.filter(p => p.id !== id); });
export const addToPlaylist = (id, slug) => mutateLibrary(`add ${name(slug)} to playlist`, withPl(id, p => { if (!p.recipes.includes(slug)) p.recipes.push(slug); }));
export const removeFromPlaylist = (id, slug) => mutateLibrary(`remove ${name(slug)} from playlist`, withPl(id, p => { p.recipes = p.recipes.filter(s => s !== slug); }));

/* ---------- recipes ---------- */
async function uniqueSlug(base) {
  const idx = await getIndex({ force: true });
  const taken = new Set([...idx.recipes.map(r => r.slug)]);
  let s = base, n = 2;
  while (taken.has(s)) s = `${base}-${n++}`;
  return s;
}

/**
 * Create or update a recipe. For new recipes the slug comes from the title.
 * heroFile (optional File) is compressed and stored at media/<slug>/hero.jpg.
 */
export async function saveRecipe(recipe, { heroFile = null, isNew = false } = {}) {
  requireClient();
  const r = clone(recipe);
  if (isNew || !r.slug) { r.slug = await uniqueSlug(slugify(r.title)); r.createdAt = nowIso(); r.status ||= 'custom'; }
  r.schemaVersion = 1; r.updatedAt = nowIso(); r.changelog ||= [];
  let heroB64 = null, oldHero = null;
  if (heroFile) {
    const blob = await compressImage(heroFile);
    heroB64 = await blobToBase64(blob);
    // compressImage returns the original when it can't help (HEIC, tiny PNG) — keep its extension.
    const ext = blob === heroFile ? (fileExt(heroFile.name) || 'jpg') : 'jpg';
    // Unique name per upload so phones/CDN never show a cached old photo.
    if (r.image && r.image.startsWith(`media/${r.slug}/`)) oldHero = r.image;
    r.image = `media/${r.slug}/hero-${Date.now().toString(36)}.${ext}`;
  }
  await write(`${isNew ? 'Add custom recipe' : 'Edit recipe'}: ${r.title}`, async ({ read, readJson, json }) => {
    const files = [json(P.recipe(r.slug), r)];
    if (heroB64) files.push({ path: r.image, base64: heroB64 });
    if (oldHero && oldHero !== r.image && await read(oldHero) != null) files.push({ path: oldHero, delete: true });
    const lib = normLib(await readJson(P.library, EMPTY_LIB));
    if (!lib.recipes[r.slug]) { lib.recipes[r.slug] = blankEntry(); files.push(json(P.library, lib)); }
    const j = await readJson(P.journal(r.slug), null);
    const idx = await readJson(P.index, EMPTY_INDEX);
    files.push(json(P.index, upsertIndex(idx, summarize(r, countOpen(j)))));
    return files;
  });
  return r.slug;
}

export async function deleteRecipe(slug) {
  const c = requireClient();
  const media = [...await c.list(`media/${slug}`), ...await c.list(`media/${slug}/journal`)].filter(f => f.type === 'file');
  await write(`Delete recipe: ${name(slug)}`, async ({ read, readJson, json }) => {
    const files = [{ path: P.recipe(slug), delete: true }, ...media.map(f => ({ path: f.path, delete: true }))];
    if (await read(P.journal(slug)) != null) files.push({ path: P.journal(slug), delete: true });
    const idx = await readJson(P.index, EMPTY_INDEX);
    idx.recipes = idx.recipes.filter(x => x.slug !== slug);
    files.push(json(P.index, idx));
    const lib = normLib(await readJson(P.library, EMPTY_LIB));
    delete lib.recipes[slug];
    lib.playlists.forEach(p => { p.recipes = p.recipes.filter(s => s !== slug); });
    files.push(json(P.library, lib));
    return files;
  });
}

/* ---------- inbox ---------- */
const safeName = n => String(n || 'file').normalize('NFKD').replace(/[^\w.-]+/g, '-').replace(/-+/g, '-').slice(-80);

/** Store a raw upload for the next "update the site" run. files: File[] */
export async function uploadToInbox({ kind = 'file', title = '', url = null, text = null, hint = null, files = [] }) {
  requireClient();
  const id = uid();
  const uploads = [];
  for (const f of files) {
    const blob = /^image\//.test(f.type) ? await compressImage(f, { max: 2400, quality: 0.88 }) : f;
    let nm = safeName(f.name);
    if (blob !== f) nm = nm.replace(/\.[^.]+$/, '') + '.jpg';
    uploads.push({ path: `inbox/${id}/${nm}`, base64: await blobToBase64(blob) });
  }
  const item = { id, kind, title: title || '', url: url || null, files: uploads.map(u => u.path), text: text || null, hint: hint || null, createdAt: nowIso() };
  const label = title || url || files[0]?.name || 'pasted text';
  await write(`Upload to inbox: ${label}`, async ({ readJson, json }) => {
    const idx = await readJson(P.index, EMPTY_INDEX);
    idx.pending = (idx.pending || []).filter(p => p.id !== id);
    idx.pending.push({ id, kind, title: item.title || label, url: item.url, createdAt: item.createdAt });
    return [...uploads, json(P.inboxItem(id), item), json(P.index, idx)];
  });
  return id;
}

export async function deletePending(id) {
  const c = requireClient();
  const files = (await c.list(`inbox/${id}`)).filter(f => f.type === 'file');
  await write(`Remove inbox item ${id}`, async ({ readJson, json }) => {
    const idx = await readJson(P.index, EMPTY_INDEX);
    idx.pending = (idx.pending || []).filter(p => p.id !== id);
    return [...files.map(f => ({ path: f.path, delete: true })), json(P.index, idx)];
  });
}

/* ---------- journal ---------- */
async function writeJournal(slug, message, mutate, extraFiles = []) {
  await write(message, async ({ readJson, json }) => {
    const j = await readJson(P.journal(slug), { slug, entries: [] });
    j.slug = slug; j.entries ||= [];
    mutate(j);
    const files = [...extraFiles, json(P.journal(slug), j)];
    const idx = await readJson(P.index, EMPTY_INDEX);
    const row = idx.recipes?.find(x => x.slug === slug);
    if (row) { row.openNotes = countOpen(j); files.push(json(P.index, idx)); }
    return files;
  });
}

const entryBase = ({ scope = 'recipe', stepId = null, stepText = null, text = '' }) => ({
  scope: stepId ? 'step' : scope, stepId: stepId || null, stepText: stepId ? (stepText || null) : null,
  text: String(text || '').trim(), createdAt: nowIso(), status: 'open', resolution: null, resolvedAt: null
});

export async function addNote(slug, opts) {
  requireClient();
  const e = { id: uid('n'), kind: 'note', ...entryBase(opts), photo: null };
  if (!e.text) throw new Error('Note is empty.');
  const where = e.stepId ? ` (step ${e.stepId})` : '';
  await writeJournal(slug, `Note on ${name(slug)}${where}`, j => j.entries.push(e));
  return e;
}

export async function addPhoto(slug, file, opts = {}) {
  requireClient();
  const id = uid('p');
  const blob = await compressImage(file);
  const ext = blob === file ? (fileExt(file.name) || 'jpg') : 'jpg';
  const path = `media/${slug}/journal/${id}.${ext}`;
  const cookedOn = /^\d{4}-\d{2}-\d{2}$/.test(opts.cookedOn || '') ? opts.cookedOn : localDay();
  const e = { id, kind: 'photo', ...entryBase(opts), photo: path, cookedOn };
  await writeJournal(slug, `Photo on ${name(slug)}`, j => j.entries.push(e), [{ path, base64: await blobToBase64(blob) }]);
  return e;
}

// Removes exactly one entry (and its photo); every other entry is written back untouched.
export async function deleteEntry(slug, entryId) {
  requireClient();
  if (!entryId) throw new Error('No journal entry to delete.');
  const j = await getJournal(slug);
  const photo = j.entries.find(e => e.id === entryId)?.photo;
  await writeJournal(slug, `Delete journal entry on ${name(slug)}`, jj => { jj.entries = jj.entries.filter(e => e.id !== entryId); },
    photo ? [{ path: photo, delete: true }] : []);
}
