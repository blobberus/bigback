/**
 * components/editor-form.js — the recipe form behind #/add/custom and #/edit/<slug> (WS3).
 *   mountRecipeForm(root, { recipe }) → cleanup()
 *     recipe null → new custom recipe: status 'custom', source custom, ids i1… / s1…
 *     recipe set  → edit: keeps status/source/changelog/createdAt/image (unless the photo is
 *                   replaced or removed) and every ingredient/step id (editor-ids.js; journal
 *                   stepIds are reserved so a removed step's id is never handed out again).
 *   Ingredients/steps are fast textareas with a live parsed preview (editor-parse.js).
 *   Drafts autosave per form (editor-drafts.js) and are offered back on return.
 */
import { html, fmtMinutes, debounce, parseDurations } from '../util.js';
import { $, $$, on, toast, busy, confirmSheet, reportError } from '../ui.js';
import { saveRecipe, deleteRecipe, getJournal, mediaUrl, rawUrl, NotConnectedError } from '../store.js';
import { isConnected } from '../prefs.js';
import { parseIngredients, parseSteps, formatIngredients, formatSteps, formatIngredientLine, parseLines } from './editor-parse.js';
import { mergeIngredients, mergeSteps } from './editor-ids.js';
import { icon } from './editor-icons.js';
import { draftKey, loadDraft, saveDraft, clearDraft, draftAge } from './editor-drafts.js';

const FIELDS = ['title', 'summary', 'servings', 'yield', 'prep', 'cook', 'total', 'ingredients', 'steps', 'equipment', 'profile'];
const str = v => (v == null ? '' : String(v));

function stateFrom(r) {
  if (!r) return { ...Object.fromEntries(FIELDS.map(f => [f, ''])), totalAuto: true };
  const t = r.time || {};
  return {
    title: r.title || '', summary: r.summary || '', servings: str(r.servings), yield: r.yield || '',
    prep: str(t.prep), cook: str(t.cook), total: str(t.total),
    totalAuto: t.total == null || ((t.prep != null || t.cook != null) && t.total === (t.prep || 0) + (t.cook || 0)),
    ingredients: formatIngredients(r.ingredients || []), steps: formatSteps(r.steps || []),
    equipment: (r.equipment || []).join('\n'), profile: r.profile || ''
  };
}
const sameState = (a, b) => FIELDS.every(f => str(a?.[f]).trim() === str(b?.[f]).trim());

/** "45" → 45 · "1:30" → 90 · "1 hr 20 min" → 80 · "" → null */
export function minutes(v) {
  const s = str(v).trim();
  if (!s) return null;
  if (/^\d+(?:\.\d+)?$/.test(s)) return Math.round(+s);
  const hm = s.match(/^(\d+):(\d{1,2})$/);
  if (hm) return +hm[1] * 60 + +hm[2];
  const d = parseDurations(s);
  if (d.length) return Math.round(d.reduce((a, x) => a + x.seconds, 0) / 60);
  const n = parseFloat(s);
  return Number.isFinite(n) ? Math.round(n) : null;
}
const number = v => { const n = parseFloat(str(v).replace(',', '.')); return Number.isFinite(n) && n > 0 ? n : null; };
const autoTotal = (prep, cook) => (prep == null && cook == null ? null : (prep || 0) + (cook || 0));

function fmtSeconds(s) {
  if (s < 60) return `${s} sec`;
  const m = Math.floor(s / 60), rest = s % 60;
  return rest ? `${fmtMinutes(m)} ${rest} sec` : fmtMinutes(m);
}

