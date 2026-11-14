/**
 * components/editor-parse.js — pure text ⇄ recipe-structure helpers for the editor (WS3).
 * No DOM, no network, no state: unit-tested by tests/editor-parse.html.
 *
 *   parseQty(str)               → { qty, qtyMax, rest }     leading amount / range ("1 1/2", "2-3", "½", "two")
 *   normalizeUnit(token)        → short unit ('tsp', 'tbsp', 'cup', 'fl oz', 'pkg', …) | null
 *   parseIngredientLine(line)   → { qty, qtyMax, unit, item, note }
 *   parseIngredients(text)      → [{ qty, qtyMax, unit, item, note, section, line }]
 *                                 one per line; "Sauce:" / "## Sauce" set `section`, "---" clears it
 *   formatIngredientLine(ing)   → "1½ cups flour, sifted"   (inverse — re-parses to the same fields)
 *   formatIngredients(list)     → textarea text incl. section header lines
 *   parseSteps(text)            → [{ section, text, tip, timers:[{ label, seconds }] }]
 *                                 one step per paragraph (blank line), or per line if no blank lines;
 *                                 "Tip: …" right after a step → its tip; a "…:" line is a section header,
 *                                 unless it reads as an instruction ("Make the dressing:") and is alone in
 *                                 its paragraph (blank line after) — then it stays a step
 *   formatSteps(steps)          → textarea text (paragraphs, "Section:" headers, "Tip:" lines)
 *   detectTimers(text, n)       → [{ label, seconds }]   via util.parseDurations; ranges → low value
 *   timerLabel(text, index, n)  → "Simmer", "Rest chicken", … or "Step n"
 *   parseLines(text)            → trimmed non-empty lines, bullets removed (equipment)
 *   linkType(url)               → 'youtube' | 'instagram' | 'tiktok' | 'web'
 */
import { parseDurations, fmtQty } from '../util.js';

/* ---------- quantities ---------- */
const VULGAR = { '½': '1/2', '⅓': '1/3', '⅔': '2/3', '¼': '1/4', '¾': '3/4', '⅕': '1/5', '⅖': '2/5', '⅗': '3/5', '⅘': '4/5', '⅙': '1/6', '⅚': '5/6', '⅛': '1/8', '⅜': '3/8', '⅝': '5/8', '⅞': '7/8' };
const FR = Object.keys(VULGAR).join('');
const asciiFractions = s => s.replace(/⁄/g, '/')
  .replace(new RegExp(`(\\d)?\\s*([${FR}])`, 'g'), (m, d, f) => `${d ? d + ' ' : ' '}${VULGAR[f]}`)
  .replace(/\s+/g, ' ').trim();

// 1½ · 1 ½ · 1 1/2 · 1-1/2 · 1 and 1/2 · 1/2 · ½ · 1.5 · .5 · 12
const NUMBER = String.raw`(?:\d+\s*[${FR}]|\d+(?:\s+|\s*-\s*|\s+and\s+)\d+[\/⁄]\d+|\d+[\/⁄]\d+|[${FR}]|\d*\.\d+|\d+)`;
const QTY_RE = new RegExp(String.raw`^(${NUMBER})(?:\s*(?:-|–|—|\bto\b|\bor\b)\s*(${NUMBER}))?(?![\d\/⁄.])`, 'i');
const WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, dozen: 12 };
const WORD_RE = /^(one and a half|a dozen|a couple(?: of)?|half(?: an?)?|an?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|dozen)\b\s*/i;
// "a few …", "a splash of …": an article, not an amount
const NOT_AMOUNT = /^(few|little|bit|lot|splash|drizzle|knob|squeeze|dollop|sprinkle|sprinkling|touch|dab|glug)\b/i;

const round4 = n => Math.round(n * 1e4) / 1e4;
function numVal(t) {
  t = asciiFractions(t);
  let m = t.match(/^(\d+)(?:\s+|\s*-\s*|\s+and\s+)(\d+)\/(\d+)$/);
  if (m) return +m[3] ? round4(+m[1] + m[2] / m[3]) : NaN;
  m = t.match(/^(\d+)\/(\d+)$/);
  if (m) return +m[2] ? round4(m[1] / m[2]) : NaN;
  return round4(parseFloat(t));
}

