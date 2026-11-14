/**
 * util.js — pure helpers shared by every view. No DOM state, no network.
 *
 * Exports: esc, html, raw, slugify, uid, nowIso, today, fmtMinutes, fmtClock,
 *          parseDurations, fmtQty, scaleQty, debounce, clamp,
 *          blobToBase64, textToBase64, compressImage, fileExt
 */

/** HTML-escape any value. */
export function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const RAW = Symbol('raw');
/** Mark a string as trusted HTML so `html` won't escape it. */
export const raw = s => ({ [RAW]: true, s: String(s ?? ''), toString() { return this.s; } });

/**
 * Tagged template: escapes interpolations, flattens arrays, passes raw()/nested html through.
 *   el.innerHTML = html`<p>${name}</p>${items.map(i => html`<li>${i}</li>`)}`;
 * Returns a raw object (stringifies to the HTML), so results nest safely.
 */
export function html(strings, ...vals) {
  let out = strings[0];
  vals.forEach((v, i) => { out += render(v) + strings[i + 1]; });
  return raw(out);
}
function render(v) {
  if (v == null || v === false) return '';
  if (Array.isArray(v)) return v.map(render).join('');
  if (v[RAW]) return v.s;
  return esc(v);
}
export const toStr = v => (v && v[RAW] ? v.s : String(v ?? ''));

export function slugify(s) {
  return String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+/, '').slice(0, 60).replace(/-+$/, '') || 'recipe';
}

/** uid('n') → "n-20261114-ab12" ; uid() → "20261114-101500-ab12" */
export function uid(prefix) {
  const d = new Date(), p = n => String(n).padStart(2, '0');
  const date = `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}`;
  const rnd = Math.random().toString(36).slice(2, 6);
  if (prefix) return `${prefix}-${date}-${rnd}`;
  return `${date}-${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}-${rnd}`;
}

export const nowIso = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
export const today = () => nowIso().slice(0, 10);
export const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

/** 95 → "1 hr 35 min" */
export function fmtMinutes(min) {
  if (min == null || isNaN(min)) return '';
  min = Math.round(min);
  const h = Math.floor(min / 60), m = min % 60;
  return [h && `${h} hr`, (m || !h) && `${m} min`].filter(Boolean).join(' ');
}

/** ms → "4:05" or "1:04:05" */
export function fmtClock(ms, { tenths = false } = {}) {
  const neg = ms < 0; ms = Math.abs(ms);
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), s = total % 60;
  const pad = n => String(n).padStart(2, '0');
  let out = h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
  if (tenths) out += '.' + Math.floor((ms % 1000) / 100);
  return (neg ? '-' : '') + out;
}

const UNIT_SECONDS = { s: 1, sec: 1, secs: 1, second: 1, seconds: 1, m: 60, min: 60, mins: 60, minute: 60, minutes: 60, h: 3600, hr: 3600, hrs: 3600, hour: 3600, hours: 3600 };
const FRACTIONS = { '½': 0.5, '¼': 0.25, '¾': 0.75, '⅓': 1 / 3, '⅔': 2 / 3 };
const NUM = String.raw`(\d+(?:[.,]\d+)?(?:\s*[½¼¾⅓⅔])?|[½¼¾⅓⅔]|an?|(?:twenty|thirty|forty|fifty)(?:[-\s](?:one|two|three|four|five|six|seven|eight|nine))?|one|two|three|four|five|six|seven|eight|nine|ten|twelve|fifteen|ninety)`;
const WORDS = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  twelve: 12, fifteen: 15, twenty: 20, thirty: 30, forty: 40, fifty: 50, ninety: 90 };
// (?<!\w) rather than \b: \b never matches before a bare "½" (two non-word chars in a row)
const DUR_RE = new RegExp(String.raw`(?<!\w)${NUM}(?:\s*(?:-|–|to)\s*${NUM})?\s*(hours?|hrs?|h|minutes?|mins?|m|seconds?|secs?|s)\b(?:\s*(?:and\s*)?${NUM}\s*(minutes?|mins?|m|seconds?|secs?)\b)?`, 'gi');

