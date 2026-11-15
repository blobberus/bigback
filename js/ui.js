/**
 * ui.js — DOM helpers shared by views. Never use window.alert/confirm/prompt.
 *   $(sel, root) $$(sel, root)  on(root, 'click', '[data-act]', (e, el) => …)  (delegated)
 *   toast('Saved', { type: 'ok'|'error'|'info', ms })
 *   sheet({ title, body, actions:[{ label, value, kind:'primary'|'danger'|'ghost' }] }) → Promise<value|null>
 *       body: html string/raw or Node. Resolves null on dismiss. sheet.el is available via onOpen(el).
 *       Modal: role=dialog + aria-modal, named by its title (or `label`), background inert,
 *       focus moved in / restored, Tab trapped, Escape closes the top sheet (if dismissable).
 *       Stays above the phone's on-screen keyboard. A sticky footer (see .picker-sheet in
 *       library.css) keeps the action buttons on screen in long sheets.
 *   confirmSheet(message, { ok:'Delete', danger:true }) → Promise<boolean>
 *   promptSheet(title, { value, placeholder, ok, multiline }) → Promise<string|null>
 *   busy(button, promise) — disables + spinner until promise settles
 *   stars(n, max) → html string (read-only ●○ meter)
 *   reducedMotion() → bool    scrollToEl(el, block='center') — smooth only when motion is welcome
 */
import { esc, toStr } from './util.js';

export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];

/** True when the user asked the OS for less motion — skip smooth scrolls and JS animations. */
export const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
/** scrollIntoView that only animates when motion is welcome. */
export const scrollToEl = (el, block = 'center') => el?.scrollIntoView({ block, behavior: reducedMotion() ? 'auto' : 'smooth' });

export function on(root, type, selector, fn, opts) {
  const h = e => { const el = e.target.closest(selector); if (el && root.contains(el)) fn(e, el); };
  root.addEventListener(type, h, opts);
  return () => root.removeEventListener(type, h, opts);
}

/* Toasts are announced by the #toasts container (index.html: aria-live="polite", present from
   page load so screen readers register it). Errors also get role="alert" so they interrupt. */
export function toast(msg, { type = 'info', ms = 2600 } = {}) {
  let host = $('#toasts');
  if (!host) {
    host = document.createElement('div'); host.id = 'toasts';
    host.setAttribute('aria-live', 'polite'); document.body.append(host);
  }
  const t = document.createElement('div');
  t.className = `toast toast-${type}`;
  if (type === 'error') t.setAttribute('role', 'alert');
  t.textContent = msg;
  host.append(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, type === 'error' ? Math.max(ms, 5000) : ms);
}

/* ---------- sheets (modal dialogs) ----------
   Open sheets stack (topmost last). While any is open, everything else in <body> except the
   toasts is made inert, the page behind can't scroll (html.sheet-open), Tab cycles inside the
   top sheet, and only the top sheet reacts to Escape. Focus moves in on open ([autofocus] or
   the sheet itself) and back on close. Dismissable sheets also close on a tap outside or a
   swipe down that starts at the top of the sheet's own scroll (phone layout). */
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';
const openSheets = [];
let sheetSeq = 0;

function syncInert() {
  const top = openSheets[openSheets.length - 1];
  for (const el of document.body.children) {
    const block = !!top && el !== top && el.id !== 'toasts' && el.tagName !== 'SCRIPT';
    if (block && !el.inert) { el.inert = true; el.dataset.sheetInert = ''; }
    else if (!block && 'sheetInert' in el.dataset) { el.inert = false; delete el.dataset.sheetInert; }
  }
}

function syncScrollLock() {
  document.documentElement.classList.toggle('sheet-open', openSheets.length > 0);
  fitViewport();
}

/* On-screen keyboard: phones lay it over the page instead of shrinking the page (iOS always,
   Android Chrome by default), so a bottom sheet would sit behind it with its text box hidden.
   While a sheet is open the backdrop is fitted to the visual viewport (--vv-top / --vv-h on
   <html>), which lifts the sheet to just above the keyboard; html.kb-open drops the home-bar
   padding meanwhile, and the focused field is scrolled into view inside the sheet. */
