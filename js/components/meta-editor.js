/**
 * components/meta-editor.js — shared editor for user-owned recipe metadata (WS1).
 *   editMeta(slug, { title }) → Promise<void>   opens a sheet: pin to the top of Recipes, rating 1–10, proficiency 1–5
 *                                               (tap the current value again — or "Clear" — to
 *                                               reset to blank), tags (chip input, suggestions
 *                                               from allTags), playlist membership + new playlist.
 *                                               Resolves when the sheet closes.
 *   metaSummary(entry) → html raw               compact read-only chips: "8/10" · ●●●○○ · tags
 *                                               ("Unrated" muted when blank). Styles: library.css.
 *   PROFICIENCY: string[5]   profLabel(n) → "Comfortable" | "Not set"
 * Every change applies immediately via store.setPinned / setTags / setRating / setProficiency /
 * addToPlaylist / removeFromPlaylist / createPlaylist (optimistic, batched into one commit).
 * Setters throw NotConnectedError without a token → reportError shows the friendly toast.
 */
import { html, raw } from '../util.js';
import {
  getLibrary, entryFor, allTags, setTags, setRating, setProficiency, setPinned,
  createPlaylist, addToPlaylist, removeFromPlaylist
} from '../store.js';
import { sheet, stars, reportError, on } from '../ui.js';
import { isConnected } from '../prefs.js';

export const PROFICIENCY = ['First try', 'Getting there', 'Comfortable', 'Confident', 'Signature dish'];
export const profLabel = n => PROFICIENCY[n - 1] || 'Not set';

const ICON = {
  x: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10M17 7L7 17"/></svg>',
  plus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 6v12M6 12h12"/></svg>',
  check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  pin: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 3.5h6M10 3.5l-.7 6L6.5 13h11l-2.8-3.5-.7-6M12 13v7.5"/></svg>'
};

