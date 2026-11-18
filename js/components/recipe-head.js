/**
 * components/recipe-head.js — the top of a recipe: photo, times and source.
 * Pure markup, shared by the recipe page (views/recipe.js) and the public share page (share.js).
 *   heroHtml(r)         → <figure class="rx-hero"> with the dish photo, or a placeholder pan
 *   statsHtml(r)        → <dl class="rx-stats"> Prep / Cook / Total / Serves ('' when none)
 *   sourceHtml(r)       → "Source" line: link host, author, archived source files ('' when none)
 */
import { mediaUrl, rawUrl } from '../store.js';
import { html, fmtMinutes } from '../util.js';
import { icon } from './recipe-icons.js';

const safeUrl = u => (/^https?:\/\//i.test(String(u || '')) ? u : null);
const host = u => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; } };
const fileName = p => String(p).split('/').pop();

export function heroHtml(r) {
  if (r.image) {
    return html`<figure class="rx-hero"><img src="${mediaUrl(r.image)}" data-fallback="${rawUrl(r.image)}" alt="${r.title}" fetchpriority="high" decoding="async"></figure>`;
  }
  return html`<div class="rx-hero rx-hero-ph" aria-hidden="true">${icon('pan')}</div>`;
}

export function statsHtml(r) {
  const t = r.time || {};
  const total = t.total ?? (t.prep != null && t.cook != null ? t.prep + t.cook : null);
  const items = [['Prep', t.prep], ['Cook', t.cook], ['Total', total]]
    .filter(([, v]) => v != null && v !== '' && !isNaN(v))
    .map(([k, v]) => [k, fmtMinutes(Number(v))]);
  if (r.servings) items.push(['Serves', String(r.servings)]);
  if (!items.length) return '';
  return html`<dl class="rx-stats">${items.map(([k, v]) => html`<div><dt>${k}</dt><dd>${v}</dd></div>`)}</dl>`;
}

export function sourceHtml(r) {
  const s = r.source || {};
  const bits = [];
  const url = safeUrl(s.url);
  if (url) bits.push(html`<a href="${url}" target="_blank" rel="noopener noreferrer">${host(url)}${icon('external')}</a>`);
  if (s.author) bits.push(html`<span>by ${s.author}</span>`);
  (s.files || []).filter(Boolean).forEach(f =>
    bits.push(html`<a href="${mediaUrl(f)}" target="_blank" rel="noopener">${icon('file')}${fileName(f)}</a>`));
  if (!bits.length) return '';
  return html`<p class="rx-line rx-source"><span class="rx-label">Source</span><span class="rx-source-bits">${bits.map((b, i) =>
    i ? html`<span class="rx-dot" aria-hidden="true">·</span>${b}` : b)}</span></p>`;
}