const vv = window.visualViewport;
let vvFrame = 0;
function fitViewport() {
  vvFrame = 0;
  const de = document.documentElement, st = de.style;
  if (!vv || !openSheets.length || Math.abs(vv.scale - 1) > 0.01) {   // pinch-zoomed: leave it be
    st.removeProperty('--vv-top'); st.removeProperty('--vv-h'); de.classList.remove('kb-open');
    return;
  }
  st.setProperty('--vv-top', `${Math.round(vv.offsetTop)}px`);
  st.setProperty('--vv-h', `${Math.round(vv.height)}px`);
  de.classList.toggle('kb-open', de.clientHeight - vv.height > 120);
  revealFocus();
}
const queueFit = () => { if (!vvFrame) vvFrame = requestAnimationFrame(fitViewport); };
vv?.addEventListener('resize', queueFit);
vv?.addEventListener('scroll', queueFit);

/** Scroll the top sheet so its focused text field sits above any sticky footer (Done / Apply). */
function revealFocus() {
  const box = openSheets[openSheets.length - 1]?.querySelector('.sheet');
  const f = document.activeElement;
  if (!box || !f || !box.contains(f) || !f.matches('input, textarea, select')) return;
  const foot = box.querySelector('.sheet-actions');
  const covered = foot && getComputedStyle(foot).position === 'sticky' ? foot.offsetHeight : 0;
  const over = f.getBoundingClientRect().bottom - (box.getBoundingClientRect().bottom - covered - 12);
  if (over > 0) box.scrollTop += over;
}

/** Drag the bottom sheet down to close it. Only from the top of its own scroll, so scrolling a
 *  long sheet still works; a short pull springs back. */
function swipeToClose(wrap, box, close) {
  let y0 = 0, x0 = 0, t0 = 0, dy = 0, mode = null;           // null → undecided, 'drag' | 'skip'
  const phone = () => !matchMedia('(min-width: 700px)').matches;
  box.addEventListener('touchstart', e => {
    const t = e.touches[0];
    mode = e.touches.length !== 1 || !phone() || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) ? 'skip' : null;
    y0 = t.clientY; x0 = t.clientX; t0 = Date.now(); dy = 0;
  }, { passive: true });
  box.addEventListener('touchmove', e => {
    if (mode === 'skip') return;
    const t = e.touches[0], d = t.clientY - y0, dx = t.clientX - x0;
    if (mode === null) {
      if (Math.abs(d) < 6 && Math.abs(dx) < 6) return;
      mode = d > 0 && Math.abs(d) > Math.abs(dx) && box.scrollTop <= 0 ? 'drag' : 'skip';
      if (mode === 'skip') return;
      box.style.transition = 'none';
    }
    if (e.cancelable) e.preventDefault();                   // the sheet moves, not the page
    dy = Math.max(0, d);
    box.style.transform = `translateY(${dy}px)`;
    wrap.style.backgroundColor = `rgb(20 16 12 / ${(0.45 * Math.max(0, 1 - dy / box.offsetHeight)).toFixed(3)})`;
  }, { passive: false });
  const end = () => {
    if (mode !== 'drag') { mode = null; return; }
    mode = null;
    const fast = dy > 40 && dy / Math.max(1, Date.now() - t0) > 0.45;
    // Clearing the inline styles lets the CSS transition carry the sheet on from where the finger left it.
    box.style.transition = ''; box.style.transform = ''; wrap.style.backgroundColor = '';
    if (fast || dy > Math.min(120, box.offsetHeight * 0.3)) close(null);
  };
  box.addEventListener('touchend', end);
  box.addEventListener('touchcancel', end);
}

function trapTab(e, box) {
  const items = [...box.querySelectorAll(FOCUSABLE)].filter(el => el.offsetParent !== null || el === document.activeElement);
  if (!items.length) { e.preventDefault(); box.focus(); return; }
  const first = items[0], last = items[items.length - 1], cur = document.activeElement;
  if (e.shiftKey && (cur === first || cur === box || !box.contains(cur))) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && (cur === last || !box.contains(cur))) { e.preventDefault(); first.focus(); }
}

/**
 * Optional extras (all backward compatible): label — accessible name when there is no title;
 * role — 'dialog' (default) or 'alertdialog' for confirmations/alarms that need a response.
 */
