/**
 * views/library.js — recipe list (#/) and playlist view (#/playlist/<id>) (WS1).
 *
 * Search / filter / sort state lives in the hash query and is kept in sync with
 * history.replaceState (no hashchange → no re-route), so Back restores it:
 *   #/?q=chicken&tag=weeknight,quick&untagged=1&rating=unrated,8-10&prof=none,3
 *      &pl=pl-k3x9&src=pdf,web&needs=1&sort=rating
 * Values within a category OR together; categories AND together. Blank values are
 * categories of their own (Unrated, Not set, Untagged).
 * Sort defaults to "recent" (omitted from the query). Inside a playlist an extra
 * "playlist" sort (the playlist's own recipe order) is offered and is the default;
 * elsewhere sort=playlist is ignored and falls back to "recent".
 *
 * Also exports helpers shared with playlists.js:
 *   ICON, thumb(summary, cls), guardImages(el) → off, connectHint(), plural(n, word), relTime(iso)
 *   askNewPlaylist() → id|null   askRenamePlaylist(pl) → bool   askDeletePlaylist(pl, onDeleting) → bool
 */
import { html, raw, fmtMinutes } from '../util.js';
import {
  getIndex, getLibrary, entryFor, mediaUrl, rawUrl, onChange, NotConnectedError,
  createPlaylist, renamePlaylist, deletePlaylist, addToPlaylist, removeFromPlaylist
} from '../store.js';
import { setTopbar, on, stars, sheet, promptSheet, confirmSheet, toast, reportError } from '../ui.js';
import { isConnected } from '../prefs.js';
import { PROFICIENCY, profLabel, editMeta } from '../components/meta-editor.js';

