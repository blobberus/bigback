/**
 * components/recipe-mentions.js — ingredient names inside step text become tappable; a tap shows
 * a small bubble above the word with the (scaled) amount. Recipe page + cook mode.
 *   mentionMatcher(ingredients) → match(text) → [{ index, length, ids }]
 *       first mention per ingredient per step; skipped when the step already gives an amount
 *       ("Add 2 tbsp butter") and for ingredients without a quantity ("salt, to taste").
 *   bindMentions(root, getRecipe, slug) → off      tap → bubble; tap again / outside / Esc closes
 * Links are <button class="rx-ingref" data-ingref="i3 i7"> rendered by stepTextHtml().
 */
import { html, toStr, fmtQty } from '../util.js';
import { on } from '../ui.js';
import { rxState } from './recipe-state.js';
import { qtyText } from './recipe-ingredients.js';

/* Words that describe an ingredient but aren't what a step calls it ("cold unsalted butter" → "butter"). */
const DESCRIPTORS = new Set(`fresh freshly large small medium big extra extra-large jumbo virgin extra-virgin boneless
  skinless bone-in skin-on kosher unsalted salted cold warm room-temperature ripe whole dried ground low-sodium
  reduced-sodium good-quality good quality finely coarsely roughly thinly thickly packed plain organic store-bought
  homemade lean thick-cut thin thick frozen canned chopped minced sliced diced grated shredded crushed toasted
  softened melted cubed peeled trimmed halved quartered zested juiced divided optional about plus more for
  serving to taste and of a an the neutral cracked heaping level scant`.split(/\s+/));
/* Counting nouns: "garlic cloves" is called "garlic" in steps. Never a mention on their own. */
const CONTAINERS = new Set('clove cloves sprig sprigs leaf leaves stalk stalks rib ribs head heads bunch bunches can cans piece pieces slice slices wedge wedges fillet fillets stick sticks knob'.split(' '));
/* Too generic to stand for one ingredient unless it's the whole name ("the sauce" ≠ soy sauce). */
const GENERIC = new Set('sauce mixture mix paste powder seeds seed flakes juice zest water liquid fat meat dough batter'.split(' '));