/** Leading amount of a string → { qty, qtyMax, rest }; qty is null when there is none. */
export function parseQty(input) {
  const s = String(input ?? '').replace(/\s+/g, ' ').trim();
  const m = s.match(QTY_RE);
  if (m) {
    const after = s.slice(m[0].length);
    const qty = numVal(m[1]);
    // "1-inch piece ginger": the number is a size, not an amount
    if (/^-\p{L}/u.test(after) || !Number.isFinite(qty)) return { qty: null, qtyMax: null, rest: s };
    let qtyMax = m[2] != null ? numVal(m[2]) : null;
    if (qtyMax != null && !(qtyMax > qty)) qtyMax = null;
    return { qty, qtyMax, rest: after.trim() };
  }
  const w = s.match(WORD_RE);
  if (w) {
    const word = w[1].toLowerCase();
    const after = s.slice(w[0].length);
    if (/^an?$/.test(word) && NOT_AMOUNT.test(after)) return { qty: null, qtyMax: null, rest: s };
    if (/^an?$/.test(word) && /^half\b/i.test(after)) return { qty: 0.5, qtyMax: null, rest: after.replace(/^half\s*/i, '') };
    const qty = word === 'one and a half' ? 1.5 : word === 'a dozen' ? 12 : word.startsWith('a couple') ? 2
      : word.startsWith('half') ? 0.5 : /^an?$/.test(word) ? 1 : WORDS[word];
    if (after || word !== 'a') return { qty, qtyMax: null, rest: after.trim() };
  }
  return { qty: null, qtyMax: null, rest: s };
}

/* ---------- units ---------- */
const UNIT_ALIASES = {
  tsp: 'tsp tsps ts tspn teaspoon teaspoons',
  tbsp: 'tbsp tbsps tbs tbl tbls tblsp tablespoon tablespoons',
  cup: 'cup cups c',
  oz: 'oz ozs ounce ounces',
  'fl oz': 'floz',
  lb: 'lb lbs pound pounds',
  g: 'g gs gr grs gram grams gramme grammes',
  kg: 'kg kgs kilo kilos kilogram kilograms kilogramme kilogrammes',
  mg: 'mg milligram milligrams',
  ml: 'ml mls milliliter milliliters millilitre millilitres',
  cl: 'cl centiliter centiliters centilitre centilitres',
  dl: 'dl deciliter deciliters decilitre decilitres',
  l: 'l ltr ltrs liter liters litre litres',
  pinch: 'pinch pinches',
  dash: 'dash dashes',
  clove: 'clove cloves',
  can: 'can cans tin tins',
  stick: 'stick sticks',
  slice: 'slice slices',
  sprig: 'sprig sprigs',
  bunch: 'bunch bunches',
  piece: 'piece pieces pc pcs',
  pkg: 'pkg pkgs package packages packet packets pack packs',
  quart: 'quart quarts qt qts',
  pint: 'pint pints pt pts',
  gallon: 'gallon gallons gal gals',
  handful: 'handful handfuls',
  head: 'head heads',
  jar: 'jar jars',
  stalk: 'stalk stalks',
  bag: 'bag bags',
  box: 'box boxes',
  bottle: 'bottle bottles',
  sheet: 'sheet sheets',
  drop: 'drop drops',
  cube: 'cube cubes',
  envelope: 'envelope envelopes',
  carton: 'carton cartons',
  container: 'container containers',
  loaf: 'loaf loaves',
  fillet: 'fillet fillets',
  rib: 'rib ribs',
  strip: 'strip strips',
  ear: 'ear ears'
};
const UNIT_OF = new Map();
for (const [u, list] of Object.entries(UNIT_ALIASES)) for (const a of list.split(' ')) UNIT_OF.set(a, u);
for (const u of Object.keys(UNIT_ALIASES)) UNIT_OF.set(u.replace(' ', ''), u);
const PLURAL = { cup: 'cups', clove: 'cloves', can: 'cans', stick: 'sticks', slice: 'slices', sprig: 'sprigs', bunch: 'bunches', piece: 'pieces', pinch: 'pinches', dash: 'dashes', quart: 'quarts', pint: 'pints', gallon: 'gallons', handful: 'handfuls', head: 'heads', jar: 'jars', stalk: 'stalks', bag: 'bags', box: 'boxes', bottle: 'bottles', sheet: 'sheets', drop: 'drops', cube: 'cubes', envelope: 'envelopes', carton: 'cartons', container: 'containers', loaf: 'loaves', fillet: 'fillets', rib: 'ribs', strip: 'strips', ear: 'ears' };

