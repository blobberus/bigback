/**
 * components/recipe-journal.js — notes + photo journal pieces for the recipe page and cook mode.
 *   fmtDate(iso) → "Nov 14" (year added when not this year)
 *   cookedLine(entry) → "Cooked 3× · last Nov 14" | "Not cooked yet"
 *   statusPill(entry) → html     open: "Waiting for update" · applied: "Applied" · kept: "Kept as note"
 *   noteListHtml(notes, { steps, showStep }) → html   newest first, with status + resolution
 *   composerHtml(key, { draft, placeholder, cancel, label }) → html   <form data-composer-form=key>
 *   connectHint(what) → html     "Connect GitHub in Settings to save notes" (only when !isConnected())
 *   photoGridHtml(photos) / photoThumbsHtml(photos) → html   triggers: [data-act="photo-open"][data-id]
 *   openPhotoUploader({ slug, recipe, file, stepId }) → Promise<entry|null>   sheet with preview,
 *       optional note + "Which step?" → store.addPhoto; busy state while compressing/uploading
 *   openLightbox({ slug, entry, recipe }) → Promise<void>   full image, note, date, step, Delete
 */
import { html, raw } from '../util.js';
import { sheet, confirmSheet, toast, reportError, busy } from '../ui.js';
import { isConnected } from '../prefs.js';
import { addPhoto, deleteEntry, mediaUrl, rawUrl } from '../store.js';
import { icon } from './recipe-icons.js';

export function fmtDate(iso) {
  if (!iso) return '';
  const ymd = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})$/);   // date-only → local midnight, not UTC
  const d = ymd ? new Date(+ymd[1], ymd[2] - 1, +ymd[3]) : new Date(iso);
  if (isNaN(d)) return '';
  const opts = { month: 'short', day: 'numeric' };
  if (d.getFullYear() !== new Date().getFullYear()) opts.year = 'numeric';
  return d.toLocaleDateString(undefined, opts);
}

export function cookedLine(entry) {
  const n = entry?.cooked || 0;
  if (!n) return 'Not cooked yet';
  const last = fmtDate(entry.lastCooked);
  return `Cooked ${n}×${last ? ` · last ${last}` : ''}`;
}

const STATUS = {
  open: ['Waiting for update', 'open'],
  applied: ['Applied', 'applied'],
  kept: ['Kept as note', 'kept']
};
export function statusPill(entry) {
  const [label, cls] = STATUS[entry?.status] || STATUS.open;
  return html`<span class="rx-pill rx-pill-${cls}">${entry?.status === 'applied' ? icon('check') : ''}${label}</span>`;
}

const clip = (s, n) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s; };

export function stepRef(entry, steps = []) {
  if (!entry?.stepId) return '';
  const i = steps.findIndex(s => s.id === entry.stepId);
  if (i > -1) return `Step ${i + 1}`;
  return entry.stepText ? `Removed step: “${clip(entry.stepText, 60)}”` : 'A removed step';
}

export function noteListHtml(notes, { steps = [], showStep = false } = {}) {
  if (!notes.length) return '';
  const sorted = [...notes].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  return html`<ul class="rx-notes">${sorted.map(n => html`
    <li class="rx-note rx-note-${n.status || 'open'}">
      ${showStep && n.stepId ? html`<p class="rx-note-ref">${stepRef(n, steps)}</p>` : ''}
      <p class="rx-note-text">${n.text}</p>
      <div class="rx-note-meta">
        ${statusPill(n)}
        <span class="rx-note-date">${fmtDate(n.createdAt)}</span>
        ${(n.status || 'open') === 'open' ? html`<button type="button" class="rx-link-btn rx-note-del" data-act="note-delete" data-id="${n.id}" aria-label="Delete note">${icon('trash')}</button>` : ''}
      </div>
      ${n.resolution ? html`<p class="rx-note-res">${n.resolution}</p>` : ''}
    </li>`)}</ul>`;
}

export function connectHint(what = 'notes') {
  if (isConnected()) return '';
  return html`<p class="rx-hint">${icon('info')}<span><a href="#/settings">Connect GitHub in Settings</a> to save ${what}.</span></p>`;
}

export function composerHtml(key, { draft = '', placeholder = 'Add a note…', cancel = false, label = 'Note' } = {}) {
  const id = `rx-c-${key}`;
  return html`
    <form class="rx-composer" data-composer-form="${key}">
      <label class="sr-only" for="${id}">${label}</label>
      <textarea id="${id}" class="input" rows="3" data-composer="${key}" placeholder="${placeholder}">${draft}</textarea>
      ${connectHint('notes')}
      <div class="rx-composer-actions">
        ${cancel ? html`<button type="button" class="btn btn-ghost" data-act="note-cancel" data-key="${key}">Cancel</button>` : ''}
        <button type="submit" class="btn btn-primary">Save note</button>
      </div>
    </form>`;
}

const img = (path, alt = '', extra = '') =>
  html`<img src="${mediaUrl(path)}" data-fallback="${rawUrl(path)}" alt="${alt}" ${extra ? raw(extra) : ''}>`;

