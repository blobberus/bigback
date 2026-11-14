/**
 * components/recipe-ingredients.js — serving scaler + checkable, grouped ingredient list.
 * Used by the recipe page and the cook-mode ingredients sheet; checked ids and the scale
 * factor live in recipe-state (sessionStorage), so both views stay in sync.
 *   ingredientsHtml(recipe, slug) → html   wrap it: <div data-ingredients>${…}</div>
 *   bindIngredients(host, recipe | () => recipe, slug, { onScale }) → off
 *       handles checkbox changes, −/+ / ×½ ×1 ×2, and Reset inside `host`;
 *       re-renders the closest [data-ingredients] in place on scale/reset.
 *   qtyText(ing, factor) → "1½–2 cups" ('' when qty is null)
 * Only the round checkbox checks an ingredient off. A convertible amount ("3 tbsp", "200 g") is a
 * button that opens a breakdown under the row: other US measures + metric (units.js). Open rows
 * are remembered per recipe for this page load, so they survive re-renders when scaling.
 */
import { html, fmtQty, scaleQty, clamp } from '../util.js';
import { on } from '../ui.js';
import { icon } from './recipe-icons.js';
import { rxState, rxPatch, toggleId } from './recipe-state.js';
import { breakdown } from '../units.js';

const convOpen = new Map();      // slug → Set(ingredient ids with the breakdown open)
const openSet = slug => { if (!convOpen.has(slug)) convOpen.set(slug, new Set()); return convOpen.get(slug); };

/* Abbreviations never pluralize; count-style words do ("4 cloves", "2 pinches"). */
const ABBR = /^(tsp|tbsp|tbs|tb|t|c|lbs?|oz|fl\.? ?oz|g|kg|mg|ml|l|dl|cl|qt|pt|gal|in|cm|mm|pkg)\.?$/i;
const IRREG = { leaf: 'leaves', loaf: 'loaves', half: 'halves', knife: 'knives' };
function unitFor(unit, n) {
  if (!unit) return '';
  if (!(n > 1) || /s$/i.test(unit) || ABBR.test(unit)) return unit;
  const m = unit.match(/^(.*?)(\w+)$/);
  if (!m) return unit;
  const [, pre, word] = m;
  if (IRREG[word.toLowerCase()]) return pre + IRREG[word.toLowerCase()];
  return pre + word + (/(ch|sh|x|z)$/i.test(word) ? 'es' : 's');
}

export function qtyText(ing, factor = 1) {
  if (ing.qty == null || ing.qty === '' || isNaN(ing.qty)) return '';
  const lo = scaleQty(ing.qty, factor);
  const hi = ing.qtyMax != null && !isNaN(ing.qtyMax) ? scaleQty(ing.qtyMax, factor) : null;
  const num = hi != null && hi !== lo ? `${fmtQty(lo)}–${fmtQty(hi)}` : fmtQty(lo);
  const unit = unitFor(ing.unit, hi ?? lo);
  return unit ? `${num} ${unit}` : num;
}

function servingsLabel(recipe, f) {
  const base = Number(recipe.servings);
  if (base > 0) {
    const n = Math.round(base * f * 100) / 100;
    return { num: fmtQty(n), unit: n === 1 ? 'serving' : 'servings' };
  }
  return { num: `×${fmtQty(f)}`, unit: 'batch' };
}

function nextFactor(recipe, f, delta) {
  const base = Number(recipe.servings);
  if (base > 0) {
    const cur = base * f;
    const s = clamp(delta > 0 ? Math.floor(cur + 1e-9) + 1 : Math.ceil(cur - 1e-9) - 1, 1, 99);
    return s / base;
  }
  return clamp(Math.round((f + delta * 0.5) * 2) / 2, 0.5, 12);
}

function atMin(recipe, f) {
  const base = Number(recipe.servings);
  return base > 0 ? base * f <= 1 + 1e-9 : f <= 0.5;
}

const QUICK = [[0.5, '½'], [1, '1'], [2, '2']];

function scalerHtml(recipe, f) {
  const { num, unit } = servingsLabel(recipe, f);
  const scaled = Math.abs(f - 1) > 1e-9;
  return html`
    <div class="rx-scaler" role="group" aria-label="Scale ingredients">
      <div class="rx-scaler-main">
        <button type="button" class="rx-round" data-act="scale" data-delta="-1" aria-label="Fewer servings" ${atMin(recipe, f) ? 'disabled' : ''}>${icon('minus')}</button>
        <output class="rx-scaler-val${scaled ? ' is-scaled' : ''}" aria-live="polite"><strong>${num}</strong> ${unit}</output>
        <button type="button" class="rx-round" data-act="scale" data-delta="1" aria-label="More servings">${icon('plus')}</button>
      </div>
      <div class="seg rx-quick" role="group" aria-label="Quick scale">
        ${QUICK.map(([v, l]) => html`<button type="button" data-act="scale" data-factor="${v}" aria-pressed="${Math.abs(f - v) < 1e-9}" aria-label="Scale times ${l}">×${l}</button>`)}
      </div>
    </div>`;
}

function convHtml(conv) {
  const col = (title, lines) => (lines.length ? html`<div class="rx-conv-col">
    <p class="rx-conv-h">${title}</p>
    <ul>${lines.map(l => html`<li>${l.text}${l.by ? html` <span class="rx-conv-by">by ${l.by}</span>` : ''}</li>`)}</ul>
  </div>` : '');
  return html`${col('Imperial (US)', conv.us)}${col('Metric', conv.metric)}`;
}

