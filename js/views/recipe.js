/**
 * views/recipe.js — recipe page (#/r/<slug>).
 * Hero, title, summary, times, source → your meta + cooking log (days with journal photos) → flavor profile →
 * equipment → scaled, checkable ingredients → numbered steps (tap the number = done) with
 * timers and step notes → recipe notes → photo journal → changelog.
 * Re-renders on store changes to this recipe's files. Cooking state (checked, done, scale)
 * and half-typed notes live in sessionStorage (components/recipe-state.js), shared with cook mode.
 * A render that is still loading when you move on (Back, another recipe) paints nothing and binds
 * nothing: the router drops the cleanup of a render it has already left.
 * The topbar ← returns to the list or playlist the recipe was opened from (search, filters and
 * scroll intact; components/back-nav.js), else to #/.
 */
import {
  getRecipe, getLibrary, entryFor, getJournal, onChange, addNote,
  mediaUrl, rawUrl, NotConnectedError
} from '../store.js';
import { setTopbar, on, toast, reportError, busy } from '../ui.js';
import { html, fmtMinutes } from '../util.js';
import { editMeta, metaSummary } from '../components/meta-editor.js';
import { icon } from '../components/recipe-icons.js';
import { rxState, rxPatch, setDraft, toggleId } from '../components/recipe-state.js';
import { ingredientsHtml, bindIngredients } from '../components/recipe-ingredients.js';
import { groupBySection, stepTextHtml, tempsHtml, timerButtonsHtml, bindTimers } from '../components/recipe-steps.js';
import { mentionMatcher, bindMentions } from '../components/recipe-mentions.js';
import {
  fmtDate, cookLog, cookedLine, noteListHtml, composerHtml, connectHint, photoGridHtml, photoThumbsHtml,
  openPhotoUploader, openLightbox, confirmDeleteNote
} from '../components/recipe-journal.js';
import { isConnected } from '../prefs.js';
import { backTarget, goBack } from '../components/back-nav.js';

