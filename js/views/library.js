/**
 * views/library.js — recipe list (#/) and playlist view (#/playlist/<id>) (WS1).
 *
 * Search / filter / sort state lives in the hash query and is kept in sync with
 * history.replaceState (no hashchange → no re-route), so Back restores it:
 *   #/?q=chicken&tag=weeknight,quick&untagged=1&rating=unrated,8-10&prof=none,3
 *      &pl=pl-k3x9&src=pdf,web&needs=1&sort=rating
 * Values within a category OR together; categories AND together. Blank values are
 * categories of their own (Unrated, Not set, Untagged).
 *
 * Also exports display helpers shared with playlists.js:
 *   ICON, thumb(summary, cls), guardImages(el) → off, connectHint(), plural(n, word)
 */
import { html, raw, fmtMinutes } from '../util.js';
import { getIndex, getLibrary, entryFor, mediaUrl, rawUrl, onChange } from '../store.js';
import { setTopbar, on, stars } from '../ui.js';
import { isConnected } from '../prefs.js';

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
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

function queryOf(params) {
  // Read the raw hash: app.js decodes the whole hash before splitting, which mangles "%26".
  const i = location.hash.indexOf('?');
  return i >= 0 ? new URLSearchParams(location.hash.slice(i + 1)) : (params.query || new URLSearchParams());
}

function readState(params) {
  const q = queryOf(params);
  const sort = q.get('sort');
  return { q: q.get('q') || '', sort: has(SORTS, sort) ? sort : 'recent' };
}

function toQuery(s) {
  const enc = v => encodeURIComponent(v);
  const parts = [];
  if (s.q.trim()) parts.push('q=' + enc(s.q.trim()));
  if (s.sort !== 'recent') parts.push('sort=' + s.sort);
  return parts.join('&');
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
  time: (a, b) => nullsLast(a.t, b.t, 1) || byTitle(a, b)
};

function toRow(r, lib) {
  const e = entryFor(lib, r.slug);
  return {
    r, e, t: totalTime(r),
    ts: Math.max(Date.parse(r.updatedAt) || 0, Date.parse(e.addedAt) || 0),
    hay: fold(`${r.title} ${r.summary || ''} ${e.tags.join(' ')}`)
  };
}

function matches(x, s) {
  const terms = fold(s.q).split(/\s+/).filter(Boolean);
  return terms.every(t => x.hay.includes(t));
}

/* ---------- markup ---------- */
function card({ r, e, t }) {
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
          ${e.proficiency ? html`<span class="rm-prof">${raw(stars(e.proficiency, 5))}</span>` : ''}
        </span>
        ${tags.length || flags ? html`<span class="rcard-tags">
          ${r.status === 'custom' ? html`<span class="flag flag-build">Needs build</span>` : ''}
          ${r.openNotes > 0 ? html`<span class="flag flag-notes">${raw(ICON.note)}${plural(r.openNotes, 'open note')}</span>` : ''}
          ${tags.map(tg => html`<span class="chip chip-tag">${tg}</span>`)}
        </span>` : ''}
      </span>
    </a>
    <button type="button" class="icon-btn rcard-more" data-act="more" aria-label="Rating, tags &amp; playlists for ${r.title}">${raw(ICON.more)}</button>
  </li>`;
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
  let idx, lib, rows = [], alive = true;

  setTopbar({ title: 'Recipes' });

  async function load() {
    [idx, lib] = await Promise.all([getIndex(), getLibrary()]);
    rows = idx.recipes.map(r => toRow(r, lib));
  }
  await load();
  if (pathOf(location.hash) !== myPath) return;   // navigated away while loading

  root.innerHTML = html`<div class="lib">
    <div class="lib-bar" role="search" data-part="bar">
      <div class="search">
        ${raw(ICON.search)}
        <input class="input search-input" type="search" value="${s.q}" placeholder="Search recipes, tags…"
          aria-label="Search recipes" autocomplete="off" autocapitalize="none" spellcheck="false" enterkeyhint="search">
        <button type="button" class="search-clear" data-act="clear-q" aria-label="Clear search" ${s.q ? '' : raw('hidden')}>${raw(ICON.x)}</button>
      </div>
    </div>
    <div data-part="pending"></div>
    <div class="lib-count" data-part="count"></div>
    <ul class="rlist" data-part="list"></ul>
    <div data-part="empty"></div>
    <div class="lib-foot" data-part="foot"></div>
  </div>`;
  const part = n => root.querySelector(`[data-part="${n}"]`);
  const input = root.querySelector('.search-input');
  const clearBtn = root.querySelector('.search-clear');

  function paint() {
    const searching = !!s.q.trim();
    const shown = rows.filter(x => matches(x, s)).sort(SORT_FNS[s.sort]);
    const any = rows.length > 0;

    part('bar').hidden = !any;
    part('pending').innerHTML = !searching && idx.pending.length ? pendingStrip(idx.pending) : '';
    part('count').hidden = !any;
    part('count').innerHTML = html`
      <p class="lib-count-n" aria-live="polite">${searching ? `${shown.length} of ${plural(rows.length, 'recipe')}` : plural(rows.length, 'recipe')}</p>
      <label class="sort">
        <span class="sort-label">Sort</span>
        <select class="sort-select" aria-label="Sort recipes">
          ${Object.entries(SORTS).map(([k, l]) => html`<option value="${k}" ${k === s.sort ? raw('selected') : ''}>${l}</option>`)}
        </select>
        ${raw(ICON.chevron)}
      </label>`;
    part('list').innerHTML = html`${shown.map(card)}`;
    part('empty').innerHTML = !any ? emptyLibrary(idx.pending.length > 0)
      : !shown.length ? html`<div class="empty lib-empty">
          <h2>No recipes match</h2>
          <p>Try a different search.</p>
          <button type="button" class="btn" data-act="clear-all">Clear search</button>
        </div>` : '';
    part('foot').innerHTML = any ? connectHint() : '';
  }

  /* hash sync — replaceState never fires hashchange, so no re-route loop */
  const base = myPath === '#' ? '#/' : myPath;
  let hashT = 0;
  function syncHash() {
    clearTimeout(hashT);
    if (!alive) return;
    const qs = toQuery(s);
    const url = base + (qs ? '?' + qs : '');
    if ((location.hash || '#/') !== url) history.replaceState(history.state, '', url);
  }
  const syncHashSoon = () => { clearTimeout(hashT); hashT = setTimeout(syncHash, 300); };
  const update = ({ soon = false } = {}) => { paint(); soon ? syncHashSoon() : syncHash(); };

  function act(name) {
    if (name === 'clear-q' || name === 'clear-all') {
      s.q = ''; input.value = ''; clearBtn.hidden = true;
      update();
      if (name === 'clear-q') input.focus();
    }
  }

  paint();
  const offs = [
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
    clearTimeout(hashT);
    offs.forEach(off => off());
  };
}
