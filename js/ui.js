/**
 * ui.js — DOM helpers shared by views. Never use window.alert/confirm/prompt.
 *   $(sel, root) $$(sel, root)  on(root, 'click', '[data-act]', (e, el) => …)  (delegated)
 *   toast('Saved', { type: 'ok'|'error'|'info', ms })
 *   sheet({ title, body, actions:[{ label, value, kind:'primary'|'danger'|'ghost' }] }) → Promise<value|null>
 *       body: html string/raw or Node. Resolves null on dismiss. sheet.el is available via onOpen(el).
 *   confirmSheet(message, { ok:'Delete', danger:true }) → Promise<boolean>
 *   promptSheet(title, { value, placeholder, ok, multiline }) → Promise<string|null>
 *   busy(button, promise) — disables + spinner until promise settles
 *   stars(n, max) → html string (read-only ●○ meter)
 */
import { esc, toStr } from './util.js';

export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];

export function on(root, type, selector, fn, opts) {
  const h = e => { const el = e.target.closest(selector); if (el && root.contains(el)) fn(e, el); };
  root.addEventListener(type, h, opts);
  return () => root.removeEventListener(type, h, opts);
}

export function toast(msg, { type = 'info', ms = 2600 } = {}) {
  let host = $('#toasts');
  if (!host) { host = document.createElement('div'); host.id = 'toasts'; document.body.append(host); }
  const t = document.createElement('div');
  t.className = `toast toast-${type}`;
  t.setAttribute('role', type === 'error' ? 'alert' : 'status');
  t.textContent = msg;
  host.append(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, type === 'error' ? Math.max(ms, 5000) : ms);
}

export function sheet({ title = '', body = '', actions = [], onOpen, dismissable = true, className = '' } = {}) {
  return new Promise(resolve => {
    const prevFocus = document.activeElement;
    const wrap = document.createElement('div');
    wrap.className = 'sheet-backdrop';
    wrap.innerHTML = `
      <div class="sheet ${esc(className)}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
        <div class="sheet-grip" aria-hidden="true"></div>
        ${title ? `<h2 class="sheet-title">${esc(title)}</h2>` : ''}
        <div class="sheet-body"></div>
        ${actions.length ? `<div class="sheet-actions">${actions.map((a, i) =>
          `<button type="button" class="btn ${a.kind === 'primary' ? 'btn-primary' : a.kind === 'danger' ? 'btn-danger' : 'btn-ghost'}" data-i="${i}">${esc(a.label)}</button>`).join('')}</div>` : ''}
      </div>`;
    const bodyEl = wrap.querySelector('.sheet-body');
    if (body instanceof Node) bodyEl.append(body); else bodyEl.innerHTML = toStr(body);
    const close = v => {
      wrap.classList.remove('open');
      document.removeEventListener('keydown', onKey);
      setTimeout(() => wrap.remove(), 220);
      prevFocus?.focus?.();
      resolve(v);
    };
    const onKey = e => { if (e.key === 'Escape' && dismissable) close(null); };
    wrap.addEventListener('click', e => {
      if (e.target === wrap && dismissable) return close(null);
      const b = e.target.closest('[data-i]');
      if (b) {
        const a = actions[+b.dataset.i];
        const v = typeof a.value === 'function' ? a.value(wrap) : a.value;
        if (v !== undefined) close(v);
      }
    });
    document.addEventListener('keydown', onKey);
    document.body.append(wrap);
    requestAnimationFrame(() => { wrap.classList.add('open'); (wrap.querySelector('[autofocus]') || wrap.querySelector('.sheet'))?.focus?.(); });
    wrap.querySelector('.sheet').tabIndex = -1;
    onOpen?.(wrap, close);
  });
}

export async function confirmSheet(message, { title = 'Are you sure?', ok = 'Confirm', danger = false } = {}) {
  const v = await sheet({
    title, body: `<p>${esc(message)}</p>`,
    actions: [{ label: 'Cancel', value: false }, { label: ok, value: true, kind: danger ? 'danger' : 'primary' }]
  });
  return v === true;
}

export async function promptSheet(title, { value = '', placeholder = '', ok = 'Save', multiline = false } = {}) {
  const field = multiline
    ? `<textarea class="input" rows="4" placeholder="${esc(placeholder)}" autofocus>${esc(value)}</textarea>`
    : `<input class="input" value="${esc(value)}" placeholder="${esc(placeholder)}" autofocus>`;
  return sheet({
    title, body: field,
    actions: [{ label: 'Cancel', value: null }, { label: ok, kind: 'primary', value: w => w.querySelector('.input').value.trim() }],
    onOpen: (w, close) => {
      const inp = w.querySelector('.input');
      if (!multiline) inp.addEventListener('keydown', e => { if (e.key === 'Enter') close(inp.value.trim()); });
    }
  });
}

export async function busy(btn, promise) {
  const label = btn?.innerHTML;
  if (btn) { btn.disabled = true; btn.classList.add('is-busy'); }
  try { return await promise; }
  finally { if (btn) { btn.disabled = false; btn.classList.remove('is-busy'); btn.innerHTML = label; } }
}

/**
 * Set the top bar for the current view.
 *   setTopbar({ title: 'Recipes', back: '#/' , actions: html`<button …>` })
 */
export function setTopbar({ title = 'Bigback', back = null, actions = '' } = {}) {
  document.title = title === 'Bigback' ? 'Bigback — Recipe Vault' : `${title} · Bigback`;
  const t = $('#topbar-title'); if (t) t.textContent = title;
  const b = $('#topbar-back');
  if (b) { b.hidden = !back; if (back) b.setAttribute('href', back); }
  const a = $('#topbar-actions'); if (a) a.innerHTML = toStr(actions);
}

export function stars(n, max) {
  if (n == null) return '';
  return `<span class="meter" aria-label="${n} of ${max}">${'●'.repeat(n)}<span class="meter-off">${'○'.repeat(max - n)}</span></span>`;
}

/** Report a failed write in a friendly way. */
export function reportError(err) {
  console.error(err);
  if (err?.name === 'NotConnectedError') toast(err.message, { type: 'error' });
  else if (err?.status === 401) toast('GitHub token rejected — update it in Settings.', { type: 'error' });
  else if (err?.status === 403 || err?.status === 404) toast('Token lacks write access to the repo (Contents: read & write).', { type: 'error' });
  else toast(err?.message || 'Something went wrong.', { type: 'error' });
}