function rowHtml(ing, f, checked, open) {
  const qty = qtyText(ing, f);
  const scaled = qty && Math.abs(f - 1) > 1e-9;
  const conv = qty ? breakdown(ing, f) : null;
  const isOpen = !!conv && open.has(ing.id);
  const cls = `rx-qty${scaled ? ' is-scaled' : ''}`;
  const amount = !qty ? '' : conv
    ? html`<button type="button" class="${cls} rx-qty-btn" data-conv="${ing.id}" aria-expanded="${isOpen}" aria-controls="rx-conv-${ing.id}" aria-label="${qty}, other measures">${qty}</button> `
    : html`<span class="${cls}">${qty}</span> `;
  return html`
    <li class="rx-ing${checked ? ' is-checked' : ''}">
      <label class="rx-check-hit">
        <input type="checkbox" class="rx-ing-input" data-ing="${ing.id}" aria-label="${qty ? `${qty} ` : ''}${ing.item}" ${checked ? 'checked' : ''}>
        <span class="rx-check" aria-hidden="true">${icon('check')}</span>
      </label>
      <div class="rx-ing-text">
        <span class="rx-ing-line">${amount}<span class="rx-ing-item">${ing.item}</span></span>
        ${ing.note ? html`<span class="rx-ing-note">${ing.note}</span>` : ''}
        ${conv ? html`<div class="rx-conv" id="rx-conv-${ing.id}"${isOpen ? '' : ' hidden'}>${convHtml(conv)}</div>` : ''}
      </div>
    </li>`;
}

function footerHtml(total, done) {
  return html`
    <div class="rx-ing-foot">
      <span class="rx-count" data-ing-count>${done ? `${done} of ${total} ready` : `${total} ingredient${total === 1 ? '' : 's'}`}</span>
      <button type="button" class="rx-link-btn" data-act="ing-reset" aria-label="Reset checked ingredients" ${done ? '' : 'hidden'}>${icon('reset')} Reset</button>
    </div>`;
}

export function ingredientsHtml(recipe, slug) {
  const items = recipe.ingredients || [];
  if (!items.length) return html`<p class="muted">No ingredients listed.</p>`;
  const st = rxState(slug);
  const f = Number(st.factor) > 0 ? Number(st.factor) : 1;
  const checked = new Set(st.checked);
  // Ingredient order matters less than step order, so same-named sections are merged.
  const bySec = new Map();
  for (const it of items) {
    const k = (it.section || '').trim() || null;
    if (!bySec.has(k)) bySec.set(k, []);
    bySec.get(k).push(it);
  }
  const done = items.filter(i => checked.has(i.id)).length;
  const open = openSet(slug);
  return html`
    ${scalerHtml(recipe, f)}
    ${[...bySec].map(([section, list]) => html`
      ${section ? html`<h3 class="rx-subhead">${section}</h3>` : ''}
      <ul class="rx-ings">${list.map(i => rowHtml(i, f, checked.has(i.id), open))}</ul>`)}
    ${footerHtml(items.length, done)}`;
}

export function bindIngredients(host, getRecipe, slug, { onScale } = {}) {
  const R = () => (typeof getRecipe === 'function' ? getRecipe() : getRecipe) || {};
  const repaint = el => {
    const box = el.closest('[data-ingredients]');
    if (box) box.innerHTML = ingredientsHtml(R(), slug);
  };
  const updateCount = el => {
    const box = el.closest('[data-ingredients]');
    if (!box) return;
    const total = (R().ingredients || []).length;
    const done = box.querySelectorAll('.rx-ing-input:checked').length;
    const foot = box.querySelector('.rx-ing-foot');
    if (foot) foot.outerHTML = footerHtml(total, done);
  };
  const offs = [
    on(host, 'change', '.rx-ing-input', (e, el) => {
      const id = el.dataset.ing;
      rxPatch(slug, s => ({ ...s, checked: toggleId(s.checked, id, el.checked) }));
      el.closest('.rx-ing')?.classList.toggle('is-checked', el.checked);
      updateCount(el);
    }),
    on(host, 'click', '[data-act="scale"]', (e, el) => {
      const cur = Number(rxState(slug).factor) || 1;
      const f = el.dataset.factor ? Number(el.dataset.factor) : nextFactor(R(), cur, Number(el.dataset.delta));
      rxPatch(slug, { factor: f });
      const keep = el.dataset.delta ? `[data-delta="${el.dataset.delta}"]` : `[data-factor="${el.dataset.factor}"]`;
      const box = el.closest('[data-ingredients]');
      repaint(el);
      if (keep) box?.querySelector(keep)?.focus({ preventScroll: true });
      onScale?.(f);
    }),
    on(host, 'click', '[data-conv]', (e, el) => {
      const id = el.dataset.conv, set = openSet(slug), open = !set.has(id);
      if (open) set.add(id); else set.delete(id);
      el.setAttribute('aria-expanded', String(open));
      const panel = el.closest('.rx-ing')?.querySelector('.rx-conv');
      if (panel) panel.hidden = !open;
    }),
    on(host, 'click', '[data-act="ing-reset"]', (e, el) => {
      rxPatch(slug, { checked: [] });
      const box = el.closest('[data-ingredients]');
      repaint(el);
      box?.querySelector('.rx-ing-input')?.focus({ preventScroll: true });   // the Reset button is gone now
    })
  ];
  return () => offs.forEach(off => off());
}