/** Build the recipe object to save from the form state (pure apart from Date in the store). */
export function buildRecipe(s, base, { reserved = [], removeImage = false, hasNewPhoto = false } = {}) {
  const ingredients = mergeIngredients(parseIngredients(s.ingredients), base?.ingredients || []);
  const steps = mergeSteps(parseSteps(s.steps), base?.steps || [], reserved);
  const prep = minutes(s.prep), cook = minutes(s.cook);
  const total = minutes(s.total) ?? autoTotal(prep, cook);
  const profile = s.profile.trim() || (base && base.profile == null ? null : '');
  const content = {
    title: s.title.trim(), summary: s.summary.trim().replace(/\s*\n\s*/g, ' '), profile,
    servings: number(s.servings), yield: s.yield.trim() || null, time: { prep, cook, total },
    equipment: parseLines(s.equipment), ingredients, steps
  };
  if (base) return { ...base, ...content, image: removeImage && !hasNewPhoto ? null : (base.image ?? null) };
  return {
    schemaVersion: 1, slug: null, title: content.title, summary: content.summary, profile: content.profile,
    status: 'custom', source: { type: 'custom', url: null, files: [], author: null }, image: null,
    servings: content.servings, yield: content.yield, time: content.time, equipment: content.equipment,
    ingredients, steps, createdAt: null, updatedAt: null, changelog: []
  };
}

export function validate(s, base) {
  const errs = {};
  if (!s.title.trim()) errs.title = 'Give your recipe a name.';
  if (!parseIngredients(s.ingredients).length) errs.ingredients = 'Add at least one ingredient, one per line.';
  if (!parseSteps(s.steps).length) errs.steps = 'Add at least one step.';
  if (base?.status === 'built' && base.profile && !s.profile.trim()) errs.profile = 'Built recipes keep their flavor profile. Edit it rather than clearing it.';
  return errs;
}

/* ---------- previews ---------- */
const amountOf = it => formatIngredientLine({ qty: it.qty, qtyMax: it.qtyMax, unit: it.unit }).replace(/(\d)-(\d|[½⅓⅔¼¾⅛⅜⅝⅞])/, '$1–$2');

function ingredientPreview(list) {
  if (!list.length) return '';
  const rows = [];
  let sec = null;
  for (const it of list) {
    if (it.section !== sec) {
      rows.push(it.section ? html`<li class="ed-pv-sec">${it.section}</li>` : html`<li class="ed-pv-gap" aria-hidden="true"></li>`);
      sec = it.section;
    }
    const amt = amountOf(it);
    rows.push(html`<li class="ed-pv-ing">
      <span class="ed-pv-amt${amt ? '' : ' is-none'}">${amt || '—'}</span>
      <span class="ed-pv-item">${it.item}${it.note ? html`<span class="ed-pv-note">, ${it.note}</span>` : ''}</span>
    </li>`);
  }
  return html`<p class="ed-pv-label">Preview</p><ul class="ed-pv-list">${rows}</ul>`;
}

function stepsPreview(list) {
  if (!list.length) return '';
  const rows = [];
  let sec = null;
  list.forEach((s, i) => {
    if (s.section !== sec) {
      rows.push(s.section ? html`<li class="ed-pv-sec">${s.section}</li>` : html`<li class="ed-pv-gap" aria-hidden="true"></li>`);
      sec = s.section;
    }
    rows.push(html`<li class="ed-pv-step">
      <span class="ed-pv-num" aria-hidden="true">${i + 1}</span>
      <div class="ed-pv-body">
        <p>${s.text}</p>
        ${s.timers.length ? html`<div class="ed-timers">${s.timers.map(t => html`<span class="ed-timer">${icon('timer')}${fmtSeconds(t.seconds)}<span class="ed-timer-l">${t.label}</span></span>`)}</div>` : ''}
        ${s.tip ? html`<p class="ed-pv-tip"><strong>Tip</strong> ${s.tip}</p>` : ''}
      </div>
    </li>`);
  });
  return html`<p class="ed-pv-label">Preview</p><ol class="ed-pv-list ed-pv-steps">${rows}</ol>`;
}

/* ---------- markup ---------- */
const ING_PLACEHOLDER = '1 1/2 cups flour, sifted\n2-3 cloves garlic, minced\n1 (14 oz) can tomatoes\nsalt and pepper to taste\n\nSauce:\n2 tbsp soy sauce';
const STEP_PLACEHOLDER = 'Heat the oven to 425°F.\n\nRoast the vegetables for 25 minutes, until browned at the edges.\nTip: give them room on the pan so they brown, not steam.\n\nSauce:\n\nWhisk everything together and simmer 2 minutes.';
const opt = (t = 'optional') => html`<span class="ed-opt">${t}</span>`;