const WORD = /[\p{L}\p{N}½¼¾⅓⅔⅛⅜⅝⅞]+(?:[-'’][\p{L}\p{N}]+)*/gu;
const AMOUNT = /^(?:[\d½¼¾⅓⅔⅛⅜⅝⅞]|(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|dozen)$)/i;
/* A number followed by one of these is a time, size or temperature, not an amount ("12-inch skillet"). */
const NOT_UNIT = /^(?:minutes?|mins?|hours?|hrs?|seconds?|secs?|inch(?:es)?|cm|mm|degrees?|f|c)$/i;
const CLAUSE = /[.,;:!?()\n]/;

/** Plural-insensitive key for a word ("tomatoes" → "tomato", "thighs" → "thigh"). Same rule both sides. */
export function stem(w) {
  w = w.toLowerCase().replace(/[’']s$/, '');
  if (w.length > 4 && w.endsWith('ies')) return w.slice(0, -3) + 'y';
  if (/(?:ses|xes|zes|ches|shes|oes)$/.test(w) && w.length > 4) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') && !w.endsWith('us')) return w.slice(0, -1);
  return w;
}

const words = s => (String(s || '').match(WORD) || []).map(w => w.toLowerCase());
// Unlisted participles count too ("charred", "pickled"); "-eed" keeps aniseed/seed as nouns.
const isDescriptor = w => DESCRIPTORS.has(w) || (w.length > 4 && w.endsWith('ed') && !w.endsWith('eed'));
const onlyAsWholeName = w => CONTAINERS.has(w) || GENERIC.has(stem(w));

/** Phrases (as word arrays) a step might use for this ingredient, plus its "core" name. */
function phrasesFor(item) {
  const out = [];
  let core = null;
  const parts = String(item || '').replace(/\([^)]*\)/g, ' ').split(/,|\/|\bor\b/i);
  for (const part of parts) {
    const all = words(part);
    const kept = all.filter(w => !isDescriptor(w));
    if (!kept.length) continue;                          // "bone-in", "zested and juiced"
    core ||= kept;
    for (const list of [all, kept]) {
      for (let k = 0; k < list.length; k++) {
        const suf = list.slice(k);
        if (isDescriptor(suf[0])) continue;
        if (suf.length === 1 && onlyAsWholeName(suf[0]) && !(list === kept && kept.length === 1)) continue;
        out.push(suf);
      }
    }
    if (kept.length > 1 && CONTAINERS.has(kept[kept.length - 1])) out.push(kept.slice(0, -1));   // garlic cloves → garlic
  }
  return { phrases: out, core: core ? core.map(stem).join(' ') : '' };
}

export function mentionMatcher(ingredients = []) {
  const byKey = new Map();          // stemmed phrase → Set(ids)
  const coreOf = new Map();         // id → stemmed core name
  let maxLen = 1;
  for (const ing of ingredients) {
    if (!ing?.id) continue;
    const { phrases, core } = phrasesFor(ing.item);
    coreOf.set(ing.id, core);
    for (const p of phrases) {
      const key = p.map(stem).join(' ');
      if (!byKey.has(key)) byKey.set(key, new Set());
      byKey.get(key).add(ing.id);
      maxLen = Math.max(maxLen, p.length);
    }
  }
  // A phrase shared by different ingredients only counts for the one(s) whose whole name it is
  // ("oil" → neutral oil, not toasted sesame oil); otherwise it's ambiguous and never linked.
  const resolve = new Map();
  for (const [key, set] of byKey) {
    const ids = [...set];
    const sameName = ids.every(id => coreOf.get(id) === coreOf.get(ids[0]));
    const exact = ids.filter(id => coreOf.get(id) === key);
    if (ids.length === 1 || sameName) resolve.set(key, ids);
    else if (exact.length) resolve.set(key, exact);
  }
  const hasQty = new Set(ingredients.filter(i => i?.id && qtyText(i)).map(i => i.id));

  return function match(text) {
    text = String(text || '');
    const toks = [...text.matchAll(WORD)].map(m => ({ w: m[0], s: m.index, e: m.index + m[0].length, k: stem(m[0]) }));
    const found = [], seen = new Set();
    for (let p = 0; p < toks.length; p++) {
      for (let len = Math.min(maxLen, toks.length - p); len >= 1; len--) {
        const key = toks.slice(p, p + len).map(t => t.k).join(' ');
        const ids = resolve.get(key);
        if (!ids) continue;
        const last = toks[p + len - 1];
        // Words must be adjacent (only spaces between), not split by punctuation.
        if (len > 1 && toks.slice(p, p + len - 1).some((t, j) => /\S/.test(text.slice(t.e, toks[p + j + 1].s)))) continue;
        const span = { index: toks[p].s, length: last.e - toks[p].s, ids: ids.filter(id => hasQty.has(id) && !seen.has(id)) };
        ids.forEach(id => seen.add(id));
        if (span.ids.length && !amountGiven(text, toks, p, last)) found.push(span);
        p += len - 1;
        break;
      }
    }
    return found;
  };
}

/** "Add 2 tbsp of the butter" / "the butter (3 tbsp)": the step already says how much. */
function amountGiven(text, toks, p, last) {
  for (let j = p - 1, n = 0; j >= 0 && n < 4; j--, n++) {
    const gap = text.slice(toks[j].e, toks[j + 1].s);
    if (CLAUSE.test(gap)) break;
    const t = toks[j], next = j + 1 < p ? toks[j + 1] : null;
    if (!AMOUNT.test(t.w)) continue;
    const hyphenUnit = t.w.split(/[-–]/)[1];
    if ((hyphenUnit && NOT_UNIT.test(hyphenUnit)) || gap.includes('°') || (next && NOT_UNIT.test(next.w))) continue;
    return true;
  }
  return /^\s*\(\s*(?:\d|[½¼¾⅓⅔⅛⅜⅝⅞])/.test(text.slice(last.e));
}

/* ---------- bubble ---------- */
const factorFor = slug => { const f = Number(rxState(slug).factor); return f > 0 ? f : 1; };

function bubbleHtml(ings, f) {
  const multi = ings.length > 1;
  return html`${ings.map(i => html`<span class="rx-ingtip-line">${multi && i.section ? html`<span class="rx-ingtip-sec">${i.section}:</span> ` : ''}<strong>${qtyText(i, f)}</strong> ${i.item}</span>`)}${
    Math.abs(f - 1) > 1e-9 ? html`<span class="rx-ingtip-scale">Scaled ×${fmtQty(f)}</span>` : ''}`;
}

export function bindMentions(root, getRecipe, slug) {
  let tip = null, btn = null, raf = 0, mo = null;

  function close() {
    if (!tip) return;
    tip.remove(); tip = null;
    mo?.disconnect(); mo = null;
    if (btn) { btn.setAttribute('aria-expanded', 'false'); btn.removeAttribute('aria-describedby'); }
    btn = null;
  }

  function place() {
    if (!tip) return;
    if (!btn?.isConnected) return close();
    const r = btn.getClientRects()[0] || btn.getBoundingClientRect();
    const vw = document.documentElement.clientWidth;
    const tw = tip.offsetWidth, th = tip.offsetHeight;
    const mid = r.left + r.width / 2;
    const left = Math.max(8, Math.min(mid - tw / 2, vw - tw - 8));
    const bar = document.querySelector('.topbar')?.getBoundingClientRect().bottom || 0;
    const below = r.top - th - 10 < bar + 4;
    tip.classList.toggle('is-below', below);
    tip.style.left = `${Math.round(left)}px`;
    tip.style.top = `${Math.round(below ? r.bottom + 10 : r.top - th - 10)}px`;
    tip.style.setProperty('--arrow-x', `${Math.round(Math.max(12, Math.min(tw - 12, mid - left)))}px`);
  }

  function open(el) {
    close();
    const all = getRecipe()?.ingredients || [];
    const ings = el.dataset.ingref.split(' ').map(id => all.find(i => i.id === id)).filter(i => i && qtyText(i));
    if (!ings.length) return;
    tip = document.createElement('div');
    tip.className = 'rx-ingtip';
    tip.id = `rx-ingtip-${slug}`;
    tip.setAttribute('role', 'status');
    tip.innerHTML = toStr(bubbleHtml(ings, factorFor(slug)));
    document.body.append(tip);
    btn = el;
    el.setAttribute('aria-expanded', 'true');
    el.setAttribute('aria-describedby', tip.id);
    place();
    // Re-rendered step (cook mode paging, store refresh) → the word is gone, so is the bubble.
    mo = new MutationObserver(() => { if (!btn?.isConnected) close(); });
    mo.observe(root, { childList: true, subtree: true });
  }

  const offClick = on(root, 'click', '[data-ingref]', (e, el) => {
    e.preventDefault();
    if (btn === el) close(); else open(el);
  });
  const onDoc = e => { if (tip && !e.target.closest?.('[data-ingref]') && !tip.contains(e.target)) close(); };
  const onKey = e => {
    if (!tip || e.key !== 'Escape') return;
    e.preventDefault(); e.stopPropagation();          // cook mode's Esc = leave; close the bubble first
    const b = btn; close(); b?.focus({ preventScroll: true });
  };
  const onMove = () => { if (tip && !raf) raf = requestAnimationFrame(() => { raf = 0; place(); }); };
  document.addEventListener('click', onDoc, true);
  window.addEventListener('keydown', onKey, true);
  window.addEventListener('scroll', onMove, { capture: true, passive: true });
  window.addEventListener('resize', onMove);

  return () => {
    close(); offClick();
    if (raf) cancelAnimationFrame(raf);
    document.removeEventListener('click', onDoc, true);
    window.removeEventListener('keydown', onKey, true);
    window.removeEventListener('scroll', onMove, { capture: true });
    window.removeEventListener('resize', onMove);
  };
}
