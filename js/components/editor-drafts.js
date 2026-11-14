/**
 * components/editor-drafts.js — device-local drafts for the add / upload / edit forms (WS3).
 *   draftKey.new · draftKey.upload · draftKey.edit(slug)
 *   loadDraft(key) → { ...fields, savedAt } | null      saveDraft(key, fields)   clearDraft(key)
 *   draftAge(iso) → "just now" · "12 min ago" · "today 6:40 PM" · "Nov 12, 6:40 PM"
 * Files (photos, uploads) can't be stored — only text fields.
 */
const PREFIX = 'bb.draft:';
export const draftKey = { new: 'new', upload: 'upload', edit: slug => `edit:${slug}` };

export function loadDraft(key) {
  try { const v = JSON.parse(localStorage.getItem(PREFIX + key) || 'null'); return v && typeof v === 'object' ? v : null; }
  catch { return null; }
}
export function saveDraft(key, fields) {
  try { localStorage.setItem(PREFIX + key, JSON.stringify({ ...fields, savedAt: new Date().toISOString() })); return true; }
  catch { return false; }   // quota / private mode
}
export function clearDraft(key) { try { localStorage.removeItem(PREFIX + key); } catch { /* ignore */ } }

export function draftAge(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return 'earlier';
  const mins = Math.round((Date.now() - d) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  if (new Date().toDateString() === d.toDateString()) return `today ${time}`;
  return `${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}, ${time}`;
}