export function connectBanner(sub = 'Keep going — your draft stays on this device.') {
  return html`<a class="ed-banner ed-banner-connect" href="#/settings">
    <span class="ed-banner-ic">${icon('plug')}</span>
    <span class="ed-banner-body"><strong>Connect GitHub in Settings to save</strong><span>${sub}</span></span>
    ${icon('chevron', 'ed-banner-chev')}
  </a>`;
}

function formHtml(st, recipe) {
  const editing = !!recipe;
  return html`
    ${isConnected() ? '' : connectBanner()}
    <div class="ed-banner ed-banner-draft" data-draft hidden></div>
    <form class="ed" novalidate autocomplete="off" data-form>
      <section class="ed-sec ed-sec-basics">
        <div class="field">
          <label for="ed-title">Title</label>
          <textarea id="ed-title" name="title" class="input ed-title" rows="1" data-grow data-oneline required placeholder="Grandma’s Sunday lasagna"
            autocapitalize="words" enterkeyhint="next" spellcheck="true" aria-describedby="ed-err-title">${st.title}</textarea>
          <p class="ed-err" id="ed-err-title" data-err="title" hidden></p>
        </div>
        <div class="field">
          <label for="ed-summary">Summary ${opt()}</label>
          <textarea id="ed-summary" name="summary" class="input ed-short" rows="2" data-grow data-oneline
            placeholder="One line that makes you want to cook it" autocapitalize="sentences" enterkeyhint="next">${st.summary}</textarea>
        </div>
        <div class="ed-row2">
          <div class="field">
            <label for="ed-servings">Servings</label>
            <input id="ed-servings" name="servings" class="input" value="${st.servings}" inputmode="decimal" placeholder="4" enterkeyhint="next">
          </div>
          <div class="field">
            <label for="ed-yield">Yield ${opt()}</label>
            <input id="ed-yield" name="yield" class="input" value="${st.yield}" placeholder="12 cookies" autocapitalize="none" enterkeyhint="next">
          </div>
        </div>
        <fieldset class="ed-times">
          <legend class="label">Time ${opt('minutes')}</legend>
          <div class="ed-row3">
            ${[['prep', 'Prep'], ['cook', 'Cook'], ['total', 'Total']].map(([k, label]) => html`
              <label class="ed-time"><span>${label}</span>
                <input name="${k}" class="input" value="${st[k]}" inputmode="numeric" placeholder="${k === 'total' ? 'auto' : '0'}" enterkeyhint="next">
              </label>`)}
          </div>
          <p class="hint ed-time-hint" data-time-hint></p>
        </fieldset>
      </section>

      <section class="ed-sec">
        <h2 class="ed-h">Photo ${opt()}</h2>
        <div class="ed-photo" data-photo></div>
      </section>

      <section class="ed-sec">
        <div class="ed-h-row"><h2 class="ed-h"><label for="ed-ing">Ingredients</label></h2><span class="ed-count" data-count="ingredients"></span></div>
        <p class="hint">One per line. A line ending in a colon, like <q>Sauce:</q>, starts a section; <q>---</q> ends it.</p>
        <textarea id="ed-ing" name="ingredients" class="input ed-lines" rows="7" data-grow placeholder="${ING_PLACEHOLDER}"
          autocapitalize="none" autocorrect="off" spellcheck="true" aria-describedby="ed-err-ingredients">${st.ingredients}</textarea>
        <p class="ed-err" id="ed-err-ingredients" data-err="ingredients" hidden></p>
        <div class="ed-pv" data-preview="ingredients" aria-live="polite"></div>
      </section>

      <section class="ed-sec">
        <div class="ed-h-row"><h2 class="ed-h"><label for="ed-steps">Steps</label></h2><span class="ed-count" data-count="steps"></span></div>
        <p class="hint">A blank line between steps (or one step per line). Times like <q>25 minutes</q> become timers; start a line with <q>Tip:</q> for a tip. Sections work like ingredients.${editing ? ' Your notes stay attached to their steps.' : ''}</p>
        <textarea id="ed-steps" name="steps" class="input ed-lines" rows="9" data-grow placeholder="${STEP_PLACEHOLDER}"
          autocapitalize="sentences" spellcheck="true" aria-describedby="ed-err-steps">${st.steps}</textarea>
        <p class="ed-err" id="ed-err-steps" data-err="steps" hidden></p>
        <div class="ed-pv" data-preview="steps" aria-live="polite"></div>
      </section>

      <section class="ed-sec">
        <h2 class="ed-h"><label for="ed-equip">Equipment</label> ${opt()}</h2>
        <p class="hint">One per line.</p>
        <textarea id="ed-equip" name="equipment" class="input ed-short" rows="2" data-grow placeholder="${'12-inch skillet\nInstant-read thermometer'}"
          autocapitalize="sentences" spellcheck="true">${st.equipment}</textarea>
      </section>

      <section class="ed-sec">
        <details class="ed-more" data-profile ${st.profile ? 'open' : ''}>
          <summary><span>Flavor profile</span> ${opt()}</summary>
          <p class="hint">Salt, fat, acid, heat, texture, what you end up with. Leave it blank and Claude writes one the next time you say <q>update the site</q>.</p>
          <textarea name="profile" class="input" rows="4" data-grow aria-label="Flavor profile" aria-describedby="ed-err-profile"
            autocapitalize="sentences" spellcheck="true">${st.profile}</textarea>
          <p class="ed-err" id="ed-err-profile" data-err="profile" hidden></p>
        </details>
      </section>

      <div class="ed-savebar">
        <span class="ed-status" data-status aria-live="polite"></span>
        <button type="submit" class="btn btn-primary ed-save" data-save>${icon('check')}<span>${editing ? 'Save changes' : 'Save recipe'}</span></button>
      </div>
    </form>
    ${editing ? html`
      <section class="ed-danger" aria-labelledby="ed-danger-h">
        <h2 class="ed-danger-h" id="ed-danger-h">Danger zone</h2>
        <p>Deleting removes this recipe, its photos and its journal notes from your vault. Git history keeps a copy.</p>
        <button type="button" class="btn ed-btn-danger" data-act="delete">${icon('trash')}<span>Delete recipe</span></button>
      </section>` : ''}`;
}

