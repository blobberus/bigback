/**
 * views/cook.js — step-by-step cook mode (#/r/<slug>/cook).
 * Full screen, one step at a time: progress, large text, the step's timers (+ durations
 * detected in the text), Back/Next in the thumb zone, swipe left/right and ←/→ keys.
 * "Ingredients" opens a sheet with the scaled list (checked state shared with the recipe
 * page). The last step offers a photo (which logs the cook) and a note. The current step is
 * remembered per slug in sessionStorage (components/recipe-state.js), and so are half-typed
 * notes: closing the note sheet keeps the draft (per step, or 'recipe'), shared with the
 * recipe page's composers; a successful save clears it. Next checks the step off on the recipe
 * page; Finish checks off the last one and clears the resume point.
 * A render that is still loading when you move on paints and binds nothing (the router drops
 * the cleanup of a render it has already left).
 * Exit (×), Finish and Esc go back to the recipe page you came from (history.back(), so its ←
 * still leads to your list; components/back-nav.js), else open #/r/<slug>.
 */
import { getRecipe, getJournal, onChange, addNote, NotConnectedError } from '../store.js';
import { setTopbar, on, sheet, toast, reportError, busy } from '../ui.js';
import { html, clamp, localDay } from '../util.js';
import { isConnected } from '../prefs.js';
import { icon } from '../components/recipe-icons.js';
import { rxState, rxPatch, setDraft, toggleId } from '../components/recipe-state.js';
import { ingredientsHtml, bindIngredients } from '../components/recipe-ingredients.js';
import { stepTextHtml, tempsHtml, timerButtonsHtml, bindTimers } from '../components/recipe-steps.js';
import { mentionMatcher, bindMentions } from '../components/recipe-mentions.js';
import { cookedLine, cookLog, clip, openPhotoUploader } from '../components/recipe-journal.js';
import { backTarget, goBack } from '../components/back-nav.js';

let renders = 0;   // newest render of this view

