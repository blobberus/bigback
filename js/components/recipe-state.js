/**
 * components/recipe-state.js — per-recipe cooking state for this tab (sessionStorage),
 * shared by the recipe page and cook mode.
 *   rxState(slug) → { checked:[ingId], done:[stepId], factor, step, drafts:{key:text}, open:{key:true}, cookedAt }
 *   rxPatch(slug, patch | fn(state) → state) → new state (persisted)
 *   setDraft(slug, key, text)    remember a half-typed note (key = 'recipe' or a step id)
 *   toggleId(list, id, on?) → new list
 */
const KEY = slug => `bb.rx:${slug}`;
const defaults = () => ({ checked: [], done: [], factor: 1, step: null, drafts: {}, open: {}, cookedAt: null });

export function rxState(slug) {
  try {
    const s = JSON.parse(sessionStorage.getItem(KEY(slug)) || '{}');
    return { ...defaults(), ...(s && typeof s === 'object' ? s : {}) };
  } catch {
    return defaults();
  }
}

export function rxPatch(slug, patch) {
  const cur = rxState(slug);
  const next = typeof patch === 'function' ? (patch(cur) || cur) : { ...cur, ...patch };
  try { sessionStorage.setItem(KEY(slug), JSON.stringify(next)); } catch { /* private mode / quota */ }
  return next;
}

export function setDraft(slug, key, text) {
  rxPatch(slug, s => {
    const drafts = { ...s.drafts };
    if (text) drafts[key] = text; else delete drafts[key];
    return { ...s, drafts };
  });
}

export const toggleId = (list, id, on = !list.includes(id)) =>
  on ? [...new Set([...list, id])] : list.filter(x => x !== id);