/* ---------- component ---------- */
export function mountRecipeForm(root, { recipe = null } = {}) {
  const key = recipe ? draftKey.edit(recipe.slug) : draftKey.new;
  const initial = stateFrom(recipe);
  let totalAuto = initial.totalAuto, heroFile = null, heroUrl = null, removeImage = false;
  let saved = false, touched = false;
  let pendingDraft = loadDraft(key);
  if (pendingDraft && sameState(pendingDraft, initial)) { clearDraft(key); pendingDraft = null; }

  root.innerHTML = formHtml(initial, recipe);
  const form = $('[data-form]', root);
  const field = name => form.elements.namedItem(name);
  const grow = ta => { ta.style.height = 'auto'; ta.style.height = `${ta.scrollHeight + 2}px`; };
  const growAll = () => $$('[data-grow]', form).forEach(grow);

  const readState = () => ({ ...Object.fromEntries(FIELDS.map(f => [f, field(f)?.value ?? ''])), totalAuto });
  function applyState(s) {
    FIELDS.forEach(f => { const el = field(f); if (el) el.value = str(s[f]); });
    totalAuto = s.totalAuto ?? !str(s.total).trim();
    if (str(s.profile).trim()) $('[data-profile]', form).open = true;
    if (totalAuto) fillTotal();
    paintIng(); paintSteps(); paintTimeHint(); growAll();
  }

  /* times */
  function fillTotal() {
    const t = autoTotal(minutes(field('prep').value), minutes(field('cook').value));
    field('total').value = t == null ? '' : String(t);
  }
  function paintTimeHint() {
    const total = minutes(field('total').value);
    const el = $('[data-time-hint]', form);
    el.textContent = total == null ? 'Total adds up prep + cook unless you change it.'
      : `${fmtMinutes(total)} in all${totalAuto ? ' · prep + cook' : ''}`;
  }

  /* previews */
  const paint = (name, list, render) => {
    $(`[data-preview="${name}"]`, form).innerHTML = render(list);
    $(`[data-count="${name}"]`, form).textContent = list.length ? String(list.length) : '';
  };
  // In edit mode preview what will be saved: unchanged lines keep their stored fields / curated timers.
  const paintIng = () => {
    const list = parseIngredients(field('ingredients').value);
    paint('ingredients', recipe ? mergeIngredients(list, recipe.ingredients) : list, ingredientPreview);
  };
  const paintSteps = () => {
    const list = parseSteps(field('steps').value);
    paint('steps', recipe ? mergeSteps(list, recipe.steps) : list, stepsPreview);
  };
  const paintIngSoon = debounce(paintIng, 120), paintStepsSoon = debounce(paintSteps, 120);

  /* photo */
  function paintPhoto() {
    const existing = recipe?.image && !removeImage ? recipe.image : null;
    const img = heroUrl ? html`<img src="${heroUrl}" alt="New photo preview">`
      : existing ? html`<img src="${mediaUrl(existing)}" data-fallback="${rawUrl(existing)}" alt="Current photo">` : null;
    $('[data-photo]', form).innerHTML = html`
      <label class="ed-photo-pick${img ? ' has-img' : ''}">
        <input type="file" accept="image/*" class="sr-only" data-hero aria-label="${img ? 'Change photo' : 'Add a photo'}">
        ${img || html`<span class="ed-photo-empty">${icon('camera')}<strong>Add a photo</strong><span>Take one or choose from your library</span></span>`}
      </label>
      ${img ? html`<div class="ed-photo-bar">
          <span class="hint">${heroFile ? 'New photo · resized before upload' : 'Current photo'}</span>
          <button type="button" class="btn btn-ghost btn-sm" data-act="photo-change">Change</button>
          <button type="button" class="btn btn-ghost btn-sm" data-act="photo-remove">Remove</button>
        </div>`
      : recipe?.image && removeImage ? html`<div class="ed-photo-bar">
          <span class="hint">The current photo will be removed when you save.</span>
          <button type="button" class="btn btn-ghost btn-sm" data-act="photo-restore">Undo</button>
        </div>` : ''}`;
  }
  function setHero(file) {
    if (heroUrl) URL.revokeObjectURL(heroUrl);
    heroFile = file || null;
    heroUrl = heroFile ? URL.createObjectURL(heroFile) : null;
    paintPhoto();
  }

  /* drafts */
  const status = msg => { $('[data-status]', form).textContent = msg; };
  function persistDraft() {
    if (saved || !touched) return;
    const s = readState();
    if (sameState(s, initial)) { clearDraft(key); status(''); return; }
    if (saveDraft(key, s)) status('Draft saved on this device');
  }
  const persistSoon = debounce(persistDraft, 500);
  function paintDraftBanner() {
    const el = $('[data-draft]', root);
    if (!pendingDraft) { el.hidden = true; el.innerHTML = ''; return; }
    el.hidden = false;
    el.innerHTML = html`
      <span class="ed-banner-ic">${icon('history')}</span>
      <span class="ed-banner-body"><strong>Restore your draft?</strong>
        <span>Unsaved ${recipe ? 'changes' : 'recipe'} from ${draftAge(pendingDraft.savedAt)}${pendingDraft.title && !recipe ? ` · ${pendingDraft.title}` : ''}</span></span>
      <span class="ed-banner-acts">
        <button type="button" class="btn btn-sm btn-primary" data-act="draft-restore">Restore</button>
        <button type="button" class="btn btn-sm btn-ghost" data-act="draft-discard">Discard</button>
      </span>`;
  }

  /* errors */
  function showErrors(errs) {
    $$('[data-err]', form).forEach(p => {
      const msg = errs[p.dataset.err];
      p.hidden = !msg; p.textContent = msg || '';
      field(p.dataset.err)?.toggleAttribute('aria-invalid', !!msg);
    });
    const first = FIELDS.find(f => errs[f]);
    if (first) {
      if (first === 'profile') $('[data-profile]', form).open = true;
      const el = field(first);
      el.focus({ preventScroll: true });
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }
  const clearErr = name => {
    const p = $(`[data-err="${name}"]`, form);
    if (p && !p.hidden) { p.hidden = true; field(name)?.removeAttribute('aria-invalid'); }
  };

  /* save / delete */
  async function doSave(s) {
    if (!isConnected()) throw new NotConnectedError();
    let reserved = [];
    if (recipe) {
      try { reserved = (await getJournal(recipe.slug, { force: true })).entries.map(e => e.stepId).filter(Boolean); }
      catch { /* best effort: ids still never go below the recipe's own max */ }
    }
    const r = buildRecipe(s, recipe, { reserved, removeImage, hasNewPhoto: !!heroFile });
    return saveRecipe(r, { heroFile, isNew: !recipe });
  }
  async function save(btn) {
    const s = readState();
    const errs = validate(s, recipe);
    showErrors(errs);
    if (Object.keys(errs).length) return;
    try {
      const slug = await busy(btn, doSave(s));
      saved = true; clearDraft(key);
      toast(recipe ? 'Changes saved' : 'Recipe saved', { type: 'ok' });
      location.hash = `#/r/${slug}`;
    } catch (e) {
      touched = true; persistDraft();
      reportError(e);
    }
  }
  async function remove(btn) {
    const ok = await confirmSheet(`“${recipe.title}” will be removed along with its photos and journal notes.`,
      { title: 'Delete this recipe?', ok: 'Delete recipe', danger: true });
    if (!ok) return;
    try {
      await busy(btn, deleteRecipe(recipe.slug));
      saved = true; clearDraft(key);
      toast('Recipe deleted', { type: 'ok' });
      location.hash = '#/';
    } catch (e) { reportError(e); }
  }

  /* events */
  const offs = [
    on(form, 'input', 'input, textarea', (e, el) => {
      if (el.type === 'file') return;
      touched = true;
      if (el.matches('[data-grow]')) grow(el);
      const name = el.name;
      if ((name === 'prep' || name === 'cook') && totalAuto) fillTotal();
      if (name === 'total') totalAuto = !el.value.trim();
      if (name === 'prep' || name === 'cook' || name === 'total') paintTimeHint();
      if (name === 'ingredients') paintIngSoon();
      if (name === 'steps') paintStepsSoon();
      clearErr(name);
      persistSoon();
    }),
    on(form, 'focusout', 'input[name="total"]', () => { if (totalAuto) { fillTotal(); paintTimeHint(); } }),
    on(form, 'change', '[data-hero]', (e, el) => {
      const f = el.files?.[0];
      if (!f) return;
      if (!/^image\//.test(f.type) && !/\.(heic|heif|jpe?g|png|webp|avif)$/i.test(f.name)) { toast('That doesn’t look like a photo.', { type: 'error' }); return; }
      removeImage = false;
      setHero(f);
    }),
    on(form, 'keydown', 'input, [data-oneline]', (e, el) => {
      if (e.key !== 'Enter' || e.isComposing || el.type === 'file') return;
      e.preventDefault();
      const items = $$('input:not([type="file"]), textarea, button[type="submit"]', form).filter(x => x.offsetParent !== null);
      items[items.indexOf(el) + 1]?.focus();
    }),
    on(form, 'submit', 'form, [data-form]', e => { e.preventDefault(); save($('[data-save]', form)); }),
    on(root, 'click', '[data-act]', (e, el) => {
      const act = el.dataset.act;
      if (act === 'photo-change') $('[data-hero]', form)?.click();
      else if (act === 'photo-remove') { if (heroFile) setHero(null); else { removeImage = true; paintPhoto(); } }
      else if (act === 'photo-restore') { removeImage = false; paintPhoto(); }
      else if (act === 'draft-restore') { const d = pendingDraft; pendingDraft = null; paintDraftBanner(); applyState(d); touched = true; persistDraft(); toast('Draft restored'); }
      else if (act === 'draft-discard') { pendingDraft = null; paintDraftBanner(); if (!touched) clearDraft(key); }
      else if (act === 'delete') remove(el);
    })
  ];
  const onHide = () => { if (document.visibilityState === 'hidden') persistSoon.flush(); };
  document.addEventListener('visibilitychange', onHide);

  if (totalAuto) fillTotal();
  paintPhoto(); paintIng(); paintSteps(); paintTimeHint(); paintDraftBanner();
  requestAnimationFrame(growAll);

  return () => {
    offs.forEach(off => off());
    document.removeEventListener('visibilitychange', onHide);
    persistSoon.flush();
    if (heroUrl) URL.revokeObjectURL(heroUrl);
  };
}