const byNewest = list => [...list].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));

export function photoGridHtml(photos) {
  return html`<ul class="rx-photos">${byNewest(photos).map(p => html`
    <li><button type="button" class="rx-photo" data-act="photo-open" data-id="${p.id}" aria-label="Open photo from ${fmtDate(p.createdAt)}${p.text ? `: ${clip(p.text, 60)}` : ''}">
      ${img(p.photo, '', 'loading="lazy" decoding="async"')}
      ${p.text ? html`<span class="rx-photo-note" aria-hidden="true">${icon('note')}</span>` : ''}
    </button></li>`)}</ul>`;
}

export function photoThumbsHtml(photos) {
  if (!photos.length) return '';
  return html`<div class="rx-thumbs">${byNewest(photos).map(p => html`
    <button type="button" class="rx-thumb" data-act="photo-open" data-id="${p.id}" aria-label="Open step photo from ${fmtDate(p.createdAt)}">
      ${img(p.photo, '', 'loading="lazy" decoding="async"')}
    </button>`)}</div>`;
}

export function openPhotoUploader({ slug, recipe, file, stepId = '' }) {
  const url = URL.createObjectURL(file);
  const steps = recipe.steps || [];
  const body = html`
    <div class="rx-up">
      <img class="rx-up-preview" src="${url}" alt="Selected photo">
      <div class="field">
        <label for="rx-up-note">Note <span class="rx-opt">optional</span></label>
        <textarea id="rx-up-note" class="input" rows="3" placeholder="How did it turn out? Anything to change?"></textarea>
      </div>
      <div class="field">
        <label for="rx-up-step">Which step? <span class="rx-opt">optional</span></label>
        <select id="rx-up-step" class="input">
          <option value="">The whole dish</option>
          ${steps.map((s, i) => html`<option value="${s.id}" ${s.id === stepId ? 'selected' : ''}>Step ${i + 1} — ${clip(s.text, 42)}</option>`)}
        </select>
      </div>
      <div class="rx-up-status" role="status" hidden><span class="rx-up-bar"><span></span></span><span>Compressing and uploading…</span></div>
      <div class="sheet-actions">
        <button type="button" class="btn btn-ghost" data-up="cancel">Cancel</button>
        <button type="button" class="btn btn-primary" data-up="save">${icon('camera')} Add photo</button>
      </div>
    </div>`;
  return sheet({
    title: 'Add to photo journal', body, className: 'rx-up-sheet',
    onOpen(wrap, close) {
      const status = wrap.querySelector('.rx-up-status');
      wrap.addEventListener('click', async e => {
        const b = e.target.closest('[data-up]');
        if (!b) return;
        if (b.dataset.up === 'cancel') return close(null);
        if (b.disabled) return;
        const text = wrap.querySelector('#rx-up-note').value.trim();
        const sid = wrap.querySelector('#rx-up-step').value || null;
        const step = steps.find(s => s.id === sid);
        status.hidden = false;
        wrap.querySelector('[data-up="cancel"]').disabled = true;
        try {
          const entry = await busy(b, addPhoto(slug, file, { text, stepId: sid, stepText: step?.text || null }));
          toast('Photo added to the journal', { type: 'ok' });
          close(entry);
        } catch (err) {
          status.hidden = true;
          wrap.querySelector('[data-up="cancel"]').disabled = false;
          reportError(err);
        }
      });
    }
  }).finally(() => setTimeout(() => URL.revokeObjectURL(url), 400));
}

export async function openLightbox({ slug, entry, recipe }) {
  const ref = stepRef(entry, recipe?.steps || []);
  const step = (recipe?.steps || []).find(s => s.id === entry.stepId);
  const body = html`
    <figure class="rx-lb">
      ${img(entry.photo, entry.text ? clip(entry.text, 120) : 'Journal photo')}
      <figcaption>
        ${entry.text ? html`<p class="rx-lb-text">${entry.text}</p>` : ''}
        <p class="rx-lb-meta">
          <span>${fmtDate(entry.createdAt)}</span>
          ${ref ? html`<span aria-hidden="true">·</span><span>${ref}</span>` : ''}
          ${entry.text ? statusPill(entry) : ''}
        </p>
        ${step ? html`<p class="rx-lb-step">${clip(step.text, 160)}</p>` : ''}
        ${entry.resolution ? html`<p class="rx-note-res">${entry.resolution}</p>` : ''}
      </figcaption>
    </figure>`;
  const v = await sheet({
    title: 'Journal photo', body, className: 'rx-lb-sheet',
    actions: [{ label: 'Delete', value: 'delete', kind: 'danger' }, { label: 'Close', value: null }]
  });
  if (v !== 'delete') return;
  const ok = await confirmSheet('This removes the photo and its note from the journal.', { title: 'Delete this photo?', ok: 'Delete', danger: true });
  if (!ok) return;
  try {
    await deleteEntry(slug, entry.id);
    toast('Photo deleted');
  } catch (err) {
    reportError(err);
  }
}

