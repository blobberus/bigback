/**
 * units.js — kitchen measurement conversions (US customary ⇄ metric). Pure, no DOM.
 *   unitInfo(unit, item) → { kind: 'volume' | 'weight', key, base } | null
 *       base = ml or g per one unit; null for counts and unconvertible units (clove, pinch, can)
 *   breakdown({ qty, qtyMax, unit, item }, factor) → { us: [line], metric: [line] } | null
 *       line = { text, by? }   by: 'weight' | 'volume' when it's a density estimate
 *       Equivalents only: the unit the recipe already uses is left out. Rounded to cook-friendly
 *       fractions; "≈" marks a rounding error over ~2 %.
 */
import { fmtQty } from './util.js';

const VOL = { tsp: 4.92892, tbsp: 14.7868, floz: 29.5735, cup: 236.588, pint: 473.176, quart: 946.353, gallon: 3785.41, stick: 118.294, ml: 1, cl: 10, dl: 100, l: 1000 };
const WT = { oz: 28.3495, lb: 453.592, mg: 0.001, g: 1, kg: 1000 };
const ALIAS = {
  tsp: 'tsp tsps teaspoon teaspoons', tbsp: 'tbsp tbsps tbs tbl tbls tablespoon tablespoons',
  floz: 'fl oz|fl. oz|floz|fluid ounce|fluid ounces|fl ounce', cup: 'c cup cups', pint: 'pt pint pints',
  quart: 'qt quart quarts', gallon: 'gal gallon gallons', stick: 'stick sticks',
  ml: 'ml milliliter milliliters millilitre millilitres', cl: 'cl centiliter centilitre', dl: 'dl deciliter decilitre',
  l: 'l liter liters litre litres ltr', oz: 'oz ounce ounces', lb: 'lb lbs pound pounds', mg: 'mg milligram milligrams',
  g: 'g gr gm gram grams gramme grammes', kg: 'kg kgs kilo kilos kilogram kilograms'
};
const LOOKUP = new Map();
for (const [key, names] of Object.entries(ALIAS)) for (const n of names.split(names.includes('|') ? '|' : ' ')) LOOKUP.set(n, key);

