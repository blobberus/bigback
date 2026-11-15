/**
 * components/back-nav.js — the in-app ← goes back to the page you came from, like the phone's
 * Back: history.back() returns to that page's own history entry, so the Recipes list or a
 * playlist comes back with its search, filters and scroll position (library.js keeps them in the
 * entry) instead of as a fresh copy of the route. A Home Screen app has no browser Back button.
 *   backTarget(isParent) → hash | null
 *       call at the start of a view's render: the page this history entry was opened from, when
 *       isParent(hash) accepts it (a recipe takes the lists, cook mode its recipe). Decided once
 *       per entry and kept in history.state, so Back / Forward and reloads keep the answer; a deep
 *       link or a page reached any other way gets null.
 *   goBack(e, target)   click handler for a ← / exit link whose href is the fallback route: with a
 *       target, history.back() instead of following the link
 * The previous page comes from hashchange's oldURL, so this module has to be loaded before the
 * hop it judges: library.js imports it for list → recipe.
 */
const hashOf = url => { const s = String(url || ''), i = s.indexOf('#'); return i < 0 ? '' : s.slice(i); };
let last = null;      // the latest hash navigation: { from, to }
addEventListener('hashchange', e => { last = { from: hashOf(e.oldURL), to: hashOf(e.newURL) }; });

const stateObj = () => (history.state && typeof history.state === 'object' ? history.state : {});

export function backTarget(isParent) {
  const st = stateObj();
  if ('backTo' in st) return st.backTo;
  const from = last && last.to === location.hash && isParent(last.from) ? last.from : null;
  history.replaceState({ ...st, backTo: from }, '');
  return from;
}

export function goBack(e, target) {
  if (!target) return;
  e.preventDefault();
  history.back();
}