const safeUrl = u => (/^https?:\/\//i.test(String(u || '')) ? u : null);
const host = u => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; } };
const fileName = p => String(p).split('/').pop();
const PAST_TITLE = 'rx-past-title';
/** The Recipes list (#/, #/?q=…) or a playlist (#/playlist/<id>…). */
const isList = h => /^(?:playlist\/[\w-]+)?$/.test(h.replace(/^#\/?/, '').split('?')[0]);
let renders = 0;            // newest render of this view

export async function render(root, { slug }) {
  const mine = new Set([`recipes/${slug}.json`, `journal/${slug}.json`, 'data/library.json']);
  const openDetails = new Set();
  const me = ++renders, path = location.hash.split('?')[0];
  const stale = () => me !== renders || location.hash.split('?')[0] !== path;
  const from = backTarget(isList), back = from || '#/';
  let data = null;          // { recipe, entry, journal }
  let seq = 0;
  let io = null;
  let timers = null;

  /* ---------- painting ---------- */
  async function paint() {
    const my = ++seq;
    const [recipe, lib, journal] = await Promise.all([getRecipe(slug), getLibrary(), getJournal(slug)]);
    if (my !== seq || stale()) return;
    data = { recipe, entry: entryFor(lib, slug), journal };
    if (!recipe) return paintMissing();
    setTopbar({
      title: recipe.title || 'Recipe', back,
      actions: html`
        <a class="icon-btn" href="#/r/${slug}/cook" aria-label="Cook mode" title="Cook mode">${icon('flame')}</a>
        <a class="icon-btn" href="#/edit/${slug}" aria-label="Edit recipe" title="Edit recipe">${icon('edit')}</a>`
    });
    const focus = captureFocus();
    root.innerHTML = page(data);
    restoreFocus(focus);
    timers?.refresh();
    observeTitle();
  }

  function paintMissing() {
    setTopbar({ title: 'Recipe not found', back });
    document.body.classList.add(PAST_TITLE);
    root.innerHTML = html`
      <div class="empty rx-missing">
        ${icon('pan', 'rx-missing-ic')}
        <h2>We couldn't find that recipe</h2>
        <p>It may have been renamed or deleted. If you just uploaded it, it appears after the next “update the site”.</p>
        ${isConnected() ? html`<p class="muted small">Nothing loading at all? Check your GitHub token in <a href="#/settings">Settings</a>.</p>` : ''}
        <a class="btn btn-primary" href="#/">Back to recipes</a>
      </div>`;
  }

  // Keep a half-typed note focused (and the caret in place) across re-renders.
  function captureFocus() {
    const a = document.activeElement;
    if (!a || !root.contains(a) || !a.dataset?.composer) return null;
    return { key: a.dataset.composer, start: a.selectionStart, end: a.selectionEnd };
  }
  function restoreFocus(f) {
    if (!f) return;
    const ta = root.querySelector(`textarea[data-composer="${CSS.escape(f.key)}"]`);
    if (!ta) return;
    ta.focus({ preventScroll: true });
    try { ta.setSelectionRange(f.start, f.end); } catch { /* ignore */ }
  }

  // Show the recipe name in the top bar only once the big title has scrolled away.
  function observeTitle() {
    io?.disconnect();
    const t = root.querySelector('.rx-title');
    if (!t || !('IntersectionObserver' in window)) { document.body.classList.add(PAST_TITLE); return; }
    io = new IntersectionObserver(([en]) => {
      document.body.classList.toggle(PAST_TITLE, !en.isIntersecting && en.boundingClientRect.top < 80);
    }, { rootMargin: '-60px 0px 0px 0px' });
    io.observe(t);
  }

  /* ---------- markup ---------- */
  function page({ recipe: r, entry, journal }) {
    const st = rxState(slug);
    const steps = r.steps || [];
    const entries = journal?.entries || [];
    const notes = entries.filter(e => e.kind !== 'photo');
    const photos = entries.filter(e => e.kind === 'photo' && e.photo);
    const stepIds = new Set(steps.map(s => s.id));
    const recipeNotes = notes.filter(n => !n.stepId || !stepIds.has(n.stepId));
    return html`
      <article class="rx">
        ${hero(r)}
        <header class="rx-head">
          <h1 class="rx-title">${r.title}</h1>
          ${r.summary ? html`<p class="rx-summary">${r.summary}</p>` : ''}
          ${stats(r)}
          ${r.yield ? html`<p class="rx-line"><span class="rx-label">Makes</span><span>${r.yield}</span></p>` : ''}
          ${source(r)}
          ${photoCredit(r)}
        </header>
        ${r.status === 'custom' ? html`
          <p class="rx-notice">${icon('spark')}<span>Typed by you — Claude will add a flavor profile and timers next time you say “update the site”.</span></p>` : ''}
        ${cookButton(r)}
        ${youCard(entry, photos)}
        ${r.profile ? details('profile', html`Flavor profile &amp; deliverables`, html`<p>${r.profile}</p>`) : ''}
        ${(r.equipment || []).length ? html`
          <section class="rx-section" aria-labelledby="rx-h-equip">
            <h2 id="rx-h-equip" class="rx-h rx-h-sm">Equipment</h2>
            <ul class="rx-equip">${r.equipment.map(e => html`<li>${e}</li>`)}</ul>
          </section>` : ''}
        <section class="rx-section" aria-labelledby="rx-h-ing">
          <h2 id="rx-h-ing" class="rx-h">Ingredients</h2>
          <div data-ingredients>${ingredientsHtml(r, slug)}</div>
        </section>
        <section class="rx-section" aria-labelledby="rx-h-steps">
          <div class="rx-h-row">
            <h2 id="rx-h-steps" class="rx-h">Method</h2>
            <span class="rx-h-aside" data-steps-meta>${stepsMeta(st, steps)}</span>
          </div>
          ${steps.length ? stepsHtml(r, st, notes, photos) : html`<p class="muted">No steps yet.</p>`}
        </section>
        <section class="rx-section" aria-labelledby="rx-h-notes">
          <h2 id="rx-h-notes" class="rx-h">Notes &amp; feedback</h2>
          <p class="rx-explain">Notes are saved to the repo. Say “update the site” to Claude and it folds your feedback into the recipe.</p>
          ${composerHtml('recipe', { draft: st.drafts.recipe || '', placeholder: 'Too salty? Swapped something? Note it here…', label: 'Note on this recipe' })}
          ${noteListHtml(recipeNotes, { steps, showStep: true })}
        </section>
        <section class="rx-section" aria-labelledby="rx-h-photos">
          <div class="rx-h-row">
            <h2 id="rx-h-photos" class="rx-h">Photo journal</h2>
            <button type="button" class="btn btn-soft rx-photo-add" data-act="photo-add">${icon('camera')} Add photo</button>
          </div>
          <input type="file" accept="image/*" class="sr-only" data-photo-input tabindex="-1" aria-hidden="true">
          ${connectHint('photos')}
          ${photos.length ? photoGridHtml(photos) : html`<p class="rx-empty-line">No photos yet — snap one next time you cook it.</p>`}
        </section>
        ${changelog(r)}
      </article>`;
  }

  function cookButton(r) {
    const at = (r.steps || []).findIndex(s => s.id === rxState(slug).step);
    const label = at > 0 ? `Resume cooking · step ${at + 1}` : 'Start cook mode';
    return html`<a class="btn btn-primary btn-block rx-cook-btn" href="#/r/${slug}/cook">${icon('flame')} ${label}</a>`;
  }

  function hero(r) {
    if (r.image) {
      return html`<figure class="rx-hero"><img src="${mediaUrl(r.image)}" data-fallback="${rawUrl(r.image)}" alt="${r.title}" decoding="async"></figure>`;
    }
    return html`<div class="rx-hero rx-hero-ph" aria-hidden="true">${icon('pan')}</div>`;
  }

  function stats(r) {
    const t = r.time || {};
    const total = t.total ?? (t.prep != null && t.cook != null ? t.prep + t.cook : null);
    const items = [['Prep', t.prep], ['Cook', t.cook], ['Total', total]]
      .filter(([, v]) => v != null && v !== '' && !isNaN(v))
      .map(([k, v]) => [k, fmtMinutes(Number(v))]);
    if (r.servings) items.push(['Serves', String(r.servings)]);
    if (!items.length) return '';
    return html`<dl class="rx-stats">${items.map(([k, v]) => html`<div><dt>${k}</dt><dd>${v}</dd></div>`)}</dl>`;
  }

  function source(r) {
    const s = r.source || {};
    const bits = [];
    const url = safeUrl(s.url);
    if (url) bits.push(html`<a href="${url}" target="_blank" rel="noopener noreferrer">${host(url)}${icon('external')}</a>`);
    if (s.author) bits.push(html`<span>by ${s.author}</span>`);
    (s.files || []).filter(Boolean).forEach(f =>
      bits.push(html`<a href="${mediaUrl(f)}" target="_blank" rel="noopener">${icon('file')}${fileName(f)}</a>`));
    if (!bits.length) return '';
    return html`<p class="rx-line rx-source"><span class="rx-label">Source</span><span class="rx-source-bits">${bits.map((b, i) =>
      i ? html`<span class="rx-dot" aria-hidden="true">·</span>${b}` : b)}</span></p>`;
  }

  /** Stock photos under CC BY / BY-SA must credit the photographer; a quiet line by the source
   *  instead of a tag on the photo. CC0 / public domain need none. */
  function photoCredit(r) {
    const c = r.imageCredit;
    if (!c?.author || !/^cc by/i.test(c.license || '')) return '';
    const href = safeUrl(c.url), text = `${c.author} · ${c.license}`;
    return html`<p class="rx-line rx-credit"><span class="rx-label">Photo</span><span class="rx-source-bits">${href
      ? html`<a href="${href}" target="_blank" rel="noopener noreferrer">${text}</a>` : html`<span>${text}</span>`}</span></p>`;
  }

  function youCard(entry, photos) {
    const cooked = cookLog(photos).count;
    return html`
      <section class="rx-you" aria-label="Your rating, tags and cooking log">
        <div class="rx-you-row">
          <div class="rx-you-meta">${metaSummary(entry)}</div>
          <button type="button" class="btn btn-ghost rx-you-btn" data-act="meta">${icon('edit')} Edit</button>
        </div>
        <div class="rx-you-row">
          <p class="rx-you-cooked">${cookedLine(photos)}<small>${cooked
            ? 'Each day with a photo in the journal counts as a cook.'
            : 'Add a photo to the journal when you make it, and the day is logged.'}</small></p>
        </div>
      </section>`;
  }

  function details(key, summary, body) {
    return html`
      <details class="rx-details" data-key="${key}" ${openDetails.has(key) ? 'open' : ''}>
        <summary><span>${summary}</span>${icon('chevR', 'rx-chev')}</summary>
        <div class="rx-details-body">${body}</div>
      </details>`;
  }

  function stepsMeta(st, steps) {
    const done = steps.filter(s => st.done.includes(s.id)).length;
    if (!done) return html`<span>Tap a number to check it off</span>`;
    return html`<span>${done} of ${steps.length} done</span><button type="button" class="rx-link-btn" data-act="steps-reset">${icon('reset')} Reset</button>`;
  }

  function stepsHtml(r, st, notes, photos) {
    const done = new Set(st.done);
    const match = mentionMatcher(r.ingredients, { slug });
    let n = 0;
    return groupBySection(r.steps).map((g, gi) => html`
      ${g.section ? html`<h3 class="rx-subhead">${g.section}</h3>` : gi ? html`<hr class="rx-sep">` : ''}
      <ol class="rx-steps">${g.items.map(s => {
        n += 1;
        return stepHtml(s, n, done.has(s.id), notes.filter(x => x.stepId === s.id), photos.filter(p => p.stepId === s.id), st, match);
      })}</ol>`);
  }

  function stepHtml(s, n, isDone, notes, photos, st, match) {
    const open = !!st.open[s.id];
    return html`
      <li class="rx-step${isDone ? ' is-done' : ''}" id="step-${s.id}">
        <button type="button" class="rx-num" data-act="step-done" data-id="${s.id}" aria-pressed="${isDone}" aria-label="Step ${n} done">
          <span class="rx-num-n">${n}</span>${icon('check', 'rx-num-check')}
        </button>
        <div class="rx-step-body">
          <p class="rx-step-text">${stepTextHtml(s, n, { match })}</p>
          ${timerButtonsHtml(s)}
          ${s.tip ? html`<aside class="rx-tip"><span class="rx-tip-label">Why</span>${tempsHtml(s.tip)}</aside>` : ''}
          ${photoThumbsHtml(photos)}
          ${noteListHtml(notes)}
          ${open
            ? composerHtml(s.id, { draft: st.drafts[s.id] || '', placeholder: `What would you change in step ${n}?`, cancel: true, label: `Note on step ${n}` })
            : html`<button type="button" class="rx-addnote" data-act="note-open" data-key="${s.id}">${icon('note')}${notes.length ? 'Add another note' : 'Add note'}</button>`}
        </div>
      </li>`;
  }

  function changelog(r) {
    const log = (r.changelog || []).filter(Boolean);
    // Newest first; entries on the same day keep "last written first".
    const sorted = log.map((c, k) => [c, k]).sort((a, b) => String(b[0].date || '').localeCompare(String(a[0].date || '')) || b[1] - a[1]).map(([c]) => c);
    const body = log.length
      ? html`<ol class="rx-log">${sorted.map(c => html`
          <li><time datetime="${c.date || ''}">${fmtDate(c.date) || c.date || ''}</time><p>${c.summary}</p></li>`)}</ol>`
      : html`<p class="muted small">No changes yet. When Claude folds in your notes, each change is logged here.</p>`;
    return details('changelog', html`Changelog <span class="rx-count-pill">${log.length}</span>`, body);
  }

  /* ---------- actions ---------- */
  async function onClick(e, el) {
    const act = el.dataset.act;
    const r = data?.recipe;
    if (!r) return;
    switch (act) {
      case 'meta':
        try { await editMeta(slug, { title: r.title }); } catch (err) { reportError(err); }
        break;
      case 'step-done': {
        const id = el.dataset.id;
        const st = rxPatch(slug, s => ({ ...s, done: toggleId(s.done, id) }));
        const isDone = st.done.includes(id);
        el.setAttribute('aria-pressed', String(isDone));
        el.closest('.rx-step')?.classList.toggle('is-done', isDone);
        const meta = root.querySelector('[data-steps-meta]');
        if (meta) meta.innerHTML = stepsMeta(st, r.steps || []);
        break;
      }
      case 'steps-reset':
        rxPatch(slug, { done: [], step: null });
        await paint();
        break;
      case 'note-open': {
        const key = el.dataset.key;
        rxPatch(slug, s => ({ ...s, open: { ...s.open, [key]: true } }));
        await paint();
        root.querySelector(`textarea[data-composer="${CSS.escape(key)}"]`)?.focus();
        break;
      }
      case 'note-cancel': {
        const key = el.dataset.key;
        rxPatch(slug, s => { const open = { ...s.open }; delete open[key]; return { ...s, open }; });
        setDraft(slug, key, '');
        await paint();
        root.querySelector(`[data-act="note-open"][data-key="${CSS.escape(key)}"]`)?.focus();
        break;
      }
      case 'note-delete': {
        const entry = (data.journal?.entries || []).find(x => x.id === el.dataset.id);
        if (entry) await confirmDeleteNote({ slug, entry });
        break;
      }
      case 'photo-add':
        if (!isConnected()) return reportError(new NotConnectedError());
        root.querySelector('[data-photo-input]')?.click();
        break;
      case 'photo-open': {
        const entry = (data.journal?.entries || []).find(x => x.id === el.dataset.id);
        if (entry) await openLightbox({ slug, entry, recipe: r });
        break;
      }
      default:
    }
  }

  async function onSubmit(e, form) {
    e.preventDefault();
    const key = form.dataset.composerForm;
    const ta = form.querySelector('textarea');
    const btn = form.querySelector('[type="submit"]');
    const text = ta.value.trim();
    if (!text) { ta.focus(); toast('Write a note first'); return; }
    const step = key === 'recipe' ? null : (data.recipe.steps || []).find(s => s.id === key);
    // Clear the draft first so the store's change event re-renders without it.
    const closeComposer = s => { const drafts = { ...s.drafts }, open = { ...s.open }; delete drafts[key]; delete open[key]; return { ...s, drafts, open }; };
    rxPatch(slug, closeComposer);
    ta.readOnly = true;
    try {
      await busy(btn, addNote(slug, step ? { stepId: step.id, stepText: step.text, text } : { text }));
      toast('Note saved', { type: 'ok' });
    } catch (err) {
      ta.readOnly = false;
      rxPatch(slug, s => ({ ...s, drafts: { ...s.drafts, [key]: ta.value }, open: step ? { ...s.open, [key]: true } : s.open }));
      reportError(err);
    }
  }

  async function onPhotoPicked(e, input) {
    const file = input.files?.[0];
    input.value = '';
    if (!file || !data?.recipe) return;
    if (file.type && !/^image\//.test(file.type)) { toast('That file isn’t an image.', { type: 'error' }); return; }
    await openPhotoUploader({ slug, recipe: data.recipe, file });
  }

  const onToggle = e => {
    const d = e.target;
    if (d?.tagName === 'DETAILS' && d.dataset.key) { if (d.open) openDetails.add(d.dataset.key); else openDetails.delete(d.dataset.key); }
  };

  /* ---------- wiring (after the first paint, so a render you've already left binds nothing) ---------- */
  await paint();
  if (stale()) return;
  timers = bindTimers(root, slug);
  const offs = [
    timers,
    bindIngredients(root, () => data?.recipe, slug),
    bindMentions(root, () => data?.recipe, slug),
    on(root, 'click', '[data-act]', onClick),
    on(root, 'submit', 'form[data-composer-form]', onSubmit),
    on(root, 'input', 'textarea[data-composer]', (e, el) => setDraft(slug, el.dataset.composer, el.value)),
    on(root, 'keydown', 'textarea[data-composer]', (e, el) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); el.form?.requestSubmit(); }
    }),
    on(root, 'change', 'input[data-photo-input]', onPhotoPicked),
    on(document, 'click', '#topbar-back', e => goBack(e, from)),
    onChange(ev => { if (ev.paths?.some(p => mine.has(p))) paint().catch(reportError); })
  ];
  root.addEventListener('toggle', onToggle, true);

  return () => {
    offs.forEach(off => off());
    root.removeEventListener('toggle', onToggle, true);
    io?.disconnect();
    document.body.classList.remove(PAST_TITLE);
  };
}
