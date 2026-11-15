/**
 * views/playlists.js — playlist management (#/playlists) (WS1).
 *   List: name, recipe count, first titles, mosaic of up to 3 thumbnails → #/playlist/<id>
 *   (rendered by library.js). Create (promptSheet → createPlaylist, then opens it),
 *   rename (promptSheet), delete (confirmSheet) via the row's ⋯ menu.
 */
import { html, raw } from '../util.js';
import { getIndex, getLibrary, onChange } from '../store.js';
import { setTopbar, on, sheet } from '../ui.js';
import {
  ICON, thumb, guardImages, connectHint, plural,
  askNewPlaylist, askRenamePlaylist, askDeletePlaylist
} from './library.js';

function row(p) {
  // Prefer recipes with photos for the mosaic; generated tiles fill the rest.
  const tiles = [...p.items.filter(r => r.image), ...p.items.filter(r => !r.image)].slice(0, 3);
  return html`<li class="pl-row">
    <a class="pl-link" href="#/playlist/${p.id}">
      <span class="mosaic mosaic-${tiles.length}" aria-hidden="true">${tiles.length
        ? tiles.map(r => thumb(r, 'mosaic-tile'))
        : html`<span class="mosaic-empty">${raw(ICON.playlist)}</span>`}</span>
      <span class="pl-body">
        <span class="pl-name">${p.name}</span>
        <span class="pl-meta">${p.items.length ? plural(p.items.length, 'recipe') : 'Empty — tap to add recipes'}</span>
        ${p.items.length ? html`<span class="pl-preview">${p.items.slice(0, 3).map(r => r.title).join(' · ')}</span>` : ''}
      </span>
    </a>
    <button type="button" class="icon-btn pl-more" data-act="menu" data-id="${p.id}" aria-label="Options for ${p.name}">${raw(ICON.more)}</button>
  </li>`;
}

let renders = 0;   // newest render of this view: an older one still loading must not paint or bind

export async function render(root) {
  setTopbar({ title: 'Playlists' });
  const me = ++renders, myPath = location.hash.split('?')[0];
  let idx, lib, alive = true;
  const load = async () => { [idx, lib] = await Promise.all([getIndex(), getLibrary()]); };
  await load();
  if (me !== renders || location.hash.split('?')[0] !== myPath) return;   // navigated away (or away and back) while loading

  // Only touch the DOM when the markup changed: a library commit echoes the optimistic change
  // back, and rebuilding the rows re-creates every mosaic image (lazy images flash their letter tile).
  let shown = '';
  function paint() {
    const bySlug = new Map(idx.recipes.map(r => [r.slug, r]));
    const pls = lib.playlists.map(p => ({ ...p, items: p.recipes.map(s => bySlug.get(s)).filter(Boolean) }));
    const markup = String(html`<div class="pls">
      ${connectHint()}
      ${pls.length ? html`
        <div class="pls-head">
          <p class="pls-count">${plural(pls.length, 'playlist')}</p>
          <button type="button" class="btn btn-soft" data-act="new">${raw(ICON.plus)}New playlist</button>
        </div>
        <ul class="pl-list">${pls.map(row)}</ul>`
      : html`<div class="empty lib-empty">
          <span class="lib-empty-art">${raw(ICON.playlist)}</span>
          <h2>No playlists yet</h2>
          <p>Group recipes for weeknights, holidays or meal prep. A recipe can live in as many as you like.</p>
          <button type="button" class="btn btn-primary" data-act="new">${raw(ICON.plus)}New playlist</button>
        </div>`}
    </div>`);
    if (markup === shown) return;
    const a = document.activeElement, key = a && a !== root && root.contains(a) ? focusKey(a) : null;
    root.innerHTML = shown = markup;
    if (key) root.querySelector(key)?.focus({ preventScroll: true });   // same control, re-rendered
  }
  const focusKey = el => {
    const q = v => CSS.escape(v);
    if (el.dataset.act) return `[data-act="${q(el.dataset.act)}"]${el.dataset.id ? `[data-id="${q(el.dataset.id)}"]` : ''}`;
    return el.matches('a[href]') ? `a[href="${q(el.getAttribute('href'))}"]` : null;
  };

  async function menu(id) {
    const pl = lib.playlists.find(p => p.id === id);
    if (!pl) return;
    const choice = await sheet({
      title: pl.name,
      body: html`<div class="action-list">
        <button type="button" class="action-row" data-v="rename">${raw(ICON.pencil)}Rename</button>
        <button type="button" class="action-row is-danger" data-v="delete">${raw(ICON.trash)}Delete playlist</button>
      </div>`,
      onOpen: (wrap, close) => on(wrap, 'click', '[data-v]', (e, b) => close(b.dataset.v))
    });
    if (choice === 'rename') await askRenamePlaylist(pl);
    else if (choice === 'delete') await askDeletePlaylist(pl);
    // Back on this row's ⋯ once the sheets close (paint() carries it through the rename's repaint;
    // after a delete the row is gone).
    if (alive && choice) root.querySelector(`.pl-more[data-id="${CSS.escape(id)}"]`)?.focus({ preventScroll: true });
  }

  paint();
  const offs = [
    guardImages(root),
    on(root, 'click', '[data-act]', async (e, el) => {
      if (el.dataset.act === 'new') {
        const id = await askNewPlaylist();
        if (id && alive) location.hash = `#/playlist/${id}`;
      } else if (el.dataset.act === 'menu') menu(el.dataset.id);
    }),
    onChange(async ev => {
      if (ev.type === 'error') return;
      await load();
      if (alive) paint();
    })
  ];
  return () => { alive = false; offs.forEach(off => off()); };
}
