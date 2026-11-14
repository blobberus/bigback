/**
 * views/cook.js — step-by-step cook mode (#/r/<slug>/cook).
 * Full screen, one step at a time: progress, large text, the step's timers (+ durations
 * detected in the text), Back/Next in the thumb zone, swipe left/right and ←/→ keys.
 * "Ingredients" opens a sheet with the scaled list (checked state shared with the recipe
 * page). The last step offers "mark as cooked" and a note shortcut. The current step is
 * remembered per slug in sessionStorage (components/recipe-state.js).
 */
import { getRecipe, getLibrary, entryFor, onChange, markCooked, addNote, NotConnectedError } from '../store.js';
import { setTopbar, on, sheet, toast, reportError, promptSheet, confirmSheet } from '../ui.js';
import { html, clamp } from '../util.js';
import { isConnected } from '../prefs.js';
import { icon } from '../components/recipe-icons.js';
import { rxState, rxPatch, toggleId } from '../components/recipe-state.js';
import { ingredientsHtml, bindIngredients } from '../components/recipe-ingredients.js';
import { stepTextHtml, timerButtonsHtml, bindTimers } from '../components/recipe-steps.js';
import { cookedLine, clip } from '../components/recipe-journal.js';

const RECENT = 12 * 3600e3;   // one "I cooked this" per session-ish

export async function render(root, { slug }) {
  const back = `#/r/${slug}`;
  let [recipe, lib] = await Promise.all([getRecipe(slug), getLibrary()]);
  let entry = entryFor(lib, slug);

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
          <p class="ck-text">${stepTextHtml(s, n)}</p>
          ${timerButtonsHtml(s)}
          ${s.tip ? html`<aside class="rx-tip ck-tip"><span class="rx-tip-label">Why</span>${s.tip}</aside>` : ''}
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
    const logged = rxState(slug).cookedAt && Date.now() - rxState(slug).cookedAt < RECENT;
    return html`
      <section class="ck-done" aria-label="Finished">
        <h2 class="ck-done-title">${logged ? 'Logged — enjoy it' : 'Done — mark as cooked?'}</h2>
        <p class="ck-done-sub">${cookedLine(entry)}</p>
        <div class="ck-done-actions">
          ${logged
            ? html`<button type="button" class="btn ck-logged" data-act="cooked">${icon('check')} Cooked today</button>`
            : html`<button type="button" class="btn btn-primary" data-act="cooked">${icon('check')} Mark as cooked</button>`}
          <button type="button" class="btn" data-act="recipe-note">${icon('note')} Add a note</button>
        </div>
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

  async function writeNote(step) {
    if (!isConnected()) return reportError(new NotConnectedError());
    const n = step ? steps.indexOf(step) + 1 : 0;
    const text = await promptSheet(step ? `Note on step ${n}` : 'Note on this recipe', {
      multiline: true, ok: 'Save note',
      placeholder: step ? 'What would you change in this step?' : 'How did it go? Anything to change next time?'
    });
    if (!text) return;
    try {
      await addNote(slug, step ? { stepId: step.id, stepText: step.text, text } : { text });
      toast('Note saved — Claude picks it up on the next “update the site”', { type: 'ok' });
    } catch (err) {
      reportError(err);
    }
  }

  async function logCooked() {
    const st = rxState(slug);
    if (st.cookedAt && Date.now() - st.cookedAt < RECENT) {
      const again = await confirmSheet('You already logged a cook of this recipe today.', { title: 'Log another cook?', ok: 'Log it' });
      if (!again) return;
    }
    try {
      markCooked(slug);
      rxPatch(slug, { cookedAt: Date.now() });
      toast('Logged — nice cooking', { type: 'ok' });
      paint();
    } catch (err) {
      reportError(err);
    }
  }

  /* ---------- input ---------- */
  const onClick = async (e, el) => {
    switch (el.dataset.act) {
      case 'next': return go(1);
      case 'prev': return go(-1);
      case 'ingredients': return openIngredients();
      case 'step-note': return writeNote(steps[i]);
      case 'recipe-note': return writeNote(null);
      case 'cooked': return logCooked();
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
    else if (e.key === 'Escape') location.hash = back;
  };

  const timers = bindTimers(root, slug);
  const offs = [
    timers,
    on(root, 'click', '[data-act]', onClick),
    onChange(async ev => {
      if (!ev.paths?.some(p => p === `recipes/${slug}.json` || p === 'data/library.json')) return;
      const [r, l] = await Promise.all([getRecipe(slug), getLibrary()]);
      if (r?.steps?.length) {
        const id = steps[i]?.id;
        recipe = r;
        const k = r.steps.findIndex(s => s.id === id);
        if (k > -1) i = k;
      }
      entry = entryFor(l, slug);
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