/** Normalize a typed tag: lowercase, single spaces, no leading "#". */
const normTag = t => String(t || '').replace(/^#+/, '').trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 40);

/** Run a store setter; report (and swallow) failures. Returns true on success. */
function attempt(fn) {
  try { fn(); return true; } catch (e) { reportError(e); return false; }
}

export function metaSummary(entry) {
  const e = entry || {};
  const tags = e.tags || [];
  return html`<span class="meta-sum">${e.rating
    ? html`<span class="ms-item ms-rating">${e.rating}/10</span>`
    : html`<span class="ms-item ms-blank">Unrated</span>`}${e.proficiency
    ? html`<span class="ms-item ms-prof">${raw(stars(e.proficiency, 5))}<span class="ms-prof-l">${profLabel(e.proficiency)}</span></span>`
    : html`<span class="ms-item ms-blank">Proficiency not set</span>`}${tags.slice(0, 3).map(t => html`<span class="chip chip-tag">${t}</span>`)}${tags.length > 3
    ? html`<span class="ms-item ms-more">+${tags.length - 3}</span>` : ''}</span>`;
}

export async function editMeta(slug, { title = '' } = {}) {
  let lib;
  try { lib = await getLibrary(); } catch (e) { reportError(e); return; }
  const st = entryFor(lib, slug);
  const known = allTags(lib);
  const playlists = lib.playlists.map(p => ({ id: p.id, name: p.name, on: p.recipes.includes(slug) }));

  const body = document.createElement('div');
  body.className = 'meta-ed';
  body.innerHTML = html`
    ${isConnected() ? '' : html`<p class="connect-hint">Connect GitHub to save ratings &amp; playlists → <a href="#/settings">Settings</a></p>`}
    <button type="button" class="me-pin" data-act="pin" aria-pressed="false">${raw(ICON.pin)}<span class="me-pin-l"></span></button>
    <section class="me-sec" aria-labelledby="me-rating-h">
      <div class="me-head">
        <h3 class="label" id="me-rating-h">Rating</h3>
        <span class="me-val" data-val="rating"></span>
      </div>
      <div class="me-scale me-scale-10" role="group" aria-labelledby="me-rating-h">
        ${Array.from({ length: 10 }, (_, i) => html`<button type="button" class="me-pill" data-rate="${i + 1}" aria-label="${i + 1} out of 10">${i + 1}</button>`)}
      </div>
    </section>
    <section class="me-sec" aria-labelledby="me-prof-h">
      <div class="me-head">
        <h3 class="label" id="me-prof-h">Proficiency</h3>
        <span class="me-val" data-val="prof"></span>
      </div>
      <div class="me-scale me-scale-5" role="group" aria-labelledby="me-prof-h">
        ${PROFICIENCY.map((l, i) => html`<button type="button" class="me-pill" data-prof="${i + 1}" aria-label="${i + 1} — ${l}" title="${l}">${i + 1}</button>`)}
      </div>
      <div class="me-anchors" aria-hidden="true"><span>${PROFICIENCY[0]}</span><span>${PROFICIENCY[4]}</span></div>
    </section>
    <section class="me-sec">
      <div class="me-head"><label class="label" for="me-tag-input">Tags</label></div>
      <div class="tag-box" data-part="tagbox">
        <span class="tag-list" data-part="tags"></span>
        <input id="me-tag-input" class="tag-entry" type="text" placeholder="Add a tag"
          autocomplete="off" autocapitalize="none" spellcheck="false" enterkeyhint="done" maxlength="40">
      </div>
      <div class="chips me-sugg" data-part="sugg"></div>
    </section>
    <section class="me-sec" aria-labelledby="me-pl-h">
      <div class="me-head"><h3 class="label" id="me-pl-h">Playlists</h3></div>
      <div class="chips me-pls" data-part="pls"></div>
      <form class="me-newpl" data-part="newpl" hidden>
        <input class="input" type="text" placeholder="Playlist name" aria-label="New playlist name" enterkeyhint="done" maxlength="60">
        <button type="submit" class="btn btn-primary">Add</button>
      </form>
    </section>`;

  const part = n => body.querySelector(`[data-part="${n}"]`);
  const input = body.querySelector('#me-tag-input');

  /* ---------- painters (update in place so focus/keyboard survive) ---------- */
  function paintScale(attr, value, valEl, text) {
    const pills = body.querySelectorAll(`[data-${attr}]`);
    pills.forEach(b => {
      const n = +b.dataset[attr];
      b.setAttribute('aria-pressed', String(n === value));
      b.classList.toggle('is-fill', value != null && n < value);
    });
    const hadFocus = valEl.contains(document.activeElement);
    const what = attr === 'rate' ? 'rating' : 'proficiency';
    valEl.innerHTML = value == null
      ? html`<span class="me-blank">${text}</span>`
      : html`<span>${text}</span><button type="button" class="me-clear" data-clear="${attr}" aria-label="Clear ${what}">Clear</button>`;
    if (hadFocus) pills[0]?.focus();               // the Clear button just disappeared
  }
  const paintRating = () => paintScale('rate', st.rating, body.querySelector('[data-val="rating"]'), st.rating == null ? 'Unrated' : `${st.rating}/10`);
  const paintProf = () => paintScale('prof', st.proficiency, body.querySelector('[data-val="prof"]'), profLabel(st.proficiency));

  function paintTags() {
    const hadFocus = part('tags').contains(document.activeElement);
    part('tags').innerHTML = html`${st.tags.map(t => html`<span class="tag-chip">${t}<button type="button" data-untag="${t}" aria-label="Remove tag ${t}">${raw(ICON.x)}</button></span>`)}`;
    input.placeholder = st.tags.length ? 'Add another' : 'Add a tag';
    if (hadFocus) input.focus();                   // the removed tag's button is gone
    paintSugg();
  }
  function paintSugg() {
    const typed = normTag(input.value);
    const pool = known.filter(t => !st.tags.includes(t) && (!typed || t.includes(typed)));
    const fresh = typed && !st.tags.includes(typed) && !known.includes(typed);
    part('sugg').innerHTML = html`${fresh ? html`<button type="button" class="chip me-sugg-new" data-addtag="${typed}">${raw(ICON.plus)}<span class="chip-text">Add “${typed}”</span></button>` : ''}${pool.slice(0, 12).map(t => html`<button type="button" class="chip" data-addtag="${t}" aria-label="Add tag ${t}">${raw(ICON.plus)}<span class="chip-text">${t}</span></button>`)}`;
    part('sugg').hidden = !fresh && !pool.length;
  }
  /** Repaint the playlist chips; keyboard focus follows `focusId` (or the chip that had it). */
  function paintPin() {
    const b = body.querySelector('[data-act="pin"]');
    b.setAttribute('aria-pressed', String(!!st.pinnedAt));
    b.querySelector('.me-pin-l').textContent = st.pinnedAt ? 'Pinned to the top of Recipes' : 'Pin to the top of Recipes';
  }

  function paintPlaylists(focusId) {
    const box = part('pls'), f = document.activeElement;
    const keep = focusId || (box.contains(f) ? f.dataset.pl || f.dataset.act : null);
    box.innerHTML = html`${playlists.map(p => html`<button type="button" class="chip me-pl" data-pl="${p.id}" aria-pressed="${p.on}">${raw(p.on ? ICON.check : ICON.plus)}<span class="chip-text">${p.name}</span></button>`)}<button type="button" class="chip me-pl-new" data-act="newpl" ${part('newpl').hidden ? '' : raw('hidden')}>${raw(ICON.plus)}New playlist</button>`;
    if (keep) [...box.querySelectorAll('button:not([hidden])')].find(b => (b.dataset.pl || b.dataset.act) === keep)?.focus();
  }

  /* ---------- mutations ---------- */
  function addTags(list) {
    const next = [...new Set([...st.tags, ...list.map(normTag).filter(Boolean)])];
    if (next.length === st.tags.length) return true;
    if (!attempt(() => setTags(slug, next))) return false;
    st.tags = next; paintTags();
    return true;
  }
  function removeTag(t) {
    const next = st.tags.filter(x => x !== t);
    if (attempt(() => setTags(slug, next))) { st.tags = next; paintTags(); }
  }
  function commitTyped() {
    if (!normTag(input.value)) { input.value = ''; return; }
    if (addTags([input.value])) { input.value = ''; paintSugg(); }
  }

  on(body, 'click', '[data-act="pin"]', () => {
    const next = !st.pinnedAt;
    if (attempt(() => setPinned(slug, next))) { st.pinnedAt = next ? new Date().toISOString() : null; paintPin(); }
  });
  on(body, 'click', '[data-rate]', (e, b) => {
    const n = +b.dataset.rate, next = st.rating === n ? null : n;
    if (attempt(() => setRating(slug, next))) { st.rating = next; paintRating(); }
  });
  on(body, 'click', '[data-prof]', (e, b) => {
    const n = +b.dataset.prof, next = st.proficiency === n ? null : n;
    if (attempt(() => setProficiency(slug, next))) { st.proficiency = next; paintProf(); }
  });
  on(body, 'click', '[data-clear]', (e, b) => {
    if (b.dataset.clear === 'rate') { if (attempt(() => setRating(slug, null))) { st.rating = null; paintRating(); } }
    else if (attempt(() => setProficiency(slug, null))) { st.proficiency = null; paintProf(); }
  });

  on(body, 'click', '[data-untag]', (e, b) => removeTag(b.dataset.untag));
  on(body, 'click', '[data-addtag]', (e, b) => {
    const keyboard = document.activeElement === b;   // taps never focus it (mousedown is cancelled below)
    if (addTags([b.dataset.addtag])) { input.value = ''; paintSugg(); if (keyboard) input.focus(); }
  });
  // Keep the keyboard up when tapping a suggestion.
  on(body, 'mousedown', '[data-addtag], [data-untag]', e => e.preventDefault());
  part('tagbox').addEventListener('click', e => { if (!e.target.closest('button')) input.focus(); });
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); commitTyped(); }
    else if (e.key === 'Backspace' && !input.value && st.tags.length) removeTag(st.tags[st.tags.length - 1]);
  });
  input.addEventListener('input', () => {
    if (input.value.includes(',')) {
      const parts = input.value.split(',');
      const rest = parts.pop();
      if (addTags(parts)) input.value = rest.trimStart();
    }
    paintSugg();
  });

  on(body, 'click', '[data-pl]', (e, b) => {
    const p = playlists.find(x => x.id === b.dataset.pl);
    if (!p) return;
    if (attempt(() => (p.on ? removeFromPlaylist(p.id, slug) : addToPlaylist(p.id, slug)))) { p.on = !p.on; paintPlaylists(); }
  });
  on(body, 'click', '[data-act="newpl"]', () => {
    const form = part('newpl');
    form.hidden = false; paintPlaylists();
    form.querySelector('input').focus();
  });
  part('newpl').addEventListener('submit', e => {
    e.preventDefault();
    const form = e.currentTarget, field = form.querySelector('input');
    const name = field.value.trim().replace(/\s+/g, ' ');
    if (!name) { form.hidden = true; paintPlaylists('newpl'); return; }
    let id;
    if (!attempt(() => { id = createPlaylist(name); addToPlaylist(id, slug); })) return;
    playlists.push({ id, name, on: true });
    field.value = ''; form.hidden = true; paintPlaylists(id);
  });

  paintPin(); paintRating(); paintProf(); paintTags(); paintPlaylists();

  await sheet({
    title: title || 'Recipe details',
    body,
    className: 'meta-sheet',
    actions: [{ label: 'Done', value: true, kind: 'primary' }],
    onOpen: (wrap, close) => on(wrap, 'click', 'a[href]', () => close(null))
  });
  // Typed-but-not-entered tag text still counts when the sheet closes.
  if (normTag(input.value)) addTags([input.value]);
}
