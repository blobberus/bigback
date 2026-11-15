/**
 * units.js — kitchen measurement conversions (US customary ⇄ metric). Pure, no DOM.
 *   unitInfo(unit, item) → { kind: 'volume' | 'weight', key, base } | null
 *       base = ml or g per one unit; null for counts and unconvertible units (clove, pinch, can)
 *   breakdown({ qty, qtyMax, unit, item }, factor) → { us: [line], metric: [line] } | null
 *       line = { text, by? }   by: 'weight' | 'volume' when it's a density estimate
 *       Equivalents only: the unit the recipe already uses is left out. Rounded to cook-friendly
 *       fractions; "≈" marks a rounding error over ~2 %.
 *   findAmounts(text, item) → [{ index, length, qty, qtyMax, unit }]   convertible amounts written
 *       in free text, e.g. an ingredient note: "or ½ tsp dried", "use 1¼ tsp Morton", "about 2.5 lb"
 *   findTemps(text) → [{ index, length, lo, hi, scale: 'F' | 'C', oven, delta }]   "350°F", "325–350 °F",
 *       "180°C", "350 degrees F", "250F"; oven = an oven setting by context ("Preheat the oven to"),
 *       not an internal / oil / water temperature. Bare "350°" (no F/C) isn't matched, nor the
 *       written-out conversion in "250°F (120°C)". delta = a change ("lower it by 25°F", "10°F hotter"),
 *       converted as a difference (25°F → 14°C).
 *   tempDetails(t) → { main, lines }   "177°C"; for oven settings also the oven-dial rounding,
 *       fan and convection settings ("Oven dial ≈ 180°C · fan 160°C", "Convection: 325°F")
 *   Converter page (views/convert.js): CONVERTERS (weight / volume / temp rows and their units),
 *       convertUnit(kind, value, from, to), parseAmount("1 1/2") → 1.5, fmtAmount(236.588) → "236.6",
 *       kitchenHint('volume', 0.4227, 'cup') → "≈ ⅜ cup"
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
    } else if (tb >= 1 || !nice(lo / VOL.tbsp).approx) plain('tbsp', 'tbsp');   // "⅔ tbsp" yes, "≈ ⅜ tbsp" no
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

/* ---------- amounts in free text ---------- */
const VULG = { '½': 1 / 2, '¼': 1 / 4, '¾': 3 / 4, '⅓': 1 / 3, '⅔': 2 / 3, '⅛': 1 / 8, '⅜': 3 / 8, '⅝': 5 / 8, '⅞': 7 / 8 };
const NUM = '(?:\\d+\\s+\\d+/\\d+|\\d+/\\d+|\\d+(?:[.,]\\d+)?(?:\\s?[½¼¾⅓⅔⅛⅜⅝⅞])?|[½¼¾⅓⅔⅛⅜⅝⅞])';
// (prefix)(number)(– number)? unit — the prefix stands in for a lookbehind, which older Safari lacks.
const AMT = new RegExp(`(^|[^\\w.,/])(${NUM})(?:\\s*(?:-|–|to)\\s*(${NUM}))?[\\s-]*(fl\\.?\\s?oz|[A-Za-z]+)\\.?(?![A-Za-z])`, 'g');

function num(s) {
  s = s.trim().replace(',', '.');
  let m;
  if ((m = s.match(/^(\d+)\s+(\d+)\/(\d+)$/))) return +m[1] + m[2] / m[3];
  if ((m = s.match(/^(\d+)\/(\d+)$/))) return m[2] > 0 ? m[1] / m[2] : NaN;
  if ((m = s.match(/^(\d+(?:\.\d+)?)?\s?([½¼¾⅓⅔⅛⅜⅝⅞])?$/)) && (m[1] || m[2])) return (m[1] ? +m[1] : 0) + (m[2] ? VULG[m[2]] : 0);
  return NaN;
}

export function findAmounts(text, item = '') {
  const out = [];
  text = String(text || '');
  for (const m of text.matchAll(AMT)) {
    const [, pre, a, b, unit] = m;
    const qty = num(a), qtyMax = b != null ? num(b) : null;
    if (!(qty > 0) || !unitInfo(unit, item)) continue;
    const index = m.index + pre.length;
    const ing = { qty, qtyMax: qtyMax > qty ? qtyMax : null, unit, item };
    if (breakdown(ing)) out.push({ index, length: m[0].length - pre.length, ...ing });
  }
  return out;
}

