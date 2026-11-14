/**
 * components/meta-editor.js — shared editor for user-owned recipe metadata (WS1 implements).
 *   editMeta(slug, { title }) → Promise<void>   opens a sheet: tags (add/remove, suggestions
 *                                               from allTags), rating 1–10 (clearable),
 *                                               proficiency 1–5 (clearable), playlists membership.
 *   metaSummary(entry) → html raw             compact read-only chips: "8/10 · ●●●○○ · #tag"
 * Writes go through store.setTags / setRating / setProficiency / addToPlaylist (batched).
 */
import { html } from '../util.js';
export async function editMeta(slug) { /* WS1 */ }
export function metaSummary(entry) {
  return html`<span class="muted small">${entry?.rating ? `${entry.rating}/10` : 'Unrated'}</span>`;
}
