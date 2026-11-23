/**
 * components/recipe-ingredients.js — serving scaler + checkable, grouped ingredient list.
 * Used by the recipe page and the cook-mode ingredients sheet; checked ids and the scale
 * factor live in recipe-state (sessionStorage), so both views stay in sync.
 *   ingredientsHtml(recipe, slug) → html   wrap it: <div data-ingredients>${…}</div>
 *   bindIngredients(host, recipe | () => recipe, slug, { onScale }) → off
 *       handles checkbox changes, −/+ / ×½ ×1 ×2, and Reset inside `host`;
 *       re-renders the closest [data-ingredients] in place on scale/reset.
 *   qtyText(ing, factor) → "1½–2 cups" ('' when qty is null)
 * Tapping the circle or the text checks an ingredient off. Convertible amounts are buttons that
 * open a breakdown under the row instead (other US measures + metric, units.js): the main amount
 * ("3 tbsp") and any written in the note ("or ½ tsp dried"); a temperature in the note ("about
 * 65°F") opens the conversion bubble (recipe-mentions.js). Note amounts scale with the recipe
 * ("1 stick, melted" → "2 sticks", "1 can" → "2 cans", units.js scaleNote) and turn accent like
 * the main amount; sizes ("a 16-oz package"), rates ("per pound") and per-piece weights ("4 oz
 * each") stay as written and say so in their breakdown. Open panels are remembered per recipe for
 * this page load, so they survive re-renders when scaling.
 * Metric amounts also show one US measure inline, "10 g (1¾ tsp*) salt" (units.js usEquivalent:
 * scaled, by the ingredient's density for weights); a key under the list explains the "*".
 */
import { html, fmtQty, scaleQty, clamp } from '../util.js';
import { on } from '../ui.js';
import { icon } from './recipe-icons.js';
import { rxState, rxPatch, toggleId } from './recipe-state.js';
import { breakdown, findTemps, scaleNote, usEquivalent } from '../units.js';
import { tempButton } from './recipe-mentions.js';

const convOpen = new Map();      // slug → Set(panel keys open: "i3" main amount, "i3-n0" first note amount)
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

const convBtn = (key, label, open, cls = '') =>
  html`<button type="button" class="rx-qty-btn${cls}" data-conv="${key}" aria-expanded="${open}" aria-controls="rx-conv-${key}" aria-label="${label}, other measures">${label}</button>`;
const convPanel = (key, conv, open, caption = '') =>
  html`<div class="rx-conv" id="rx-conv-${key}"${open ? '' : ' hidden'}>${caption ? html`<p class="rx-conv-cap">${caption}</p>` : ''}${convHtml(conv)}</div>`;

/** Note text with its amounts (scaled with the recipe) and temperatures as buttons → { html, panels }. */
const KEPT = { size: 'a size, not scaled', rate: 'a rate, not scaled', each: 'per piece, not scaled' };
function noteParts(ing, open, f) {
  const note = String(ing.note || ''), parts = [], panels = [];
  const temps = findTemps(note);
  const inTemp = a => temps.some(t => a.index < t.index + t.length && t.index < a.index + a.length);   // "180C" isn't 180 cups
  let k = 0;
  const spans = [...scaleNote(note, ing, f).filter(a => !inTemp(a)).map(a => (a.conv ? { ...a, k: k++ } : a)),
    ...temps.map(t => ({ ...t, temp: true }))].sort((a, b) => a.index - b.index);
  const scaled = Math.abs(f - 1) > 1e-9;
  let pos = 0;
  spans.forEach(a => {
    parts.push(note.slice(pos, a.index));
    if (a.temp) parts.push(tempButton(note.slice(a.index, a.index + a.length), a));
    else if (!a.conv) parts.push(html`<span class="rx-note-count is-scaled">${a.label}</span>`);   // a count, or '1.5 g'
    else {
      const key = `${ing.id}-n${a.k}`;
      parts.push(convBtn(key, a.label, open.has(key), ` rx-note-amt${a.scaled ? ' is-scaled' : ''}`));
      panels.push(convPanel(key, breakdown(a), open.has(key), scaled && a.why ? `${a.label} — ${KEPT[a.why]}` : a.label));
    }
    pos = a.index + a.length;
  });
  parts.push(note.slice(pos));
  return { html: html`${parts}`, panels };
}

function rowHtml(ing, f, checked, open) {
  const qty = qtyText(ing, f);
  const scaled = qty && Math.abs(f - 1) > 1e-9;
  const conv = qty ? breakdown(ing, f) : null;
  const isOpen = !!conv && open.has(ing.id);
  const cls = `rx-qty${scaled ? ' is-scaled' : ''}`;
  const amount = !qty ? '' : conv ? html`${convBtn(ing.id, qty, isOpen, ` rx-qty${scaled ? ' is-scaled' : ''}`)} ` : html`<span class="${cls}">${qty}</span> `;
  const note = ing.note ? noteParts(ing, open, f) : null;
  const us = qty ? usEquivalent(ing, f) : null;
  const approx = us ? html`<span class="rx-approx">(${us}<span aria-hidden="true">*</span><span class="sr-only">, approximately</span>)</span> ` : '';
  return html`
    <li class="rx-ing${checked ? ' is-checked' : ''}">
      <label class="rx-check-hit">
        <input type="checkbox" class="rx-ing-input" data-ing="${ing.id}" aria-label="${qty ? `${qty} ` : ''}${ing.item}" ${checked ? 'checked' : ''}>
        <span class="rx-check" aria-hidden="true">${icon('check')}</span>
      </label>
      <div class="rx-ing-text">
        <span class="rx-ing-line">${amount}${approx}<span class="rx-ing-item">${ing.item}</span></span>
        ${note ? html`<span class="rx-ing-note">${note.html}</span>` : ''}
        ${conv ? convPanel(ing.id, conv, isOpen) : ''}
        ${note ? note.panels : ''}
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
  const starred = items.some(i => qtyText(i, f) && usEquivalent(i, f));
  return html`
    ${scalerHtml(recipe, f)}
    ${[...bySec].map(([section, list]) => html`
      ${section ? html`<h3 class="rx-subhead">${section}</h3>` : ''}
      <ul class="rx-ings">${list.map(i => rowHtml(i, f, checked.has(i.id), open))}</ul>`)}
    ${starred ? html`<p class="rx-approx-key"><span aria-hidden="true">*</span> Approximate US measure, converted from the metric amount.</p>` : ''}
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
      const key = el.dataset.conv, set = openSet(slug), open = !set.has(key);
      if (open) set.add(key); else set.delete(key);
      el.setAttribute('aria-expanded', String(open));
      const panel = el.closest('.rx-ing')?.querySelector(`#rx-conv-${key}`);
      if (panel) panel.hidden = !open;
    }),
    // The text checks the item off too — except the amount buttons and the open breakdowns.
    on(host, 'click', '.rx-ing-text', (e, el) => {
      if (e.target.closest('button, a, .rx-conv')) return;
      if (String(getSelection?.() || '').trim()) return;           // selecting text, not tapping
      el.closest('.rx-ing')?.querySelector('.rx-ing-input')?.click();
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
