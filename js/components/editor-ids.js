/**
 * components/editor-ids.js — stable ids for edited ingredient / step lists (WS3). Pure.
 * Journal notes point at step ids, so an edit must never renumber or reuse them.
 *
 *   mergeIngredients(parsed, prev, reserved?) → ingredients with ids
 *   mergeSteps(parsed, prev, reserved?)       → steps with ids
 *       parsed:   output of parseIngredients / parseSteps (no ids)
 *       prev:     the saved list (with ids); [] for a new recipe → i1..iN / s1..sN
 *       reserved: extra ids that must never be handed out again (e.g. journal stepIds)
 *     Unchanged lines keep the saved object verbatim (curated timer labels, odd units…);
 *     edited lines keep their id and take the new fields; steps keep old timer labels
 *     for timers whose duration didn't change. An ingredient whose item changed drops its
 *     `density` (grams per spoon/cup of the old item).
 *   matchItems(newKeys, oldKeys) → map: new index → old index | -1
 *       1) exact key (any position — moving a line keeps its id)
 *       2) between exact anchors: word similarity; for steps (slot: true) a 1-for-1
 *          replacement in the same slot keeps the id even when fully rewritten
 *   similarity(a, b)  → 0..1 (Dice over word sets)
 *   nextIdNumber(ids, prefix) → 1 + highest number used by any id with that prefix
 */
import { formatIngredientLine } from './editor-parse.js';

/** Exact-match key: whitespace and quote style don't count as an edit; case does. */
export const normKey = s => String(s ?? '').replace(/[’']/g, "'").replace(/\s+/g, ' ').trim();
const words = s => new Set(normKey(s).toLowerCase().match(/[\p{L}\d]+/gu) || []);

export function similarity(a, b) {
  const A = words(a), B = words(b);
  if (!A.size && !B.size) return 1;
  if (!A.size || !B.size) return 0;
  let common = 0;
  for (const w of A) if (B.has(w)) common++;
  return (2 * common) / (A.size + B.size);
}

const same = (nk, ok) => (Array.isArray(nk) ? nk.includes(ok) : nk === ok);
const textOf = nk => (Array.isArray(nk) ? nk[0] : nk);

export function matchItems(newKeys, oldKeys, { threshold = 0.5, gapThreshold = 0.25, slot = true } = {}) {
  const N = newKeys.length, M = oldKeys.length;
  const map = new Array(N).fill(-1), used = new Array(M).fill(false);

  for (let i = 0; i < N; i++) {
    // prefer the same position when the same text appears more than once
    if (i < M && !used[i] && same(newKeys[i], oldKeys[i])) { map[i] = i; used[i] = true; continue; }
    for (let j = 0; j < M; j++) if (!used[j] && same(newKeys[i], oldKeys[j])) { map[i] = j; used[j] = true; break; }
  }

  const anchor = map.slice();
  const cands = [];
  for (let i = 0; i < N; i++) {
    if (anchor[i] !== -1) continue;
    let p = i - 1; while (p >= 0 && anchor[p] === -1) p--;
    let q = i + 1; while (q < N && anchor[q] === -1) q++;
    const lo = p >= 0 ? anchor[p] : -1, hi = q < N ? anchor[q] : M;
    const gapOld = [];
    for (let j = lo + 1; j < hi; j++) if (!used[j]) gapOld.push(j);
    const gapNew = q - p - 1, offset = i - p - 1;
    for (let j = 0; j < M; j++) {
      if (used[j]) continue;
      const sim = similarity(textOf(newKeys[i]), oldKeys[j]);
      const g = gapOld.indexOf(j);
      const sameSlot = slot && g !== -1 && g === offset && gapOld.length === gapNew;
      if (sim >= threshold || (g !== -1 && sim >= gapThreshold) || sameSlot) {
        cands.push({ i, j, score: sim + (g !== -1 ? 0.3 : 0) + (sameSlot ? 0.3 : 0) - Math.abs(i - j) * 0.001 });
      }
    }
  }
  cands.sort((a, b) => b.score - a.score);
  for (const c of cands) if (map[c.i] === -1 && !used[c.j]) { map[c.i] = c.j; used[c.j] = true; }
  return map;
}

export function nextIdNumber(ids, prefix) {
  let max = 0;
  const re = new RegExp(`^${prefix}(\\d+)$`);
  for (const id of ids || []) { const m = re.exec(String(id ?? '')); if (m) max = Math.max(max, +m[1]); }
  return max + 1;
}

function assign(parsed, prev, prefix, reserved, newKeyOf, oldKeyOf, build, opts) {
  prev = Array.isArray(prev) ? prev : [];
  const map = matchItems(parsed.map(newKeyOf), prev.map(oldKeyOf), opts);
  let next = nextIdNumber([...prev.map(o => o.id), ...(reserved || [])], prefix);
  const taken = new Set();
  return parsed.map((p, i) => {
    const old = map[i] >= 0 ? prev[map[i]] : null;
    if (old?.id && !taken.has(old.id)) { taken.add(old.id); return build(p, old, same(newKeyOf(p), oldKeyOf(old))); }
    return build(p, null, false, `${prefix}${next++}`);
  });
}

const ING_FIELDS = ['qty', 'qtyMax', 'unit', 'item', 'note'];

export function mergeIngredients(parsed, prev = [], reserved = []) {
  return assign(parsed, prev, 'i', reserved,
    p => [normKey(p.line ?? formatIngredientLine(p)), normKey(formatIngredientLine(p))],
    o => normKey(formatIngredientLine(o)),
    (p, old, exact, id) => {
      const fields = Object.fromEntries(ING_FIELDS.map(k => [k, p[k] ?? null]));
      if (!old) return { id, section: p.section ?? null, ...fields };
      if (exact) return { ...old, section: p.section ?? null };
      const { density, ...rest } = old;
      return { ...(normKey(p.item) === normKey(old.item) ? old : rest), section: p.section ?? null, ...fields };
    }, { slot: false });   // a different ingredient in the same spot is a new ingredient
}

/** Keep curated labels ("Dry brine") for timers whose duration is unchanged. */
export function relabelTimers(timers, oldTimers) {
  const pool = [...(oldTimers || [])];
  return (timers || []).map(t => {
    const k = pool.findIndex(o => o.seconds === t.seconds);
    if (k === -1) return t;
    const [o] = pool.splice(k, 1);
    return { ...t, label: o.label || t.label };
  });
}

export function mergeSteps(parsed, prev = [], reserved = []) {
  return assign(parsed, prev, 's', reserved,
    p => normKey(p.text),
    o => normKey(o.text),
    (p, old, exact, id) => {
      if (!old) return { id, section: p.section ?? null, text: p.text, timers: p.timers || [], tip: p.tip ?? null };
      if (exact) return { ...old, section: p.section ?? null, tip: p.tip ?? null };
      return { ...old, section: p.section ?? null, text: p.text, timers: relabelTimers(p.timers, old.timers), tip: p.tip ?? null };
    });
}