/* ---------- shared display helpers ---------- */
const svg = d => `<svg viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
export const ICON = {
  search: svg('<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/>'),
  filter: svg('<path d="M4 7h9M19 7h1M4 17h3M13 17h7"/><circle cx="16" cy="7" r="2.5"/><circle cx="10" cy="17" r="2.5"/>'),
  x: svg('<path d="M7 7l10 10M17 7L7 17"/>'),
  more: svg('<circle cx="5.5" cy="12" r="1.6" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none"/><circle cx="18.5" cy="12" r="1.6" fill="currentColor" stroke="none"/>'),
  clock: svg('<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  minus: svg('<circle cx="12" cy="12" r="8.5"/><path d="M8.5 12h7"/>'),
  pencil: svg('<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>'),
  trash: svg('<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>'),
  chevron: svg('<path d="M7 10l5 5 5-5"/>'),
  check: svg('<path d="M5 12.5l4.5 4.5L19 7.5"/>'),
  file: svg('<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>'),
  link: svg('<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>'),
  text: svg('<path d="M5 6h14M5 10h14M5 14h10M5 18h7"/>'),
  note: svg('<path d="M5 5h14v10H10l-4 4v-4H5z"/>'),
  book: svg('<path d="M12 6.5C10 5 7.5 4.5 4 4.5v13c3.5 0 6 .5 8 2 2-1.5 4.5-2 8-2v-13c-3.5 0-6 .5-8 2z"/><path d="M12 6.5v13"/>'),
  playlist: svg('<path d="M4 6h11M4 11h11M4 16h7"/><circle cx="18" cy="16" r="2.5"/><path d="M20.5 16V5"/>')
};

const TONES = 4;
function toneOf(s = '') { let h = 7; for (const ch of s) h = (h * 31 + ch.codePointAt(0)) >>> 0; return h % TONES; }
const initial = t => (String(t || '').match(/[\p{L}\p{N}]/u)?.[0] || '·').toUpperCase();

/** Recipe image, or a warm generated tile (initial letter on a token-colored ground). */
export function thumb(r, cls = '') {
  return html`<span class="thumb tone-${toneOf(r.slug)} ${cls}" aria-hidden="true"><span class="thumb-letter">${initial(r.title)}</span>${r.image
    ? html`<img src="${mediaUrl(r.image)}" data-fallback="${rawUrl(r.image)}" alt="" loading="lazy" decoding="async">` : ''}</span>`;
}

/** Hide thumbnails whose Pages URL *and* raw fallback both failed (letter tile shows instead). */
export function guardImages(el) {
  const h = e => {
    const img = e.target;
    if (img.tagName !== 'IMG' || !img.closest('.thumb')) return;
    img.dataset.errs = (+img.dataset.errs || 0) + 1;      // app.js swaps to the fallback on the 1st error
    if (+img.dataset.errs >= 2) img.hidden = true;
  };
  el.addEventListener('error', h, true);
  return () => el.removeEventListener('error', h, true);
}

export const connectHint = () => (isConnected() ? '' : html`<p class="connect-hint">Connect GitHub to save ratings &amp; playlists → <a href="#/settings">Settings</a></p>`);
export const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/* ---------- playlist flows (shared with playlists.js) ---------- */
const cleanName = n => (n || '').trim().replace(/\s+/g, ' ').slice(0, 60);
/** Fail fast before asking for input the store can't save. */
function connected() {
  if (isConnected()) return true;
  reportError(new NotConnectedError());
  return false;
}
/** → new playlist id, or null */
export async function askNewPlaylist() {
  if (!connected()) return null;
  const name = cleanName(await promptSheet('New playlist', { placeholder: 'e.g. Weeknight dinners', ok: 'Create' }));
  if (!name) return null;
  try { return createPlaylist(name); } catch (e) { reportError(e); return null; }
}
export async function askRenamePlaylist(pl) {
  if (!connected()) return false;
  const name = cleanName(await promptSheet('Rename playlist', { value: pl.name, placeholder: 'Playlist name', ok: 'Rename' }));
  if (!name || name === pl.name) return false;
  try { renamePlaylist(pl.id, name); return true; } catch (e) { reportError(e); return false; }
}
/** onDeleting() runs just before the delete so callers can stop re-rendering a vanishing playlist. */
export async function askDeletePlaylist(pl, onDeleting) {
  if (!connected()) return false;
  const ok = await confirmSheet(`“${pl.name}” will be removed. The recipes in it stay in your library.`,
    { title: 'Delete playlist?', ok: 'Delete', danger: true });
  if (!ok) return false;
  try { onDeleting?.(); deletePlaylist(pl.id); toast(`Deleted “${pl.name}”`); return true; }
  catch (e) { reportError(e); return false; }
}

export function relTime(iso) {
  const t = Date.parse(iso);
  if (!t) return '';
  const days = Math.floor((Date.now() - t) / 864e5);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
const hostOf = u => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };

/* ---------- state <-> hash query ---------- */
const SORTS = { recent: 'Recently added', title: 'Title A–Z', rating: 'Rating', prof: 'Proficiency', time: 'Total time' };
const PL_SORTS = { playlist: 'Playlist order', ...SORTS };   // only inside #/playlist/<id>
const sortsFor = inPl => (inPl ? PL_SORTS : SORTS);
const defaultSort = inPl => (inPl ? 'playlist' : 'recent');
const RATINGS = {
  unrated: ['Unrated', r => r == null], '1-4': ['1–4', r => r >= 1 && r <= 4],
  '5-7': ['5–7', r => r >= 5 && r <= 7], '8-10': ['8–10', r => r >= 8]
};
const PROFS = { none: 'Not set', ...Object.fromEntries(PROFICIENCY.map((l, i) => [String(i + 1), `${i + 1} · ${l}`])) };
const PROF_KEYS = ['none', '1', '2', '3', '4', '5'];   // explicit: integer-like keys would sort first
const SOURCES = { custom: 'Custom', pdf: 'PDF', youtube: 'YouTube', instagram: 'Instagram', tiktok: 'TikTok', web: 'Web', image: 'Image', text: 'Text' };
const LIST_KEYS = ['tag', 'rating', 'prof', 'pl', 'src'];
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const filterCount = s => LIST_KEYS.reduce((n, k) => n + s[k].length, 0) + s.untagged + s.needs;

function queryOf(params) {
  // Read the raw hash: app.js decodes the whole hash before splitting, which mangles "%26".
  const i = location.hash.indexOf('?');
  return i >= 0 ? new URLSearchParams(location.hash.slice(i + 1)) : (params.query || new URLSearchParams());
}

function readState(params) {
  const q = queryOf(params);
  const list = (k, ok = () => true) =>
    [...new Set(q.getAll(k).flatMap(v => v.split(',')).map(v => v.trim()).filter(v => v && ok(v)))];
  const sort = q.get('sort');
  const inPl = !!params.playlist;
  return {
    q: q.get('q') || '',
    tag: list('tag').map(t => t.toLowerCase()),
    untagged: q.get('untagged') === '1',
    rating: list('rating', v => has(RATINGS, v)),
    prof: list('prof', v => has(PROFS, v)),
    pl: list('pl'),
    src: list('src', v => has(SOURCES, v)),
    needs: q.get('needs') === '1',
    sort: has(sortsFor(inPl), sort) ? sort : defaultSort(inPl)
  };
}

function toQuery(s, defSort) {
  const enc = v => encodeURIComponent(v);
  const parts = [];
  if (s.q.trim()) parts.push('q=' + enc(s.q.trim()));
  for (const k of LIST_KEYS) if (s[k].length) parts.push(`${k}=${s[k].map(enc).join(',')}`);
  if (s.untagged) parts.push('untagged=1');
  if (s.needs) parts.push('needs=1');
  if (s.sort !== defSort) parts.push('sort=' + s.sort);
  return parts.join('&');
}

function toggle(s, k, v) {
  if (k === 'untagged' || k === 'needs') s[k] = !s[k];
  else if (LIST_KEYS.includes(k)) s[k] = s[k].includes(v) ? s[k].filter(x => x !== v) : [...s[k], v];
}
function clearFilters(s) {
  LIST_KEYS.forEach(k => { s[k] = []; });
  s.untagged = false; s.needs = false;
}

/* ---------- derive / match / sort ---------- */
const fold = t => String(t || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '');
const totalTime = r => {
  const t = r.time || {};
  if (t.total != null) return t.total;
  return t.prep != null || t.cook != null ? (t.prep || 0) + (t.cook || 0) : null;
};
const byTitle = (a, b) => a.r.title.localeCompare(b.r.title, undefined, { sensitivity: 'base', numeric: true });
const nullsLast = (x, y, dir) => (x == null ? (y == null ? 0 : 1) : y == null ? -1 : dir * (x - y));
const SORT_FNS = {
  recent: (a, b) => b.ts - a.ts || byTitle(a, b),
  title: byTitle,
  rating: (a, b) => nullsLast(a.e.rating, b.e.rating, -1) || byTitle(a, b),
  prof: (a, b) => nullsLast(a.e.proficiency, b.e.proficiency, -1) || byTitle(a, b),
  time: (a, b) => nullsLast(a.t, b.t, 1) || byTitle(a, b),
  playlist: (a, b) => nullsLast(a.pos, b.pos, 1) || byTitle(a, b)
};

/** pos: index in the viewed playlist's recipe list (null outside a playlist). */
function toRow(r, lib, pos = null) {
  const e = entryFor(lib, r.slug);
  return {
    r, e, t: totalTime(r), pos,
    ts: Math.max(Date.parse(r.updatedAt) || 0, Date.parse(e.addedAt) || 0),
    hay: fold(`${r.title} ${r.summary || ''} ${e.tags.join(' ')}`)
  };
}

/** plSets: { [playlistId]: Set<slug> } */
function matches(x, s, plSets) {
  const { r, e } = x;
  if (s.q.trim() && !fold(s.q).split(/\s+/).filter(Boolean).every(t => x.hay.includes(t))) return false;
  if ((s.tag.length || s.untagged) && !((s.untagged && !e.tags.length) || e.tags.some(t => s.tag.includes(t)))) return false;
  if (s.rating.length && !s.rating.some(k => RATINGS[k][1](e.rating))) return false;
  if (s.prof.length && !s.prof.some(k => (k === 'none' ? e.proficiency == null : e.proficiency === +k))) return false;
  if (s.pl.length && !s.pl.some(id => plSets[id]?.has(r.slug))) return false;
  if (s.src.length && !s.src.includes(r.sourceType || 'custom')) return false;
  if (s.needs && r.status !== 'custom') return false;
  return true;
}

/** Active filters as removable chips: [{ k, v, label }] */
function activeFilters(s, lib) {
  const out = [];
  s.tag.forEach(v => out.push({ k: 'tag', v, label: v }));
  if (s.untagged) out.push({ k: 'untagged', label: 'Untagged' });
  s.rating.forEach(v => out.push({ k: 'rating', v, label: v === 'unrated' ? 'Unrated' : `Rated ${RATINGS[v][0]}` }));
  s.prof.forEach(v => out.push({ k: 'prof', v, label: v === 'none' ? 'Proficiency not set' : `Proficiency ${v}` }));
  s.pl.forEach(v => out.push({ k: 'pl', v, label: lib.playlists.find(p => p.id === v)?.name || 'Playlist' }));
  s.src.forEach(v => out.push({ k: 'src', v, label: SOURCES[v] }));
  if (s.needs) out.push({ k: 'needs', label: 'Needs enrichment' });
  return out;
}

/** Facet counts over the current scope (ignores other filters) — feeds chips + the sheet. */
function facets(rows, plSets) {
  const f = { tag: new Map(), untagged: 0, rating: {}, prof: {}, src: {}, pl: {}, needs: 0 };
  for (const id in plSets) f.pl[id] = rows.filter(x => plSets[id].has(x.r.slug)).length;
  for (const { r, e } of rows) {
    e.tags.forEach(t => f.tag.set(t, (f.tag.get(t) || 0) + 1));
    if (!e.tags.length) f.untagged++;
    for (const k in RATINGS) if (RATINGS[k][1](e.rating)) f.rating[k] = (f.rating[k] || 0) + 1;
    const pk = e.proficiency == null ? 'none' : String(e.proficiency);
    f.prof[pk] = (f.prof[pk] || 0) + 1;
    const sk = r.sourceType || 'custom';
    f.src[sk] = (f.src[sk] || 0) + 1;
    if (r.status === 'custom') f.needs++;
  }
  return f;
}

/* ---------- markup ---------- */
function card({ r, e, t }, pl) {
  const tags = e.tags.slice(0, 3);
  const flags = r.status === 'custom' || r.openNotes > 0;
  return html`<li class="rcard" data-slug="${r.slug}" data-title="${r.title}">
    <a class="rcard-link" href="#/r/${r.slug}">
      ${thumb(r, 'rcard-thumb')}
      <span class="rcard-body">
        <span class="rcard-title">${r.title}</span>
        ${r.summary ? html`<span class="rcard-sum">${r.summary}</span>` : ''}
        <span class="rcard-meta">
          ${t ? html`<span class="rm-time">${raw(ICON.clock)}${fmtMinutes(t)}</span>` : ''}
          ${e.rating ? html`<span class="rm-rating">${e.rating}/10</span>` : html`<span class="rm-rating is-blank">Unrated</span>`}
          ${e.proficiency ? html`<span class="rm-prof">${raw(stars(e.proficiency, 5))}<span class="rm-prof-l">${profLabel(e.proficiency)}</span></span>` : ''}
        </span>
        ${tags.length || flags ? html`<span class="rcard-tags">
          ${r.status === 'custom' ? html`<span class="flag flag-build">Needs build</span>` : ''}
          ${r.openNotes > 0 ? html`<span class="flag flag-notes">${raw(ICON.note)}${plural(r.openNotes, 'open note')}</span>` : ''}
          ${tags.map(tg => html`<span class="chip chip-tag">${tg}</span>`)}
        </span>` : ''}
      </span>
    </a>
    <button type="button" class="icon-btn rcard-more" data-act="more" aria-label="Rating, tags &amp; playlists for ${r.title}">${raw(ICON.more)}</button>
    ${pl ? html`<button type="button" class="icon-btn rcard-remove" data-act="unlist" aria-label="Remove ${r.title} from ${pl.name}" title="Remove from playlist">${raw(ICON.minus)}</button>` : ''}
  </li>`;
}

function playlistHead(count) {
  return html`<div class="pl-head">
    ${count ? html`<button type="button" class="btn btn-soft" data-act="pl-add">${raw(ICON.plus)}Add recipes</button>` : ''}
    <span class="spacer"></span>
    <button type="button" class="icon-btn" data-act="pl-rename" aria-label="Rename playlist" title="Rename">${raw(ICON.pencil)}</button>
    <button type="button" class="icon-btn" data-act="pl-delete" aria-label="Delete playlist" title="Delete">${raw(ICON.trash)}</button>
  </div>`;
}

const emptyPlaylist = pl => html`<div class="empty lib-empty">
  <span class="lib-empty-art">${raw(ICON.playlist)}</span>
  <h2>Nothing in “${pl.name}” yet</h2>
  <p>Pick recipes from your library to keep them together here.</p>
  <button type="button" class="btn btn-primary" data-act="pl-add">${raw(ICON.plus)}Add recipes</button>
