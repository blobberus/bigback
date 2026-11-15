/**
 * views/convert.js — kitchen converter (#/convert), laid out like a search engine's unit
 * converter: one row each for weight, volume and temperature, [amount][unit] = [amount][unit].
 *   - Type on either side: the other side updates on every keystroke. Mid-typing ("1 1",
 *     "1 1/", "2.", a lone "-" for a temperature) keeps showing the last whole amount, converted
 *     into the current units, instead of blanking it or flagging it (midTyping).
 *   - Changing a unit recalculates from the side you typed in last, so your number stays put.
 *   - Amounts take decimals or fractions ("1.5", "1,5", "1 1/2", "½"); a US kitchen result also
 *     shows the nearest measure ("≈ ⅜ cup").
 *   - Tapping an amount selects it, so the next digits replace it.
 *   - Units and the last amount per row are remembered on this device (localStorage bb.convert).
 * Math and unit tables: units.js (CONVERTERS, convertUnit, parseAmount, fmtAmount, kitchenHint).
 */
import { html } from '../util.js';
import { setTopbar, on } from '../ui.js';
import { CONVERTERS, convertUnit, parseAmount, fmtAmount, kitchenHint } from '../units.js';

const KEY = 'bb.convert';
const KINDS = Object.keys(CONVERTERS);
const other = side => (side === 'a' ? 'b' : 'a');
const unitName = (kind, key) => CONVERTERS[kind].units.find(u => u[0] === key)?.[1] || key;
// The start of an amount that isn't one yet: "-", ".", "2.", "1/", "1 1", "1 1/".
const PARTIAL = /^-?\s*(?:[.,]|\d+(?:[.,]|\/|\s+(?:\d+\/?)?)?)?$/;
/** Halfway through typing a valid amount (a leading minus only where negatives exist). */
export function midTyping(raw, signed) {
  const s = String(raw).trim().replace(/^[−–]/, '-');
  return !!s && (signed || s[0] !== '-') && PARTIAL.test(s);
}

function loadState() {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch { /* unreadable → defaults */ }
  return Object.fromEntries(KINDS.map(kind => {
    const c = CONVERTERS[kind], s = saved[kind] || {}, ok = u => c.units.some(x => x[0] === u);
    return [kind, {
      a: ok(s.a) ? s.a : c.start.a, b: ok(s.b) ? s.b : c.start.b,
      from: s.from === 'b' ? 'b' : 'a', raw: typeof s.raw === 'string' ? s.raw : c.start.v
    }];
  }));
}
const saveState = st => { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch { /* private mode */ } };

function sideHtml(kind, st, side) {
  const c = CONVERTERS[kind], unit = st[side];
  return html`<div class="cv-side">
    <input class="cv-amt" data-side="${side}" type="text" inputmode="decimal" autocomplete="off" autocorrect="off"
      autocapitalize="off" spellcheck="false" enterkeyhint="done" aria-label="${c.label} in ${unitName(kind, unit)}"
      value="${st.from === side ? st.raw : ''}">
    <span class="cv-unit-wrap"><select class="cv-unit" data-side="${side}" aria-label="${c.label} unit, ${side === 'a' ? 'from' : 'to'}">
      ${c.units.map(([key, label]) => html`<option value="${key}"${key === unit ? ' selected' : ''}>${label}</option>`)}
    </select></span>
    <p class="cv-hint" data-hint="${side}"></p>
  </div>`;
}

function rowHtml(kind, st) {
  return html`<section class="cv-row" data-kind="${kind}" aria-labelledby="cv-${kind}-h">
    <h2 class="cv-h" id="cv-${kind}-h">${CONVERTERS[kind].label}</h2>
    <div class="cv-pair">${sideHtml(kind, st, 'a')}<span class="cv-eq" aria-hidden="true">=</span>${sideHtml(kind, st, 'b')}</div>
  </section>`;
}

export async function render(root) {
  setTopbar({ title: 'Convert' });
  const state = loadState();
  root.innerHTML = html`<div class="cv">
    ${KINDS.map(k => rowHtml(k, state[k]))}
    <p class="cv-foot">Cups ⇄ grams depends on the ingredient: in a recipe, tap an ingredient's amount to see its weight.</p>
  </div>`;

  const rowOf = kind => root.querySelector(`.cv-row[data-kind="${kind}"]`);
  const last = {};          // per row: { side, v } the last whole amount typed, reused while mid-typing

  /** Recalculate the row's other side from the side typed in last. */
  function compute(kind) {
    const st = state[kind], row = rowOf(kind), src = st.from, dst = other(src);
    const inS = row.querySelector(`.cv-amt[data-side="${src}"]`), inD = row.querySelector(`.cv-amt[data-side="${dst}"]`);
    const raw = inS.value;
    let v = parseAmount(raw);
    let ok = Number.isFinite(v) && (kind === 'temp' || v >= 0);
    const partial = !ok && midTyping(raw, kind === 'temp');
    inS.classList.toggle('is-bad', !!raw.trim() && !ok && !partial);
    if (ok) last[kind] = { side: src, v };
    else if (partial) {
      if (last[kind]?.side !== src) return;       // nothing whole typed on this side yet: leave the row be
      v = last[kind].v; ok = true;                // in the current units, so a unit change mid-typing stays right
    } else delete last[kind];
    const out = ok ? convertUnit(kind, v, st[src], st[dst]) : NaN;
    inD.value = ok ? fmtAmount(out) : '';
    inD.classList.remove('is-bad');
    row.querySelector(`[data-hint="${src}"]`).textContent = '';
    row.querySelector(`[data-hint="${dst}"]`).textContent = ok ? kitchenHint(kind, out, st[dst]) : '';
  }
  KINDS.forEach(compute);

  let justFocused = null;
  const offs = [
    on(root, 'input', '.cv-amt', (e, el) => {
      const kind = el.closest('.cv-row').dataset.kind, st = state[kind];
      st.from = el.dataset.side; st.raw = el.value;
      compute(kind);
      saveState(state);
    }),
    on(root, 'change', '.cv-unit', (e, el) => {
      const kind = el.closest('.cv-row').dataset.kind, st = state[kind], side = el.dataset.side;
      st[side] = el.value;
      rowOf(kind).querySelector(`.cv-amt[data-side="${side}"]`).setAttribute('aria-label', `${CONVERTERS[kind].label} in ${unitName(kind, el.value)}`);
      compute(kind);
      saveState(state);
    }),
    // Tap an amount → it's selected, so typing replaces it (the mouseup would undo a plain select()).
    on(root, 'focusin', '.cv-amt', (e, el) => {
      justFocused = el;
      setTimeout(() => { if (document.activeElement === el) el.setSelectionRange(0, el.value.length); }, 0);
    }),
    on(root, 'mouseup', '.cv-amt', (e, el) => { if (justFocused === el) { e.preventDefault(); justFocused = null; } }),
    on(root, 'keydown', '.cv-amt', (e, el) => { if (e.key === 'Enter') { e.preventDefault(); el.blur(); } })
  ];
  return () => offs.forEach(off => off());
}