export async function render(root, { slug }) {
  const back = `#/r/${slug}`;
  const me = ++renders, path = location.hash.split('?')[0];
  const stale = () => me !== renders || location.hash.split('?')[0] !== path;
  const from = backTarget(h => h.split('?')[0] === back);
  let [recipe, journal] = await Promise.all([getRecipe(slug), getJournal(slug)]);
  if (stale()) return;

  if (!recipe || !(recipe.steps || []).length) {
    setTopbar({ title: recipe ? recipe.title : 'Recipe not found', back: recipe ? back : '#/' });
    document.body.classList.add('ck-plain');
    root.innerHTML = html`
      <div class="empty rx-missing">
        ${icon('pan', 'rx-missing-ic')}
        <h2>${recipe ? 'No steps to cook yet' : 'We couldn’t find that recipe'}</h2>
        <p>${recipe ? 'This recipe doesn’t have any steps. Add some in the editor.' : 'It may have been renamed or deleted.'}</p>
        <a class="btn btn-primary" href="${recipe ? back : '#/'}">${recipe ? 'Back to recipe' : 'Back to recipes'}</a>
      </div>`;
    return () => document.body.classList.remove('ck-plain');
  }

  let steps = recipe.steps;
  let i = Math.max(0, steps.findIndex(s => s.id === rxState(slug).step));

  function paint(dir = '') {
    steps = recipe.steps || [];
    i = clamp(i, 0, steps.length - 1);
    const s = steps[i], n = i + 1, total = steps.length, last = i === total - 1;
    const next = steps[i + 1];
    const focusAct = root.contains(document.activeElement) ? document.activeElement?.dataset?.act : null;
    setTopbar({ title: `Cooking · ${recipe.title}`, back });
    root.innerHTML = html`
      <div class="ck">
        <header class="ck-top">
          <a class="icon-btn ck-exit" href="${back}" aria-label="Exit cook mode">${icon('close')}</a>
          <div class="ck-where">
            <p class="ck-count">Step ${n} <span>of ${total}</span></p>
            <p class="ck-name">${recipe.title}</p>
          </div>
          <button type="button" class="btn btn-soft ck-ing-btn" data-act="ingredients">${icon('list')}<span>Ingredients</span></button>
          <div class="ck-progress" role="progressbar" aria-label="Progress" aria-valuemin="1" aria-valuemax="${total}" aria-valuenow="${n}">
            <span style="transform: scaleX(${n / total})"></span>
          </div>
        </header>

        <article class="ck-step" data-dir="${dir}" aria-live="polite" aria-label="Step ${n} of ${total}">
          ${s.section ? html`<p class="ck-section">${s.section}</p>` : ''}
          <p class="ck-text">${stepTextHtml(s, n, { match: mentionMatcher(recipe.ingredients, { slug }) })}</p>
          ${timerButtonsHtml(s)}
          ${s.tip ? html`<aside class="rx-tip ck-tip"><span class="rx-tip-label">Why</span>${tempsHtml(s.tip)}</aside>` : ''}
          ${last ? doneCard() : ''}
          <button type="button" class="rx-addnote ck-note" data-act="step-note">${icon('note')}Note on this step</button>
          ${next ? html`<p class="ck-upnext"><span>Up next</span>${clip(next.text, 90)}</p>` : ''}
        </article>

        <nav class="ck-nav" aria-label="Steps">
          <button type="button" class="btn ck-prev" data-act="prev" ${i === 0 ? 'disabled' : ''}>${icon('chevL')}<span>Back</span></button>
          ${last
            ? html`<a class="btn ck-next ck-finish" href="${back}" data-act="finish"><span>Finish</span>${icon('check')}</a>`
            : html`<button type="button" class="btn btn-primary ck-next" data-act="next"><span>Next</span>${icon('chevR')}</button>`}
        </nav>
      </div>`;
    timers.refresh();
    if (focusAct) (root.querySelector(`[data-act="${focusAct}"]:not([disabled])`) || root.querySelector('[data-act="next"], [data-act="finish"]'))?.focus({ preventScroll: true });
  }

  function doneCard() {
    const entries = journal?.entries || [];
    const logged = cookLog(entries).last === localDay();
    return html`
      <section class="ck-done" aria-label="Finished">
        <h2 class="ck-done-title">${logged ? 'Logged — enjoy it' : 'Done — enjoy it'}</h2>
        <p class="ck-done-sub">${cookedLine(entries)}${logged ? '' : '. A photo logs today’s cook.'}</p>
        <div class="ck-done-actions">
          <button type="button" class="btn ${logged ? '' : 'btn-primary'}" data-act="photo">${icon('camera')} ${logged ? 'Add another photo' : 'Add a photo'}</button>
          <button type="button" class="btn" data-act="recipe-note">${icon('note')} Add a note</button>
        </div>
        <input type="file" accept="image/*" class="sr-only" data-photo-input tabindex="-1" aria-hidden="true">
      </section>`;
  }

  function go(delta) {
    const j = clamp(i + delta, 0, steps.length - 1);
    if (j === i) return;
    // Moving on counts as finishing the step — the recipe page shows it checked off.
    if (delta > 0) rxPatch(slug, s => ({ ...s, done: toggleId(s.done, steps[i].id, true) }));
    i = j;
    rxPatch(slug, { step: steps[i].id });
    paint(delta > 0 ? 'next' : 'prev');
    window.scrollTo(0, 0);
  }

  async function openIngredients() {
    const body = document.createElement('div');
    body.className = 'ck-ing';
    body.innerHTML = html`<div data-ingredients>${ingredientsHtml(recipe, slug)}</div>`;
    let off = null;
    await sheet({
      title: 'Ingredients', body, className: 'ck-ing-sheet',
      actions: [{ label: 'Back to step', value: true, kind: 'primary' }],
      onOpen: wrap => { off = bindIngredients(wrap, () => recipe, slug); }
    });
    off?.();
  }

  function writeNote(step) {
    if (!isConnected()) return reportError(new NotConnectedError());
    const key = step ? step.id : 'recipe';
    const title = step ? `Note on step ${steps.indexOf(step) + 1}` : 'Note on this recipe';
    const draft = rxState(slug).drafts[key] || '';
    const body = html`
      <form class="ck-note-form">
        <label class="sr-only" for="ck-note-text">${title}</label>
        <textarea id="ck-note-text" class="input" rows="4" autofocus
          placeholder="${step ? 'What would you change in this step?' : 'How did it go? Anything to change next time?'}">${draft}</textarea>
        ${draft ? html`<p class="ck-note-hint">${icon('note')}<span>Picked up your unsaved draft.</span></p>` : ''}
        <div class="sheet-actions">
          <button type="button" class="btn btn-ghost" data-note="close">Close</button>
          <button type="submit" class="btn btn-primary">Save note</button>
        </div>
      </form>`;
    let closed = false;
    const done = sheet({
      title, body, className: 'ck-note-sheet',
      onOpen(wrap, close) {
        const form = wrap.querySelector('form');
        const ta = form.querySelector('textarea');
        const btn = form.querySelector('[type="submit"]');
        ta.setSelectionRange(ta.value.length, ta.value.length);
        // Every keystroke is kept, so a swipe/tap-away/Close never loses the note.
        ta.addEventListener('input', () => setDraft(slug, key, ta.value.trim() ? ta.value : ''));
        ta.addEventListener('keydown', e => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); form.requestSubmit(); }
        });
        wrap.querySelector('[data-note="close"]').addEventListener('click', () => close(null));
        form.addEventListener('submit', async e => {
          e.preventDefault();
          if (btn.disabled) return;
          const text = ta.value.trim();
          if (!text) { ta.focus(); toast('Write a note first'); return; }
          ta.readOnly = true;
          try {
            await busy(btn, addNote(slug, step ? { stepId: step.id, stepText: step.text, text } : { text }));
            rxPatch(slug, s => {
              const drafts = { ...s.drafts }, open = { ...s.open };
              delete drafts[key]; delete open[key];
              return { ...s, drafts, open };
            });
            toast('Note saved — Claude picks it up on the next “update the site”', { type: 'ok' });
            if (!closed) close(true);   // it may have been dismissed while saving
          } catch (err) {
            ta.readOnly = false;
            reportError(err);
          }
        });
      }
    });
    done.then(() => { closed = true; });
    return done;
  }

  async function onPhotoPicked(e, input) {
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    if (file.type && !/^image\//.test(file.type)) { toast('That file isn’t an image.', { type: 'error' }); return; }
    await openPhotoUploader({ slug, recipe, file });
    refocus('photo');
  }

  /** Saving from a sheet re-renders the step under it, so the button that opened the sheet is
   *  gone and focus fell to the page: hand it to the re-rendered button. */
  const refocus = act => {
    const a = document.activeElement;
    if (!a || a === document.body || a === root) root.querySelector(`[data-act="${act}"]`)?.focus({ preventScroll: true });
  };

  /* ---------- input ---------- */
  const onClick = async (e, el) => {
    switch (el.dataset.act) {
      case 'next': return go(1);
      case 'prev': return go(-1);
      case 'ingredients': return openIngredients();
      case 'step-note': return Promise.resolve(writeNote(steps[i])).then(() => refocus('step-note'));
      case 'recipe-note': return Promise.resolve(writeNote(null)).then(() => refocus('recipe-note'));
      case 'photo':
        if (!isConnected()) return reportError(new NotConnectedError());
        return root.querySelector('[data-photo-input]')?.click();
      case 'finish':   // the last step is done too, and there's nothing left to resume
        rxPatch(slug, s => ({ ...s, done: toggleId(s.done, steps[i].id, true), step: null }));
        break;
      default:
    }
  };

  let sx = null, sy = 0, st0 = 0;
  const onTouchStart = e => {
    if (e.touches.length !== 1) { sx = null; return; }
    sx = e.touches[0].clientX; sy = e.touches[0].clientY; st0 = Date.now();
  };
  const onTouchEnd = e => {
    if (sx == null) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - sx, dy = t.clientY - sy;
    sx = null;
    if (Math.abs(dx) > 56 && Math.abs(dx) > Math.abs(dy) * 1.6 && Date.now() - st0 < 900) go(dx < 0 ? 1 : -1);
  };
  const onKey = e => {
    if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
    if (document.querySelector('.sheet-backdrop')) return;
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '')) return;
    if (e.key === 'ArrowRight' || e.key === 'PageDown') { e.preventDefault(); go(1); }
    else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); go(-1); }
    else if (e.key === 'Escape' && !goBack(null, from)) location.hash = back;
  };

  const timers = bindTimers(root, slug);
  const offs = [
    timers,
    bindMentions(root, () => recipe, slug),
    on(root, 'click', '[data-act]', onClick),
    on(root, 'click', `a[href="${back}"]`, e => goBack(e, from)),   // × and Finish
    on(root, 'change', 'input[data-photo-input]', onPhotoPicked),
    onChange(async ev => {
      if (!ev.paths?.some(p => p === `recipes/${slug}.json` || p === `journal/${slug}.json`)) return;
      const [r, j] = await Promise.all([getRecipe(slug), getJournal(slug)]);
      if (stale()) return;
      if (r?.steps?.length) {
        const id = steps[i]?.id;
        recipe = r;
        const k = r.steps.findIndex(s => s.id === id);
        if (k > -1) i = k;
      }
      journal = j;
      paint();
    })
  ];
  root.addEventListener('touchstart', onTouchStart, { passive: true });
  root.addEventListener('touchend', onTouchEnd, { passive: true });
  document.addEventListener('keydown', onKey);

  rxPatch(slug, { step: steps[i].id });
  paint();

  return () => {
    offs.forEach(off => off());
    root.removeEventListener('touchstart', onTouchStart);
    root.removeEventListener('touchend', onTouchEnd);
    document.removeEventListener('keydown', onKey);
  };
}