/* Grams per ml for common ingredients (King Arthur weight chart for dry goods; liquids by density). */
const DENSITY = [
  [/\bbutter\b/, 0.96, /\b(?:peanut|almond|cashew|nut|seed|apple|cocoa|shea)\s+butter|buttermilk|butternut/],
  [/\b(?:powdered|confectioners'?|icing)\s+sugar\b/, 0.478],
  [/\bbrown\s+sugar\b/, 0.9],
  [/\bsugar\b/, 0.845, /\bsugar\s+snap/],
  [/\bflour\b/, 0.507, /\b(?:almond|coconut|rice|chickpea|corn)\s+flour/],
  [/\bhoney\b/, 1.42],
  [/\bmaple\s+syrup\b/, 1.32],
  [/\boil\b/, 0.92, /\bspray\b/],
  [/\b(?:milk|buttermilk)\b/, 1.03, /\b(?:condensed|evaporated|powdered|dry)\s+milk/],
  [/\bcream\b/, 1.0, /\b(?:ice|sour)\s+cream|cream\s+cheese|cream\s+of\b/],
  [/\b(?:water|stock|broth|wine|vinegar|juice)\b/, 1.0],
  [/\b(?:rolled|old[- ]fashioned)?\s*oats\b/, 0.376],
  [/\bcocoa\b/, 0.355]
];
function density(item) {
  const s = String(item || '').toLowerCase();
  for (const [re, d, unless] of DENSITY) if (re.test(s) && !(unless && unless.test(s))) return d;
  return null;
}

export function unitInfo(unit, item = '') {
  if (!unit) return null;
  const raw = String(unit).trim();
  if (raw === 'T') return { kind: 'volume', key: 'tbsp', base: VOL.tbsp };      // T = tablespoon, t = teaspoon
  if (raw === 't') return { kind: 'volume', key: 'tsp', base: VOL.tsp };
  const key = LOOKUP.get(raw.toLowerCase().replace(/\.$/, '').replace(/\s+/g, ' '));
  if (!key) return null;
  if (key === 'stick' && !/\b(?:butter|margarine|shortening)\b/i.test(item)) return null;   // cinnamon stick
  return key in VOL ? { kind: 'volume', key, base: VOL[key] } : { kind: 'weight', key, base: WT[key] };
}

/* ---------- formatting ---------- */
const FRACS = [0, 1 / 8, 1 / 4, 1 / 3, 3 / 8, 1 / 2, 5 / 8, 2 / 3, 3 / 4, 7 / 8, 1];
/** Nearest cook-friendly amount → { t, approx } (eighths and thirds below 20, whole numbers above). */
function nice(n, coarse = false) {
  let r;
  if (n >= 20) r = Math.round(n);
  else if (coarse && n >= 4) r = Math.round(n * 2) / 2;          // ounces: 16⅞ fl oz reads as noise
  else {
    const whole = Math.floor(n), fr = n - whole;
    r = whole + FRACS.reduce((a, b) => (Math.abs(fr - b) < Math.abs(fr - a) ? b : a), 0);
  }
  if (r === 0) return { t: String(Math.round(n * 100) / 100), approx: true };
  return { t: fmtQty(r), approx: Math.abs(r - n) > Math.max(0.004, n * 0.02) };
}
function metric(v) {
  if (v >= 1000) return null;
  return String(v < 10 ? Math.round(v * 10) / 10 : Math.round(v));
}
const big = v => String(Math.round(v / 10) / 100);                // 1234 → "1.23"
const approxText = (parts, unit) => `${parts.some(p => p.approx) ? '≈ ' : ''}${parts.map(p => p.t).join('–')} ${unit}`;

/** US volume lines for [lo, hi] ml (hi null for a single amount). */
function usVolume(lo, hi, skip, by) {
  skip = new Set([].concat(skip ?? []));
  const out = [], top = hi ?? lo;
  const push = text => out.push(by ? { text, by } : { text });
  const plain = (key, unit, plural = unit) => {
    const c = key === 'floz';
    const a = nice(lo / VOL[key], c), b = hi != null ? nice(hi / VOL[key], c) : null;
    const many = (hi ?? lo) / VOL[key] > 1 + 1e-9;
    push(approxText(b && b.t !== a.t ? [a, b] : [a], many ? plural : unit));
  };
  if (!skip.has('gallon') && lo >= VOL.gallon * 0.99) plain('gallon', 'gal');
  if (!skip.has('quart') && lo >= VOL.quart * 0.99 && top < VOL.gallon * 4) plain('quart', 'qt');
  if (!skip.has('pint') && lo >= VOL.pint * 0.99 && top < VOL.gallon * 2) plain('pint', 'pt');
  // Below ¼ cup, cups would round badly (3 tbsp ≠ ⅛ cup) — tablespoons say it better.
  if (!skip.has('cup') && lo >= VOL.cup / 4 * 0.99 && top < VOL.gallon * 2) plain('cup', 'cup', 'cups');
  if (!skip.has('floz') && lo >= VOL.floz / 2 * 0.99 && top <= VOL.floz * 64) plain('floz', 'fl oz');
  // Spoon counts stop being useful past 2 cups (tbsp) / 1 cup (tsp).
  if (!skip.has('tbsp') && lo >= VOL.tsp * 0.99 && top <= VOL.cup * 2 + 0.01) {
    const tsp = lo / VOL.tsp, tb = Math.floor(tsp / 3 + 1e-6), rem = tsp - tb * 3;
    // ≤ ½ cup: whole tablespoons plus teaspoons ("5 tbsp + 1 tsp"), the way you'd actually measure it.
    if (hi == null && tb >= 1 && top <= VOL.cup / 2 + 0.01 && rem > 0.06 && rem < 2.94) {
      const r = nice(rem);
      push(`${r.approx ? '≈ ' : ''}${tb} tbsp + ${r.t} tsp`);
    } else plain('tbsp', 'tbsp');
  }
  if (!skip.has('tsp') && lo >= VOL.tsp / 8 * 0.99 && top <= VOL.cup + 0.01) plain('tsp', 'tsp');
  return out;
}

function metricVolume(lo, hi, skip) {
  skip = new Set([].concat(skip ?? []));
  const out = [], top = hi ?? lo;
  if (!skip.has('ml') && top < 1000) out.push({ text: `${metric(lo)}${hi != null && metric(hi) !== metric(lo) ? `–${metric(hi)}` : ''} ml` });
  // Litres from 1 l up, or from 250 ml when ml is what the recipe already uses.
  if (!skip.has('l') && (top >= 1000 || (skip.has('ml') && top >= 250))) out.push({ text: `${big(lo)}${hi != null && big(hi) !== big(lo) ? `–${big(hi)}` : ''} l` });
  return out;
}

function usWeight(lo, hi, skip, by) {
  skip = new Set([].concat(skip ?? []));
  const out = [], top = hi ?? lo;
  const push = text => out.push(by ? { text, by } : { text });
  const range = (key, unit) => {
    const c = key === 'oz';
    const a = nice(lo / WT[key], c), b = hi != null ? nice(hi / WT[key], c) : null;
    return approxText(b && b.t !== a.t ? [a, b] : [a], unit);
  };
  if (!skip.has('lb') && lo >= WT.lb / 4 * 0.99) push(range('lb', 'lb'));
  const oz = lo / WT.oz, whole = Math.floor(oz / 16 + 1e-6), rem = oz - whole * 16;
  if (hi == null && whole >= 1 && rem > 0.2 && rem < 15.8) {            // "2 lb 8 oz"
    const r = nice(rem, true);
    push(`${r.approx ? '≈ ' : ''}${whole} lb ${r.t} oz`);
  }
  if (!skip.has('oz') && lo >= WT.oz / 4 * 0.99 && top <= WT.lb * 10) push(range('oz', 'oz'));
  return out;
}

function metricWeight(lo, hi, skip, by) {
  skip = new Set([].concat(skip ?? []));
  const out = [], top = hi ?? lo;
  const push = text => out.push(by ? { text, by } : { text });
  const pre = by ? '≈ ' : '';
  if (!skip.has('g') && top < 1000) push(`${pre}${metric(lo)}${hi != null && metric(hi) !== metric(lo) ? `–${metric(hi)}` : ''} g`);
  if (!skip.has('kg') && (top >= 1000 || (skip.has('g') && top >= 500))) push(`${pre}${big(lo)}${hi != null && big(hi) !== big(lo) ? `–${big(hi)}` : ''} kg`);
  return out;
}

const scaled = (v, f) => (v == null || v === '' || isNaN(v) ? null : Number(v) * f);

export function breakdown(ing, factor = 1) {
  const info = unitInfo(ing?.unit, ing?.item);
  const q = scaled(ing?.qty, factor);
  if (!info || !(q > 0)) return null;
  const qMax = scaled(ing.qtyMax, factor);
  const lo = q * info.base, hi = qMax > q ? qMax * info.base : null;
  const d = density(ing.item);
  let us, met;
  if (info.kind === 'volume') {
    us = usVolume(lo, hi, info.key);
    met = metricVolume(lo, hi, info.key);
    if (d) met.push(...metricWeight(lo * d, hi != null ? hi * d : null, null, 'weight'));
  } else {
    us = usWeight(lo, hi, info.key);
    met = metricWeight(lo, hi, info.key);
    // Weighed → roughly how much by volume: one line, cups (or tablespoons under ¼ cup).
    if (d) {
      const est = usVolume(lo / d, hi != null ? hi / d : null, ['gallon', 'quart', 'pint', 'floz', 'tsp'], 'volume')[0];
      if (est) us.push({ ...est, text: est.text.startsWith('≈') ? est.text : `≈ ${est.text}` });
    }
  }
  return us.length || met.length ? { us, metric: met } : null;
}