function toNum(t) {
  if (t == null) return NaN;
  t = t.toLowerCase().trim();
  if (t in WORDS) return WORDS[t];
  const compound = t.match(/^([a-z]+)[-\s]+([a-z]+)$/); // "twenty-five" / "thirty five"
  if (compound && compound[1] in WORDS && compound[2] in WORDS) return WORDS[compound[1]] + WORDS[compound[2]];
  let n = 0;
  const frac = t.match(/[½¼¾⅓⅔]/);
  if (frac) { n += FRACTIONS[frac[0]]; t = t.replace(frac[0], '').trim(); }
  if (t) n += parseFloat(t.replace(',', '.'));
  return n;
}

/**
 * Find durations in free text → [{ seconds, maxSeconds, label, index, length }].
 * "simmer 10–15 minutes" → seconds 600, maxSeconds 900. "1 hour 20 minutes" → 4800.
 * Bare "m"/"s"/"h" units only count when attached to a number ("5m", "30s").
 */
export function parseDurations(text) {
  const out = [];
  if (!text) return out;
  for (const m of text.matchAll(DUR_RE)) {
    const [whole, a, b, unit, c, unit2] = m;
    if (/^[mhs]$/i.test(unit) && !/\d[mhs]\b/i.test(whole.replace(/\s+/g, ''))) continue;
    const mult = UNIT_SECONDS[unit.toLowerCase()];
    if (!mult) continue;
    let lo = toNum(a) * mult, hi = b ? toNum(b) * mult : null;
    if (c && unit2) { const extra = toNum(c) * UNIT_SECONDS[unit2.toLowerCase()]; lo += extra; if (hi) hi += extra; }
    if (!(lo > 0)) continue;
    out.push({ seconds: Math.round(lo), maxSeconds: hi ? Math.round(hi) : null, label: whole.trim(), index: m.index, length: whole.length });
  }
  return out;
}

const VULGAR = [[1 / 8, '⅛'], [1 / 4, '¼'], [1 / 3, '⅓'], [3 / 8, '⅜'], [1 / 2, '½'], [5 / 8, '⅝'], [2 / 3, '⅔'], [3 / 4, '¾'], [7 / 8, '⅞']];
/** 1.5 → "1½", 0.333 → "⅓", 2.2 → "2.2", 12 → "12" */
export function fmtQty(n) {
  if (n == null || n === '' || isNaN(n)) return '';
  n = Number(n);
  const whole = Math.floor(n + 1e-9), frac = n - whole;
  if (frac < 0.02) return String(whole);
  for (const [v, g] of VULGAR) if (Math.abs(frac - v) < 0.03) return (whole ? whole : '') + g;
  if (frac > 0.97) return String(whole + 1);
  return String(Math.round(n * 100) / 100);
}

/** Scale and round sensibly (keeps small quantities precise). */
export function scaleQty(qty, factor) {
  if (qty == null || qty === '' || isNaN(qty)) return qty;
  const v = Number(qty) * factor;
  if (v >= 10) return Math.round(v * 2) / 2;
  return Math.round(v * 100) / 100;
}

export function debounce(fn, ms = 300) {
  let t;
  const d = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  d.flush = (...a) => { clearTimeout(t); return fn(...a); };
  return d;
}

export const fileExt = name => (String(name).match(/\.([a-z0-9]{1,8})$/i)?.[1] || '').toLowerCase();

/** Blob/File → base64 (no data: prefix). */
export function blobToBase64(blob) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(',')[1] || '');
    r.onerror = () => rej(r.error);
    r.readAsDataURL(blob);
  });
}
/** UTF-8 string → base64. */
export function textToBase64(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/**
 * Downscale a phone photo before upload. Returns a JPEG Blob (or the original
 * file if it isn't an image the browser can decode, e.g. HEIC on some browsers).
 */
export async function compressImage(file, { max = 1600, quality = 0.82 } = {}) {
  if (!file || !/^image\//.test(file.type) || file.type === 'image/gif') return file;
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const w = Math.round(bmp.width * scale), h = Math.round(bmp.height * scale);
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    canvas.getContext('2d').drawImage(bmp, 0, 0, w, h);
    bmp.close?.();
    const blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', quality));
    return blob && blob.size < file.size ? blob : file;
  } catch {
    return file;
  }
}