/** "Tablespoons" → "tbsp", "T" → "tbsp", "t" → "tsp", "fl. oz." → "fl oz"; unknown → null. */
export function normalizeUnit(token) {
  const t = String(token ?? '').replace(/\./g, '').replace(/\s+/g, ' ').trim();
  if (!t) return null;
  if (/^(T|Tb|TB|Tbs|TBS|TBSP)$/.test(t)) return 'tbsp';
  const low = t.toLowerCase();
  if (/^(fl ?oz|fl ?ozs|fluid ounces?|fl ounces?)$/.test(low)) return 'fl oz';
  if (low === 't') return 'tsp';
  return UNIT_OF.get(low) || null;
}

const SIZE_RE = /^(small|medium|large|extra[- ]large|jumbo|heaping|heaped|level|scant|generous|good|big|rounded)\s+/i;
function takeUnit(rest) {
  let m = rest.match(/^(fl\.?\s*oz\.?|fluid\s+ounces?|fl\.?\s+ounces?)(?=[\s,(]|$)/i);
  if (m) return { unit: 'fl oz', word: m[0], rest: rest.slice(m[0].length).trim() };
  m = rest.match(/^([A-Za-z]+)\.?(?=[\s,(;]|$)/);
  if (m) {
    const unit = normalizeUnit(m[1]);
    if (unit) return { unit, word: m[0], rest: rest.slice(m[0].length).trim() };
  }
  return null;
}

/* ---------- ingredient lines ---------- */
const BULLET_RE = /^(?:[-*•·▪◦‣▢☐□✓✔]+|\[\s?[xX]?\])\s*/;
const stripBullet = s => s.replace(BULLET_RE, '').trim();
const ZEST_RE = /^((?:finely\s+)?(?:grated\s+)?(?:zest|juice)(?:\s+and\s+(?:zest|juice))?)\s+(?:of|from)\s+/i;
const SUFFIX_RE = /\s+((?:to taste|as needed|as required|if needed|for (?:serving|garnish|garnishing|drizzling|dusting|frying|greasing|brushing|the pan)|optional)(?:\s.*)?|(?:plus|or) more\b.*)$/i;

/** Split "item, note" at the first top-level comma (or spaced dash). "bone-in, skin-on thighs" stays whole. */
function splitNote(s) {
  let depth = 0, start = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '(' || c === '[') depth++;
    else if ((c === ')' || c === ']') && depth) depth--;
    else if (c === ',' && !depth) {
      const seg = s.slice(start, i).trim();
      const next = s.slice(i + 1).split(',')[0].trim();
      // "bone-in, skin-on chicken", "boneless, skinless thighs": a lone compound/-less adjective
      if (!/\s/.test(seg) && /-|less$/i.test(seg) && next.split(/\s+/).length >= 2) { start = i + 1; continue; }
      return [s.slice(0, i).trim(), s.slice(i + 1).trim()];
    }
  }
  const dash = s.match(/\s[–—-]\s/);
  if (dash && !/\(/.test(s.slice(0, dash.index))) return [s.slice(0, dash.index).trim(), s.slice(dash.index + dash[0].length).trim()];
  return [s.trim(), ''];
}

/** Pull "(…)" groups out of a string → { text, notes[] }. Unbalanced parens stay literal. */
function pullParens(s) {
  const notes = []; let out = '', buf = '', depth = 0;
  for (const c of s) {
    if (c === '(') { if (depth++ === 0) { buf = ''; continue; } }
    else if (c === ')' && depth) { if (--depth === 0) { if (buf.trim()) notes.push(buf.trim()); continue; } }
    if (depth) buf += c; else out += c;
  }
  if (depth) out += '(' + buf;
  return { text: out.replace(/\s+/g, ' ').replace(/\s+([,;])/g, '$1').trim(), notes };
}

/** One ingredient line → { qty, qtyMax, unit, item, note }. Never throws. */
export function parseIngredientLine(input) {
  const line = stripBullet(String(input ?? '').replace(/\s+/g, ' ').trim());
  const notes = [];
  let s = line;

  const zest = s.match(ZEST_RE);
  if (zest) {
    const w = zest[1].toLowerCase();
    notes.push(/zest/.test(w) && /juice/.test(w) ? 'zested and juiced' : /zest/.test(w) ? 'zested' : 'juiced');
    s = s.slice(zest[0].length);
  }

  let { qty, qtyMax, rest } = parseQty(s);
  let unit = null, unitWord = '';

  if (qty != null) {
    // "1 (14 oz) can tomatoes"
    if (rest.startsWith('(')) {
      const close = rest.indexOf(')');
      if (close > 0) { notes.push(rest.slice(1, close).trim()); rest = rest.slice(close + 1).trim(); }
    }
    let u = takeUnit(rest);
    const size = !u && rest.match(SIZE_RE);
    if (size) {
      const u2 = takeUnit(rest.slice(size[0].length));
      if (u2) { u = u2; notes.push(size[1].toLowerCase()); }
    }
    if (u) { unit = u.unit; unitWord = u.word; rest = u.rest; }
  } else {
    // "Pinch of salt", "Head of garlic"
    const u = takeUnit(rest);
    if (u && /^of\s/i.test(u.rest)) { qty = 1; unit = u.unit; unitWord = u.word; rest = u.rest; }
  }
  rest = rest.replace(/^of\s+/i, '');

  let [itemPart, commaNote] = splitNote(rest);
  const p = pullParens(itemPart);
  let item = p.text;
  notes.push(...p.notes);
  const suf = item.match(SUFFIX_RE);
  if (suf && suf.index > 0) { item = item.slice(0, suf.index).trim(); notes.push(suf[1].trim()); }
  if (commaNote) notes.push(commaNote);

  if (!item && unit) { item = unitWord.replace(/\.$/, ''); unit = null; }   // "6 cloves" (the spice)
  if (!item) return { qty: null, qtyMax: null, unit: null, item: line, note: null };
  const note = notes.filter(Boolean).join(', ') || null;
  return { qty, qtyMax, unit, item, note };
}

/* ---------- section headers ---------- */
const RESET_RE = /^(?:-{3,}|#{1,6}|_{3,})$/;
/** Header line → section name, null for a "---" reset, undefined when it's not a header. */
function sectionHeader(line, maxLen) {
  if (RESET_RE.test(line)) return null;
  let m = line.match(/^#{1,6}\s+(.+?)\s*#*$/);
  if (m) return cleanSection(m[1]);
  m = line.match(/^\*\*(.+?)\*\*:?$/);
  if (m) return cleanSection(m[1]);
  m = line.match(/^(.+?)\s*:$/);
  if (m && m[1].length <= maxLen && !/^\d/.test(m[1]) && !/[.!?]\s/.test(m[1])) return cleanSection(m[1]);
  return undefined;
}
function headerOf(t, maxLen) {
  if (RESET_RE.test(t)) return null;
  return sectionHeader(/^\*\*.+\*\*:?$/.test(t) ? t : stripBullet(t), maxLen);
}
const cleanSection = s => {
  const t = s.replace(/^[*_\s]+|[*_:\s]+$/g, '').trim();
  return t ? t[0].toUpperCase() + t.slice(1) : null;
};

/** Textarea → ingredients. Each carries `line` (the cleaned source line) for id matching. */
export function parseIngredients(text) {
  const out = [];
  let section = null;
  for (const raw of String(text ?? '').split(/\r?\n/)) {
    const t = raw.trim();
    if (!t) continue;
    const h = headerOf(t, 60);
    if (h !== undefined) { section = h; continue; }
    const line = stripBullet(t).replace(/\s+/g, ' ');
    if (!line) continue;
    out.push({ ...parseIngredientLine(line), section, line });
  }
  return out;
}

const fmtNum = n => fmtQty(n) || String(n);
const displayUnit = (unit, amount) => (amount != null && amount > 1 && PLURAL[unit]) || unit;

/** Ingredient → editable line. parseIngredientLine(formatIngredientLine(x)) ≈ x. */
export function formatIngredientLine(ing) {
  if (!ing) return '';
  const parts = [];
  if (ing.qty != null && ing.qty !== '') parts.push(ing.qtyMax != null ? `${fmtNum(ing.qty)}-${fmtNum(ing.qtyMax)}` : fmtNum(ing.qty));
  if (ing.unit) parts.push(displayUnit(ing.unit, ing.qtyMax ?? ing.qty));
  if (ing.item) parts.push(ing.item);
  let s = parts.join(' ');
  if (ing.note) s += `, ${ing.note}`;
  return s;
}

export function formatIngredients(list = []) {
  const lines = [];
  let section = null;
  for (const ing of list || []) {
    const sec = ing.section || null;
    if (sec !== section) {
      if (lines.length) lines.push('');
      lines.push(sec ? `${sec}:` : '---');
      section = sec;
    }
    lines.push(formatIngredientLine(ing));
  }
  return lines.join('\n');
}

/* ---------- steps ---------- */
const STEP_NUM_RE = /^(?:step\s*)?\d{1,2}\s*[.):]\s+|^step\s+\d{1,2}\s*[-–—]?\s+/i;
const TIP_RE = /^tips?\s*[:\-–—]\s*(.+)$/i;
const LEAD_VERBS = new Set(('add combine make prepare place put transfer season toss pour assemble serve chop slice dice cut ' +
  'arrange spread top garnish remove divide shape roll fold layer line grease sprinkle scatter squeeze rub coat dredge dip ' +
  'stuff fill wrap pat finish start trim peel mince grate zest juice measure sift gather').split(' '));
const LEAD_OBJECTS = new Set('it them this these that those everything together'.split(' '));
/** "Make the dressing:", "Whisk together:" read as an instruction; "Pan sauce:", "Brown butter:" as a label. */
function isInstruction(line) {
  const w = stripBullet(line).replace(/\s*:$/, '').toLowerCase().split(/\s+/);
  return w.length > 1 && (VERBS.has(w[0]) || LEAD_VERBS.has(w[0])) && (DETS.has(w[1]) || LEAD_OBJECTS.has(w[1]));
}

/** Textarea → steps (no ids). An instruction-like "…:" line alone in its paragraph stays a step. */
export function parseSteps(text) {
  const src = String(text ?? '').replace(/\r\n?/g, '\n');
  const paragraphs = /\n[ \t]*\n/.test(src.trim());
  const lines = src.split('\n');
  const steps = [];
  let section = null, cur = null;
  const flush = () => { if (cur?.text) steps.push(cur); cur = null; };
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (!t) { if (paragraphs) flush(); continue; }
    const h = headerOf(t, 48);
    const loneStep = paragraphs && !cur && !lines[i + 1]?.trim() && isInstruction(t);
    if (h !== undefined && !loneStep) { flush(); section = h; continue; }
    const tip = t.match(TIP_RE);
    if (tip) {
      const target = cur || steps[steps.length - 1];
      if (target) { target.tip = target.tip ? `${target.tip} ${tip[1].trim()}` : tip[1].trim(); continue; }
    }
    const numbered = STEP_NUM_RE.test(t);
    const body = stripBullet(t).replace(STEP_NUM_RE, '').trim();
    if (!body) continue;
    if (!paragraphs || !cur || numbered || cur.tip) { flush(); cur = { section, text: body, tip: null }; }
    else cur.text += ' ' + body;
  }
  flush();
  return steps.map((s, i) => ({ section: s.section, text: s.text, tip: s.tip, timers: detectTimers(s.text, i + 1) }));
}

export function formatSteps(steps = []) {
  const blocks = [];
  let section = null;
  for (const s of steps || []) {
    const sec = s.section || null;
    let head = '';
    if (sec !== section) {
      // an instruction-like name ("Make the glaze") sits right on its first step, else it would re-parse as a step
      if (sec && isInstruction(sec)) head = `${sec}:\n`;
      else blocks.push(sec ? `${sec}:` : '---');
      section = sec;
    }
    const text = String(s.text || '').replace(/\s*\n\s*/g, ' ').trim();
    blocks.push(head + (s.tip ? `${text}\nTip: ${String(s.tip).replace(/\s*\n\s*/g, ' ').trim()}` : text));
  }
  return blocks.join('\n\n');
}

/* ---------- timers ---------- */
const VERBS = new Set(('bake roast simmer boil cook sear fry deep-fry stir-fry saute sauté brown rest marinate chill refrigerate ' +
  'freeze proof prove rise knead whisk stir reduce steep soak brine braise broil grill toast steam poach blanch cool sit ' +
  'microwave smoke caramelize caramelise render melt heat preheat flip cover dry ferment beat blend mix process pulse churn ' +
  'infuse bloom thaw defrost drain char crisp warm wait cure dehydrate glaze baste set rise sweat wilt reheat bake').split(' '));
const DETS = new Set('the a an your each all both remaining reserved some'.split(' '));
const STOPS = new Set(('it them this that these those everything for until till about at in on over under with without to and or ' +
  'then again more another additional longer while by from into onto up down off out of is are so just very until low high ' +
  'medium uncovered covered undisturbed together briefly gently lightly well minute minutes hour hours second seconds min mins ' +
  'hr hrs before after once when if as per side sides skin-side').split(' '));
const cap = s => s ? s[0].toUpperCase() + s.slice(1) : s;

/** Short label for the duration at `index` in `text`: nearest cooking verb (+ its object). */
export function timerLabel(text, index = 0, n = 1) {
  const s = String(text ?? '');
  let start = 0, end = s.length;
  for (const m of s.matchAll(/[.!?;](?=\s|$)/g)) {
    if (m.index < index) start = m.index + 1;
    else { end = m.index; break; }
  }
  const sentence = s.slice(start, end);
  const at = index - start;
  const toks = [...sentence.matchAll(/[\p{L}’'-]+|\d[\d.,/]*|[^\s\p{L}\d]/gu)].map(m => ({ w: m[0], lw: m[0].toLowerCase(), i: m.index }));
  const isVerb = t => VERBS.has(t.lw);
  let vi = -1;
  for (let k = toks.length - 1; k >= 0; k--) if (toks[k].i < at && isVerb(toks[k])) { vi = k; break; }
  if (vi < 0) vi = toks.findIndex(t => t.i >= at && isVerb(t));
  if (vi < 0) return `Step ${n}`;
  const nouns = [];
  let k = vi + 1;
  while (k < toks.length && DETS.has(toks[k].lw)) k++;
  for (; k < toks.length && nouns.length < 2; k++) {
    const t = toks[k];
    if (!/^[\p{L}][\p{L}’'-]*$/u.test(t.w) || STOPS.has(t.lw) || VERBS.has(t.lw) || /ly$/.test(t.lw) || t.w.length < 2) break;
    nouns.push(t.lw);
  }
  const verb = cap(toks[vi].lw);
  let label = [verb, ...nouns].join(' ');
  if (label.length > 24) label = nouns.length ? `${verb} ${nouns[0]}` : verb;
  if (label.length > 24) label = verb;
  return label;
}

/** Durations in a step → timers [{ label, seconds }] (ranges use the low value). */
export function detectTimers(text, n = 1) {
  return parseDurations(String(text ?? ''))
    .map(d => ({ label: timerLabel(text, d.index, n), seconds: Math.round(d.seconds) }))
    .filter(t => t.seconds > 0);
}

/* ---------- misc ---------- */
export function parseLines(text) {
  return String(text ?? '').split(/\r?\n/).map(l => stripBullet(l.trim())).filter(Boolean);
}

export function linkType(url) {
  let host = '';
  try { host = new URL(/^[a-z][\w+.-]*:\/\//i.test(url) ? url : `https://${url}`).hostname.toLowerCase(); }
  catch { return 'web'; }
  host = host.replace(/^(www|m|mobile)\./, '');
  if (host === 'youtu.be' || host === 'youtube.com' || host.endsWith('.youtube.com') || host === 'youtube-nocookie.com') return 'youtube';
  if (host === 'instagram.com' || host.endsWith('.instagram.com') || host === 'instagr.am') return 'instagram';
  if (host === 'tiktok.com' || host.endsWith('.tiktok.com')) return 'tiktok';
  return 'web';
}