</div>`;

const missingPlaylist = () => html`<div class="empty lib-empty">
  <span class="lib-empty-art">${raw(ICON.playlist)}</span>
  <h2>Playlist not found</h2>
  <p>It may have been deleted on another device.</p>
  <a class="btn" href="#/playlists">All playlists</a>
</div>`;

/** Horizontal quick row: active filters (removable) first, then one-tap suggestions. */
function quickChips(s, lib, f) {
  const active = activeFilters(s, lib);
  const topTags = [...f.tag].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([t]) => t).filter(t => !s.tag.includes(t)).slice(0, 8);
  const sugg = [
    ...topTags.map(t => ({ k: 'tag', v: t, label: t })),
    f.rating['8-10'] && !s.rating.includes('8-10') && { k: 'rating', v: '8-10', label: 'Rated 8–10' },
    f.rating.unrated && !s.rating.includes('unrated') && { k: 'rating', v: 'unrated', label: 'Unrated', blank: true },
    f.untagged && !s.untagged && { k: 'untagged', label: 'Untagged', blank: true },
    f.needs && !s.needs && { k: 'needs', label: 'Needs enrichment' }
  ].filter(Boolean);
  if (!active.length && !sugg.length) return '';
  return html`${active.map(a => html`<button type="button" class="chip on qchip" data-act="rm" data-k="${a.k}" data-v="${a.v ?? ''}" aria-label="Remove filter: ${a.label}">${a.label}${raw(ICON.x)}</button>`)}${
    active.length ? html`<button type="button" class="qchip-clear" data-act="clear-filters">Clear all</button>` : ''}${
    active.length && sugg.length ? html`<span class="qchips-sep" aria-hidden="true"></span>` : ''}${
    sugg.map(c => html`<button type="button" class="chip qchip${c.blank ? ' is-blank' : ''}" data-act="add" data-k="${c.k}" data-v="${c.v ?? ''}">${c.label}</button>`)}`;
}

function filterBody(s, lib, f) {
  const chip = (k, v, label, n, blank) => {
    const on = k === 'untagged' || k === 'needs' ? s[k] : s[k].includes(v);
    return html`<button type="button" class="chip fchip${blank ? ' is-blank' : ''}${!n && !on ? ' is-zero' : ''}" data-f="${k}" data-v="${v}" aria-pressed="${on}">${label}<span class="fcount">${n || 0}</span></button>`;
  };
  const group = (title, chips, hint) => html`<fieldset class="fgroup">
    <legend class="label">${title}</legend>${hint ? html`<p class="hint fgroup-hint">${hint}</p>` : ''}
    <div class="chips">${chips}</div>
  </fieldset>`;
  const tags = [...f.tag.keys()].sort((a, b) => a.localeCompare(b));
  s.tag.forEach(t => { if (!f.tag.has(t)) tags.push(t); });   // selected via URL but unused here
  return html`
    ${group('Tags', [...tags.map(t => chip('tag', t, t, f.tag.get(t))), chip('untagged', '', 'Untagged', f.untagged, true)],
      tags.length ? 'Shows recipes with any selected tag.' : 'No tags yet — add them from a recipe’s ⋯ menu.')}
    ${group('Rating', Object.entries(RATINGS).map(([k, [l]]) => chip('rating', k, l, f.rating[k], k === 'unrated')))}
    ${group('Proficiency', PROF_KEYS.map(k => chip('prof', k, PROFS[k], f.prof[k], k === 'none')))}
    ${lib.playlists.length ? group('Playlist', lib.playlists.map(p => chip('pl', p.id, p.name, f.pl[p.id]))) : ''}
    ${group('Source', Object.entries(SOURCES).map(([k, l]) => chip('src', k, l, f.src[k])))}
    ${group('Status', chip('needs', '', 'Needs enrichment', f.needs), 'Custom recipes you typed in that Claude hasn’t polished yet.')}`;
}

const KIND = { file: ['File', ICON.file], link: ['Link', ICON.link], text: ['Text', ICON.text] };
function pendingStrip(items) {
  const list = [...items].sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  return html`<section class="pending" aria-labelledby="pending-h">
    <div class="pending-head">
      <h2 class="pending-title" id="pending-h">Waiting to be built <span class="pending-n">${list.length}</span></h2>
      <p class="pending-hint">Tell Claude “update the site” to turn ${list.length === 1 ? 'it' : 'these'} into ${list.length === 1 ? 'a recipe' : 'recipes'}.</p>
    </div>
    <ul class="pending-list">${list.map(p => {
      const [label, icon] = KIND[p.kind] || KIND.file;
      const host = hostOf(p.url);
      return html`<li><a class="ptile" href="#/pending/${p.id}">
        <span class="ptile-icon">${raw(icon)}</span>
        <span class="ptile-title">${p.title || host || 'Untitled upload'}</span>
        <span class="ptile-meta">${[label, p.title && host, relTime(p.createdAt)].filter(Boolean).join(' · ')}</span>
      </a></li>`;
    })}</ul>
  </section>`;
}

function emptyLibrary(hasPending) {
  return html`<div class="empty lib-empty">
    <span class="lib-empty-art">${raw(ICON.book)}</span>
    <h2>${hasPending ? 'Your first recipes are on the way' : 'Your recipe vault is empty'}</h2>
    <p>${hasPending
      ? 'Uploads above become recipes after the next “update the site”. Meanwhile, add another.'
      : 'Type in a family favorite, or upload a PDF, photo or link and Claude will build it into a recipe.'}</p>
    <a class="btn btn-primary" href="#/add">${raw(ICON.plus)}Add a recipe</a>
  </div>`;
}

/* ---------- view ---------- */
export async function render(root, params) {
  const s = readState(params);
  const pathOf = h => (h || '#/').split('?')[0];
  const myPath = pathOf(location.hash);
  const savedY = history.state?.libScroll || 0;     // set below while scrolling; survives Back
  const plId = params.playlist || null;
  let idx, lib, pl = null, rows = [], plSets = {}, alive = true, leaving = false, shownTitle = '';

  const topbar = () => {
    const title = plId ? pl?.name || 'Playlist' : 'Recipes';
    if (title !== shownTitle) setTopbar(plId ? { title, back: '#/playlists' } : { title });
    shownTitle = title;
  };
  topbar();

  async function load() {
    [idx, lib] = await Promise.all([getIndex(), getLibrary()]);
    plSets = Object.fromEntries(lib.playlists.map(p => [p.id, new Set(p.recipes)]));
    pl = plId ? lib.playlists.find(p => p.id === plId) || null : null;
    const order = new Map((pl?.recipes || []).map((slug, i) => [slug, i]));
    const scope = plId ? idx.recipes.filter(r => order.has(r.slug)) : idx.recipes;
    rows = scope.map(r => toRow(r, lib, order.get(r.slug) ?? null));
    s.pl = s.pl.filter(id => plSets[id]);            // drop filters for deleted playlists
  }
  const shownRows = () => rows.filter(x => matches(x, s, plSets)).sort(SORT_FNS[s.sort]);
  await load();
  if (pathOf(location.hash) !== myPath) return;   // navigated away while loading

  root.innerHTML = html`<div class="lib">
    <div class="lib-bar" role="search" data-part="bar">
      <div class="search">
        ${raw(ICON.search)}
        <input class="input search-input" type="search" value="${s.q}" placeholder="${plId ? 'Search this playlist' : 'Search recipes'}"
          aria-label="Search recipes" autocomplete="off" autocapitalize="none" spellcheck="false" enterkeyhint="search">
        <button type="button" class="search-clear" data-act="clear-q" aria-label="Clear search" ${s.q ? '' : raw('hidden')}>${raw(ICON.x)}</button>
      </div>
      <button type="button" class="btn filter-btn" data-act="filters" aria-haspopup="dialog">
        ${raw(ICON.filter)}<span>Filters</span><span class="badge" data-part="nf" hidden></span>
      </button>
    </div>
    <div data-part="plhead"></div>
    <div data-part="pending"></div>
    <div class="qchips" data-part="chips" role="group" aria-label="Quick filters"></div>
    <div class="lib-count" data-part="count">
      <p class="lib-count-n" aria-live="polite"></p>
      <label class="sort">
        <span class="sort-label">Sort</span>
        <select class="sort-select" aria-label="Sort recipes">
          ${Object.entries(sortsFor(!!plId)).map(([k, l]) => html`<option value="${k}">${l}</option>`)}
        </select>
        ${raw(ICON.chevron)}
      </label>
    </div>
    <ul class="rlist" data-part="list"></ul>
    <div data-part="empty"></div>
    <div class="lib-foot" data-part="foot"></div>
  </div>`;
  const part = n => root.querySelector(`[data-part="${n}"]`);
  const input = root.querySelector('.search-input');
  const clearBtn = root.querySelector('.search-clear');
  const countEl = root.querySelector('.lib-count-n');
  const sortEl = root.querySelector('.sort-select');
  // Only touch the DOM when a part's markup changed (no image reloads), and carry keyboard
  // focus over to the equivalent element when it is re-rendered.
  const last = {};
  const focusKey = a => {
    const card = a.closest('.rcard'), q = v => CSS.escape(v);
    if (card) return `.rcard[data-slug="${q(card.dataset.slug)}"] ${a.dataset.act ? `[data-act="${q(a.dataset.act)}"]` : '.rcard-link'}`;
    if (a.dataset.k) return `[data-k="${q(a.dataset.k)}"][data-v="${q(a.dataset.v || '')}"]`;   // chip moved add ↔ rm
    return a.dataset.act ? `[data-act="${q(a.dataset.act)}"]` : null;
  };
  const put = (n, markup) => {
    const str = String(markup ?? '');
    if (last[n] === str) return str;
    const el = part(n), a = document.activeElement;
    const key = a && a !== document.body && el.contains(a) ? focusKey(a) : null;
    el.innerHTML = str; last[n] = str;
    if (key) el.querySelector(key)?.focus({ preventScroll: true });
    return str;
  };

  function paint() {
    if (leaving) return;
    topbar();
    if (plId && !pl) {                                   // deleted (maybe on another device)
      ['bar', 'chips', 'count', 'plhead'].forEach(n => { part(n).hidden = true; });
      ['list', 'pending', 'foot'].forEach(n => put(n, ''));
      put('empty', missingPlaylist());
      return;
    }
    const nf = filterCount(s);
    const narrowed = !!s.q.trim() || nf > 0;
    const shown = shownRows();
    const any = rows.length > 0;
    const f = facets(rows, plSets);

    part('plhead').hidden = !pl;
    put('plhead', pl ? playlistHead(rows.length) : '');
    part('bar').hidden = !any;
    const fbtn = root.querySelector('.filter-btn');
    fbtn.classList.toggle('is-active', nf > 0);
    fbtn.setAttribute('aria-label', nf ? `Filters, ${nf} active` : 'Filters');
    part('nf').hidden = !nf;
    part('nf').textContent = nf || '';
    put('pending', !plId && !narrowed && idx.pending.length ? pendingStrip(idx.pending) : '');
    part('chips').hidden = !put('chips', any ? quickChips(s, lib, f) : '');
    part('count').hidden = !any;
    countEl.textContent = narrowed ? `${shown.length} of ${plural(rows.length, 'recipe')}` : plural(rows.length, 'recipe');
    if (sortEl.value !== s.sort) sortEl.value = s.sort;
    put('list', html`${shown.map(x => card(x, pl))}`);
    put('empty', !any ? (pl ? emptyPlaylist(pl) : emptyLibrary(idx.pending.length > 0))
      : !shown.length ? html`<div class="empty lib-empty">
          <h2>No recipes match</h2>
          <p>${nf ? 'Try loosening the filters or a different search.' : 'Try a different search.'}</p>
          <button type="button" class="btn" data-act="clear-all">${nf && s.q.trim() ? 'Clear search & filters' : nf ? 'Clear filters' : 'Clear search'}</button>
        </div>` : '');
    put('foot', any ? connectHint() : '');
  }

  /* hash sync — replaceState never fires hashchange, so no re-route loop */
  const base = myPath === '#' ? '#/' : myPath;
  let hashT = 0;
  function syncHash() {
    clearTimeout(hashT);
    if (!alive) return;
    const qs = toQuery(s, defaultSort(!!plId));
    const url = base + (qs ? '?' + qs : '');
    if ((location.hash || '#/') !== url) history.replaceState(history.state, '', url);
  }
  const syncHashSoon = () => { clearTimeout(hashT); hashT = setTimeout(syncHash, 300); };
  const update = ({ soon = false } = {}) => { paint(); soon ? syncHashSoon() : syncHash(); };

  async function openFilters() {
    const body = document.createElement('div');
    body.className = 'fsheet';
    let cta = null;
    const label = () => { const n = shownRows().length; return n ? `Show ${plural(n, 'recipe')}` : 'No matches'; };
    const draw = () => {
      body.innerHTML = filterBody(s, lib, facets(rows, plSets));
      if (cta) cta.textContent = label();
    };
    on(body, 'click', '[data-f]', (e, b) => { toggle(s, b.dataset.f, b.dataset.v); update(); draw(); });
    draw();
    await sheet({
      title: 'Filters', body, className: 'filter-sheet',
      actions: [
        { label: 'Clear all', value: () => { clearFilters(s); update(); draw(); return undefined; } },   // stays open
        { label: label(), value: true, kind: 'primary' }
      ],
      onOpen: wrap => { cta = wrap.querySelector('.sheet-actions [data-i="1"]'); }
    });
  }

  function act(name, el) {
    if (name === 'clear-q' || name === 'clear-all') {
      s.q = ''; input.value = ''; clearBtn.hidden = true;
      if (name === 'clear-all') clearFilters(s);
      update();
      if (name === 'clear-q') input.focus();
    } else if (name === 'filters') openFilters();
    else if (name === 'rm' || name === 'add') { toggle(s, el.dataset.k, el.dataset.v); update(); }
    else if (name === 'clear-filters') { clearFilters(s); update(); }
    else if (name === 'more') openMeta(el.closest('.rcard'));
    else if (!pl) return;
    else if (name === 'pl-add') openPicker();
    else if (name === 'pl-rename') askRenamePlaylist(pl);
    else if (name === 'pl-delete') {
      const gone = pl;
      askDeletePlaylist(gone, () => { leaving = true; }).then(ok => {
        if (ok) { if (alive) location.hash = '#/playlists'; } else leaving = false;
      });
    } else if (name === 'unlist') {
      const li = el.closest('.rcard');
      try { removeFromPlaylist(pl.id, li.dataset.slug); toast(`Removed from “${pl.name}”`); } catch (e) { reportError(e); }
    }
  }

  /* ---------- "Add recipes" picker (playlist view) ---------- */
  async function openPicker() {
    if (!connected()) return;
    const target = pl;
    const all = [...idx.recipes].sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base', numeric: true }));
    const body = document.createElement('div');
    body.className = 'picker';
    const countLine = () => {
      const n = body.querySelectorAll('.pick-box:checked').length;
      return n ? `${plural(n, 'recipe')} in this playlist` : 'Tap recipes to add them';
    };
    body.innerHTML = all.length ? html`
      <div class="search picker-search">${raw(ICON.search)}
        <input class="input search-input" type="search" placeholder="Find a recipe" aria-label="Find a recipe"
          autocomplete="off" autocapitalize="none" spellcheck="false" enterkeyhint="search">
      </div>
      <p class="pick-count" aria-live="polite"></p>
      <ul class="pick-list">${all.map(r => html`<li data-hay="${fold(`${r.title} ${entryFor(lib, r.slug).tags.join(' ')}`)}">
        <label class="pick">
          <input type="checkbox" class="pick-box" value="${r.slug}" ${target.recipes.includes(r.slug) ? raw('checked') : ''}>
          ${thumb(r, 'pick-thumb')}
          <span class="pick-title">${r.title}</span>
          <span class="pick-check" aria-hidden="true">${raw(ICON.check)}</span>
        </label>
      </li>`)}</ul>
      <p class="pick-none" hidden>No recipes match.</p>`
      : html`<div class="empty"><p>No recipes in your library yet.</p><a class="btn btn-primary" href="#/add">${raw(ICON.plus)}Add a recipe</a></div>`;
    const count = body.querySelector('.pick-count');
    if (count) count.textContent = countLine();
    body.addEventListener('change', e => {
      const cb = e.target.closest('.pick-box');
      if (!cb) return;
      try { (cb.checked ? addToPlaylist : removeFromPlaylist)(target.id, cb.value); }
      catch (err) { cb.checked = !cb.checked; reportError(err); }
      count.textContent = countLine();
    });
    const find = body.querySelector('.search-input');
    find?.addEventListener('input', () => {
      const terms = fold(find.value).split(/\s+/).filter(Boolean);
      let n = 0;
      body.querySelectorAll('.pick-list li').forEach(li => { const ok = terms.every(t => li.dataset.hay.includes(t)); li.hidden = !ok; n += ok; });
      body.querySelector('.pick-none').hidden = n > 0;
    });
    find?.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); find.blur(); } });
    const offImgs = guardImages(body);
    await sheet({
      title: `Add to “${target.name}”`, body, className: 'picker-sheet',
      actions: [{ label: 'Done', value: true, kind: 'primary' }],
      onOpen: (wrap, close) => on(wrap, 'click', 'a[href]', () => close(null))
    });
    offImgs();
  }

  /* ---------- card ⋯ / long-press → meta editor ---------- */
  let press = null;
  function openMeta(li) {
    if (!li) return;
    const slug = li.dataset.slug;
    editMeta(slug, { title: li.dataset.title }).finally(() => {
      press = null;
      // The card was likely re-rendered while editing; put focus back on its ⋯ button.
      if (alive) root.querySelector(`.rcard[data-slug="${CSS.escape(slug)}"] .rcard-more`)?.focus({ preventScroll: true });
    });
  }
  const cancelPress = () => { if (press && !press.fired) { clearTimeout(press.timer); press = null; } };
  function onPointerDown(e) {
    cancelPress(); press = null;
    const link = e.target.closest('.rcard-link');
    if (!link || e.button > 0) return;
    const li = link.closest('.rcard');
    press = {
      x: e.clientX, y: e.clientY, fired: false,
      timer: setTimeout(() => { press.fired = true; navigator.vibrate?.(12); openMeta(li); }, 500)
    };
  }
  const onPointerMove = e => { if (press && !press.fired && Math.hypot(e.clientX - press.x, e.clientY - press.y) > 10) cancelPress(); };
  const onClickCapture = e => { if (press?.fired) { e.preventDefault(); e.stopPropagation(); press = null; } };
  const onContextMenu = e => { if (press && e.target.closest('.rcard')) e.preventDefault(); };   // no native link menu mid-press
  const listen = (el, type, fn, opts) => { el.addEventListener(type, fn, opts); return () => el.removeEventListener(type, fn, opts); };

  /* ---------- scroll: stuck-toolbar hairline + remember position for Back ---------- */
  let scrollT = 0;
  function onScroll() {
    part('bar').classList.toggle('is-stuck', window.scrollY > 2);
    clearTimeout(scrollT);
    scrollT = setTimeout(() => { if (alive) history.replaceState({ ...(history.state || {}), libScroll: Math.round(window.scrollY) }, ''); }, 160);
  }

  paint();
  if (savedY > 0) requestAnimationFrame(() => window.scrollTo(0, savedY));
  const offs = [
    listen(root, 'pointerdown', onPointerDown),
    listen(root, 'pointermove', onPointerMove, { passive: true }),
    listen(root, 'pointerup', cancelPress),
    listen(root, 'pointercancel', cancelPress),
    listen(root, 'click', onClickCapture, true),
    listen(root, 'contextmenu', onContextMenu),
    listen(window, 'scroll', onScroll, { passive: true }),
    guardImages(root),
    on(root, 'input', '.search-input', (e, el) => { s.q = el.value; clearBtn.hidden = !el.value; update({ soon: true }); }),
    on(root, 'keydown', '.search-input', (e, el) => { if (e.key === 'Enter') { e.preventDefault(); el.blur(); } }),
    on(root, 'focusout', '.search-input', () => syncHash()),   // tapping a card blurs first → Back keeps q
    on(root, 'change', '.sort-select', (e, el) => { s.sort = el.value; update(); }),
    on(root, 'click', '[data-act]', (e, el) => act(el.dataset.act, el)),
    onChange(async ev => {
      if (ev.type === 'error') return;
      await load();
      if (alive) paint();
    })
  ];
  return () => {
    alive = false;
    clearTimeout(hashT); clearTimeout(scrollT); cancelPress();
    offs.forEach(off => off());
  };
}