export function sheet({ title = '', body = '', actions = [], onOpen, dismissable = true, className = '', label = '', role = 'dialog' } = {}) {
  return new Promise(resolve => {
    const prevFocus = document.activeElement;
    const id = `sheet-${++sheetSeq}`;
    const wrap = document.createElement('div');
    wrap.className = 'sheet-backdrop';
    const name = title ? `aria-labelledby="${id}-t"` : label ? `aria-label="${esc(label)}"` : '';
    wrap.innerHTML = `
      <div class="sheet ${esc(className)}" role="${role === 'alertdialog' ? 'alertdialog' : 'dialog'}" aria-modal="true" ${name} tabindex="-1">
        <div class="sheet-grip" aria-hidden="true"></div>
        ${title ? `<h2 class="sheet-title" id="${id}-t">${esc(title)}</h2>` : ''}
        <div class="sheet-body"></div>
        ${actions.length ? `<div class="sheet-actions">${actions.map((a, i) =>
          `<button type="button" class="btn ${a.kind === 'primary' ? 'btn-primary' : a.kind === 'danger' ? 'btn-danger' : 'btn-ghost'}" data-i="${i}">${esc(a.label)}</button>`).join('')}</div>` : ''}
      </div>`;
    const box = wrap.querySelector('.sheet');
    const bodyEl = wrap.querySelector('.sheet-body');
    if (body instanceof Node) bodyEl.append(body); else bodyEl.innerHTML = toStr(body);
    let closed = false;
    const close = v => {
      if (closed) return;
      closed = true;
      wrap.classList.remove('open');
      wrap.style.pointerEvents = 'none';                 // taps fall through during the exit animation
      document.removeEventListener('keydown', onKey);
      openSheets.splice(openSheets.indexOf(wrap), 1);
      syncInert();
      syncScrollLock();
      wrap.inert = true;
      setTimeout(() => wrap.remove(), reducedMotion() ? 0 : 220);
      // Back to whatever opened the sheet; if a re-render removed it, to the page itself.
      if (prevFocus?.isConnected) prevFocus.focus?.({ preventScroll: true });
      else if (prevFocus && prevFocus !== document.body) document.getElementById('view')?.focus({ preventScroll: true });
      resolve(v);
    };
    const onKey = e => {
      if (openSheets[openSheets.length - 1] !== wrap) return;
      if (e.key === 'Escape' && dismissable) { e.preventDefault(); close(null); }
      else if (e.key === 'Tab') trapTab(e, box);
    };
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
    openSheets.push(wrap);
    syncInert();
    syncScrollLock();
    if (dismissable) swipeToClose(wrap, box, close);
    requestAnimationFrame(() => wrap.classList.add('open'));
    onOpen?.(wrap, close);
    // Focus synchronously: iOS only raises the keyboard for focus() inside the opening tap.
    if (!closed && !box.contains(document.activeElement)) (box.querySelector('[autofocus]') || box).focus({ preventScroll: true });
  });
}

export async function confirmSheet(message, { title = 'Are you sure?', ok = 'Confirm', danger = false } = {}) {
  const id = `confirm-${++sheetSeq}`;
  const v = await sheet({
    title, body: `<p id="${id}">${esc(message)}</p>`, role: 'alertdialog',
    actions: [{ label: 'Cancel', value: false }, { label: ok, value: true, kind: danger ? 'danger' : 'primary' }],
    onOpen: w => w.querySelector('.sheet').setAttribute('aria-describedby', id)
  });
  return v === true;
}

export async function promptSheet(title, { value = '', placeholder = '', ok = 'Save', multiline = false } = {}) {
  const field = multiline
    ? `<textarea class="input" rows="4" placeholder="${esc(placeholder)}" aria-label="${esc(title)}" autofocus>${esc(value)}</textarea>`
    : `<input class="input" value="${esc(value)}" placeholder="${esc(placeholder)}" aria-label="${esc(title)}" autofocus>`;
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
  return `<span class="meter" role="img" aria-label="${n} of ${max}">${'●'.repeat(n)}<span class="meter-off">${'○'.repeat(max - n)}</span></span>`;
}

/** Report a failed write in a friendly way. */
export function reportError(err) {
  console.error(err);
  if (err?.name === 'NotConnectedError') toast(err.message, { type: 'error' });
  else if (err?.status === 401) toast('GitHub token rejected — update it in Settings.', { type: 'error' });
  else if (err?.status === 403 || err?.status === 404) toast('Token lacks write access to the repo (Contents: read & write).', { type: 'error' });
  else toast(err?.message || 'Something went wrong.', { type: 'error' });
}