/* ---------- temperatures ---------- */
const T_NUM = String.raw`(\d{2,3}(?:\.\d)?)`;
const T_SYM = '[°º˚]';
// (prefix)(a)(°F)?( – b)? then the unit: °F · ° F · degrees F · deg F · F · ℉ (and the same for C).
const TEMP = new RegExp(String.raw`(^|[^\w.,/])${T_NUM}(?:\s?${T_SYM}\s?(?:[FC](?![a-z]))?)?(?:\s*(?:-|–|—|to)\s*${T_NUM})?` +
  String.raw`(?:(?:\s?${T_SYM}\s?|\s?degrees?\s|\s?deg\.?\s?|\s?)([FC]|[Ff]ahrenheit|[Cc]elsius|[Cc]entigrade)(?![A-Za-z])|\s?([℉℃]))`, 'g');
const HAS_DEG = /[°º˚℉℃]|deg/;
const ECHO = /^\s*(?:\(\s*(?:about |≈ ?|~)?|\/\s?)$/;
const OVEN = /\b(?:oven|preheat|bake[sd]?|baking|roast(?:s|ed|ing)?|broil)/i;
// Words just before the number that make it a food / oil / water temperature, in the same sentence.
const NOT_OVEN = /\b(?:internal|thermometer|reads?|registers?|reach(?:es)?|until|oil|water|fry|frying|candy|syrup|sugar|milk|cent(?:er|re)|middle|thickest|core)\b[^.;!?]*$/i;
// A change, not a reading: "lower the oven by 25°F", "it climbs 10°F as it rests", "15°F hotter".
const DELTA_BEFORE = /\b(?:by|another|climbs?|rises?|rais(?:e|es|ed)|lower(?:s|ed)?|drops?|reduce[sd]?|extra)\s+(?:about\s+|around\s+|roughly\s+|~\s?)?$/i;
const DELTA_AFTER = /^\s*(?:more|less|higher|lower|hotter|cooler|warmer|colder)\b/i;
const f2c = f => (f - 32) * 5 / 9, c2f = c => c * 9 / 5 + 32;

export function findTemps(text) {
  text = String(text || '');
  const out = [];
  let prev = null;                                     // { end, scale } of the last temperature
  for (const m of text.matchAll(TEMP)) {
    const [whole, pre, a, b, word, sym] = m;
    const scale = sym ? (sym === '℉' ? 'F' : 'C') : word[0].toUpperCase();
    const amt = whole.slice(pre.length);
    // A bare letter: "350 F" / "250F" is a temperature; "12 C" is cups, so C only when attached ("180C").
    if (!HAS_DEG.test(amt) && word === 'C' && /\sC$/.test(amt)) continue;
    const lo = Number(a), hi = b != null && Number(b) > lo ? Number(b) : null;
    if (scale === 'F' ? lo > 650 : lo > 350) continue;
    const index = m.index + pre.length;
    // "250°F (120°C)" / "350°F/175°C": the second is the written-out conversion, not a new temperature.
    const echo = prev && prev.scale !== scale && ECHO.test(text.slice(prev.end, index));
    prev = { end: index + amt.length, scale };
    if (echo) continue;
    const end = index + amt.length;
    const delta = DELTA_BEFORE.test(text.slice(Math.max(0, index - 30), index)) || DELTA_AFTER.test(text.slice(end, end + 12));
    const asF = scale === 'F' ? lo : c2f(lo);
    const oven = !delta && asF >= 200 && asF <= 550 && OVEN.test(text) && !NOT_OVEN.test(text.slice(Math.max(0, index - 48), index));
    out.push({ index, length: amt.length, lo, hi, scale, oven, delta });
  }
  return out;
}

const deg = (lo, hi, scale) => {
  const a = Math.round(lo), b = hi != null ? Math.round(hi) : null;
  return `${a}${b != null && b !== a ? `–${b}` : ''}°${scale}`;
};
const to10 = v => Math.round(v / 10) * 10, to25 = v => Math.round(v / 25) * 25;
const shift = (lo, hi, d) => [lo + d, hi != null ? hi + d : null];

export function tempDetails({ lo, hi = null, scale, oven = false, delta = false }) {
  if (delta) {                                          // a difference scales, it doesn't shift
    const k = scale === 'F' ? 5 / 9 : 9 / 5;
    return { main: deg(lo * k, hi != null ? hi * k : null, scale === 'F' ? 'C' : 'F'), lines: ['A change in temperature, not a reading'] };
  }
  const conv = scale === 'F' ? f2c : c2f;
  const main = deg(conv(lo), hi != null ? conv(hi) : null, scale === 'F' ? 'C' : 'F');
  const lines = [];
  if (oven && scale === 'F') {
    const dial = [to10(f2c(lo)), hi != null ? to10(f2c(hi)) : null];
    lines.push(`Oven dial ≈ ${deg(...dial, 'C')} · fan ${deg(...shift(...dial, -20), 'C')}`);
    lines.push(`Convection: ${deg(...shift(lo, hi, -25), 'F')}`);
  } else if (oven) {
    const dial = [to25(c2f(lo)), hi != null ? to25(c2f(hi)) : null];
    lines.push(`Oven dial ≈ ${deg(...dial, 'F')} · convection ${deg(...shift(...dial, -25), 'F')}`);
    lines.push(`Fan oven: ${deg(...shift(lo, hi, -20), 'C')}`);
  }
  return { main, lines };
}

/* ---------- converter (views/convert.js) ---------- */
/** One row per kind: units as [key, label, short singular, short plural]; `start` = the example shown first. */
export const CONVERTERS = {
  weight: {
    label: 'Weight', start: { a: 'lb', b: 'g', v: '1' },
    units: [['g', 'Grams', 'g'], ['kg', 'Kilograms', 'kg'], ['oz', 'Ounces', 'oz'], ['lb', 'Pounds', 'lb']]
  },
  volume: {
    label: 'Volume', start: { a: 'cup', b: 'ml', v: '1' },
    units: [['tsp', 'Teaspoons', 'tsp'], ['tbsp', 'Tablespoons', 'tbsp'], ['floz', 'Fluid ounces', 'fl oz'], ['cup', 'Cups', 'cup', 'cups'],
      ['pint', 'Pints', 'pt'], ['quart', 'Quarts', 'qt'], ['gallon', 'Gallons', 'gal'], ['ml', 'Milliliters', 'ml'], ['l', 'Liters', 'l']]
  },
  temp: {
    label: 'Temperature', start: { a: 'F', b: 'C', v: '350' },
    units: [['F', 'Fahrenheit', '°F'], ['C', 'Celsius', '°C']]
  }
};
const US_KITCHEN = new Set(['tsp', 'tbsp', 'floz', 'cup', 'pint', 'quart', 'gallon', 'oz', 'lb']);

/** value in `from` → value in `to` (same kind). */
export function convertUnit(kind, value, from, to) {
  if (from === to) return value;
  if (kind === 'temp') return from === 'F' ? f2c(value) : c2f(value);
  const T = kind === 'weight' ? WT : VOL;
  return value * T[from] / T[to];
}

/** What a cook types: "2", "1.5", "1,5", "1/2", "1 1/2", "1½", "½", "-18" → number; NaN otherwise. */
export function parseAmount(s) {
  s = String(s ?? '').trim();
  if (!s) return NaN;
  const neg = /^[-−–]/.test(s);
  const n = num(s.replace(/^[-−–]\s*/, '').replace(/\s+/g, ' ').replace(/^[.,]/, '0.').replace(/[.,]$/, ''));
  return neg ? -n : n;
}

/** 4 significant figures, no exponent or thousands separators: 236.6, 3785, 0.2029, 45360,
 *  0.0000001302 (not 1.302e-7), 7680000000000000000000 (not 7.68e+21). */
const FMT4 = new Intl.NumberFormat('en-US', { maximumSignificantDigits: 4, useGrouping: false });
export function fmtAmount(v) {
  if (!Number.isFinite(v)) return '';
  return Math.abs(v) < 1e-12 ? '0' : FMT4.format(v);     // also turns -0 into "0"
}

/** "≈ ⅜ cup" for a US kitchen unit when the decimal isn't already a clean measure; '' otherwise. */
export function kitchenHint(kind, value, unit) {
  if (kind === 'temp' || !US_KITCHEN.has(unit) || !(value > 0) || value >= 100) return '';
  const n = nice(value);
  if (Number.isInteger(value) || String(fmtAmount(value)) === n.t) return '';
  const exact = Math.abs(num(n.t) - value) <= value * 0.002;      // ¾ lb is 0.75 lb; 2.113 cups is only about 2⅛
  const u = CONVERTERS[kind].units.find(x => x[0] === unit);
  return `${exact ? '= ' : '≈ '}${n.t} ${value > 1 + 1e-9 && u[3] ? u[3] : u[2]}`;
}
