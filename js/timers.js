/**
 * timers.js — global countdown timers (WS4 implements; this is the contract).
 *   mount()                                   create the timers tray in #tools (called once by app.js)
 *   startTimer({ label, seconds, slug, stepId }) → id   starts + persists (endAt) across reloads
 *   cancelTimer(id)   pauseTimer(id)   resumeTimer(id)   addTime(id, seconds)
 *   listTimers() → [{ id, label, seconds, endAt, pausedLeft, slug, stepId, done }]
 *   onTimers(fn) → unsubscribe            fn(list) on every tick/state change
 *
 * Notes (additive to the contract):
 *   - List items also carry `left` (ms remaining, live, ≥ 0) and `running` (bool).
 *   - Running timers persist `endAt` (epoch ms); paused ones persist `pausedLeft` (ms).
 *     Remaining time is always recomputed from Date.now() — nothing accumulates, so
 *     reloads and phone sleep never lose time. Stored under localStorage 'bb.timers'.
 *   - The tick only runs while a timer is counting, aligned to the soonest one's second.
 *   - startTimer() again with the same slug + stepId + label while that timer is live
 *     returns the existing id (double-tap guard) and opens its pill.
 */
import { html, fmtClock } from './util.js';
import { on, toast } from './ui.js';

const KEY = 'bb.timers';
const subs = new Set();
let timers = load();
let tray = null, openId = null, armedCancel = null, armT = 0, lastSig = '', tickT = 0;
const shown = new Set();          // ids already rendered (so only new pills animate in)

/* ---------- state ---------- */
function load() {
  try {
    const a = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(a) ? a.filter(t => t && t.id).map(t => ({
      id: String(t.id), label: String(t.label || 'Timer'), seconds: Math.max(1, +t.seconds || 60),
      endAt: t.endAt == null ? null : +t.endAt, pausedLeft: t.pausedLeft == null ? null : +t.pausedLeft,
      slug: t.slug ?? null, stepId: t.stepId ?? null, done: !!t.done, doneAt: t.doneAt ?? null
    })) : [];
  } catch { return []; }
}
function save() { try { localStorage.setItem(KEY, JSON.stringify(timers)); } catch { /* quota/private mode */ } }

const find = id => timers.find(t => t.id === id);
const isPaused = t => !t.done && t.pausedLeft != null;
const isRunning = t => !t.done && t.pausedLeft == null;
function leftOf(t, now = Date.now()) {
  if (t.done) return 0;
  if (t.pausedLeft != null) return Math.max(0, t.pausedLeft);
  return Math.max(0, (t.endAt || 0) - now);
}
const fmtLeft = ms => fmtClock(Math.ceil(ms / 1000) * 1000);

export function listTimers() {
  const now = Date.now();
  return timers.map(t => {
    const { id, label, seconds, endAt, pausedLeft, slug, stepId, done } = t;
    return { id, label, seconds, endAt, pausedLeft, slug, stepId, done, left: leftOf(t, now), running: isRunning(t) };
  });
}
export const onTimers = fn => (subs.add(fn), () => subs.delete(fn));
function emit() {
  const list = listTimers();
  subs.forEach(fn => { try { fn(list); } catch (e) { console.error(e); } });
}

/** After any state change: persist, then run a tick (detect finishes, repaint, notify, reschedule). */
function changed() { save(); tick(); }

function tick() {
  clearTimeout(tickT); tickT = 0;
  const now = Date.now();
  const finished = [];
  for (const t of timers) {
    if (isRunning(t) && t.endAt <= now) { t.done = true; t.doneAt = t.endAt; finished.push(t); }
  }
  if (finished.length) { save(); finished.forEach(t => onFinish(t)); }
  render(now);
  onState(finished);
  emit();
  const running = timers.filter(isRunning);
  if (running.length) {
    // Wake just after the soonest timer crosses a whole second, so it reads and fires on time.
    const soon = Math.min(...running.map(t => leftOf(t, now)));
    tickT = setTimeout(tick, (soon % 1000 || 1000) + 15);
  }
}

/* ---------- public API ---------- */
export function startTimer({ label = 'Timer', seconds = 60, slug = null, stepId = null } = {}) {
  onStart();
  label = String(label || 'Timer').trim() || 'Timer';
  seconds = Math.max(1, Math.round(+seconds || 60));
  const dup = stepId != null && timers.find(t => !t.done && t.slug === slug && t.stepId === stepId && t.label === label);
  if (dup) {
    openId = dup.id; changed();
    toast(`${label} is already running`);
    return dup.id;
  }
  const t = {
    id: 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
    label, seconds, endAt: Date.now() + seconds * 1000, pausedLeft: null,
    slug: slug || null, stepId: stepId ?? null, done: false, doneAt: null
  };
  timers.push(t);
  changed();
  return t.id;
}

export function cancelTimer(id) {
  const i = timers.findIndex(t => t.id === id);
  if (i < 0) return;
  timers.splice(i, 1);
  if (openId === id) openId = null;
  onCancel(id);
  changed();
}

export function pauseTimer(id) {
  const t = find(id);
  if (!t || !isRunning(t)) return;
  t.pausedLeft = leftOf(t); t.endAt = null;
  changed();
}

export function resumeTimer(id) {
  const t = find(id);
  if (!t || !isPaused(t)) return;
  t.endAt = Date.now() + t.pausedLeft; t.pausedLeft = null;
  changed();
}

/** Add (or with a negative number, remove) time. On a finished timer this is "snooze". */
export function addTime(id, seconds = 60) {
  const t = find(id);
  if (!t) return;
  const ms = Math.round(+seconds * 1000) || 0;
  if (t.done) {
    t.done = false; t.doneAt = null; t.pausedLeft = null;
    t.endAt = Date.now() + Math.max(1000, ms); t.seconds = Math.max(1, Math.round(ms / 1000));
    onCancel(id);
  } else {
    if (t.pausedLeft != null) t.pausedLeft = Math.max(0, t.pausedLeft + ms);
    else t.endAt += ms;
    t.seconds = Math.max(1, t.seconds + Math.round(ms / 1000));
  }
  changed();
}

/* ---------- alarm hooks (filled in by the alarm section below) ---------- */
function onStart() {}
function onFinish() {}
function onCancel() {}
function onState() {}

/* ---------- tray UI ---------- */
const I = {
  pause: html`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6v12M15 6v12"/></svg>`,
  play: html`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l10.5-6.5z"/></svg>`,
  plus: html`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>`,
  go: html`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>`,
  x: html`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>`,
  bell: html`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 1.5h-15z"/><path d="M10 20.5a2.2 2.2 0 0 0 4 0"/></svg>`
};

function ring(t, now) {
  if (t.done) return html`<span class="tt-ico">${I.bell}</span>`;
  const pct = Math.max(0, Math.min(100, (leftOf(t, now) / (t.seconds * 1000)) * 100));
  return html`<svg class="tt-ring" viewBox="0 0 24 24" aria-hidden="true">
    <circle class="tt-ring-track" cx="12" cy="12" r="9"/>
    <circle class="tt-ring-fill" cx="12" cy="12" r="9" pathLength="100" stroke-dasharray="100" stroke-dashoffset="${(100 - pct).toFixed(1)}"/>
    ${isPaused(t) ? html`<path class="tt-ring-pause" d="M10.2 9.5v5M13.8 9.5v5"/>` : ''}
  </svg>`;
}

function pill(t, now) {
  const state = t.done ? 'done' : isPaused(t) ? 'paused' : 'running';
  const open = openId === t.id;
  const isNew = !shown.has(t.id);
  const left = leftOf(t, now);
  return html`<div class="tt-pill is-${state}${isNew ? ' is-new' : ''}${!t.done && isRunning(t) && left <= 10000 ? ' is-soon' : ''}" data-id="${t.id}"${open ? ' data-open' : ''}>
    <button type="button" class="tt-main" data-act="toggle" aria-expanded="${open}"${open ? html` aria-controls="tt-c-${t.id}"` : ''}>
      ${ring(t, now)}
      <span class="tt-label">${t.label}</span>
      <span class="tt-left">${t.done ? 'Done' : fmtLeft(left)}</span>
      <span class="sr-only">${state === 'running' ? 'remaining' : state}</span>
    </button>
    ${open ? controls(t) : ''}
  </div>`;
}

function controls(t) {
  const armed = armedCancel === t.id;
  return html`<div class="tt-ctrls" id="tt-c-${t.id}" role="group" aria-label="${t.label} timer">
    ${t.done ? '' : isPaused(t)
      ? html`<button type="button" class="tt-act" data-act="resume">${I.play}<span>Resume</span></button>`
      : html`<button type="button" class="tt-act" data-act="pause">${I.pause}<span>Pause</span></button>`}
    <button type="button" class="tt-act" data-act="add" aria-label="Add 1 minute">${I.plus}<span>1 min</span></button>
    ${t.slug ? html`<a class="tt-act" href="#/r/${t.slug}" data-act="go">${I.go}<span>Recipe</span></a>` : ''}
    <button type="button" class="tt-act tt-cancel${armed ? ' is-armed' : ''}" data-act="cancel"
      aria-label="${armed ? 'Tap again to cancel the timer' : 'Cancel timer'}">${I.x}<span>${armed ? 'Sure?' : 'Cancel'}</span></button>
  </div>`;
}

const sigOf = () => timers.map(t => `${t.id}:${t.done ? 'd' : isPaused(t) ? 'p' : 'r'}`).join(',') + `|${openId}|${armedCancel}`;

function render(now = Date.now()) {
  if (!tray) return;
  if (openId && !find(openId)) openId = null;
  const sig = sigOf();
  if (sig === lastSig) return paint(now);
  lastSig = sig;
  // Keep keyboard focus on the equivalent control across the re-render.
  const f = document.activeElement;
  const keep = tray.contains(f) ? { id: f.closest('[data-id]')?.dataset.id, act: f.dataset.act } : null;
  tray.hidden = !timers.length;
  tray.innerHTML = html`${timers.map(t => pill(t, now))}`;
  timers.forEach(t => shown.add(t.id));
  if (keep?.id) {
    const swap = { pause: 'resume', resume: 'pause' };
    const box = tray.querySelector(`[data-id="${keep.id}"]`);
    (box?.querySelector(`[data-act="${keep.act}"]`) || box?.querySelector(`[data-act="${swap[keep.act]}"]`) || box?.querySelector('.tt-main'))?.focus({ preventScroll: true });
  }
}

/** Cheap per-second update: text + ring only. */
function paint(now) {
  tray.querySelectorAll('.tt-pill').forEach(el => {
    const t = find(el.dataset.id);
    if (!t || t.done) return;
    const left = leftOf(t, now);
    const txt = fmtLeft(left);
    const out = el.querySelector('.tt-left');
    if (out.textContent !== txt) out.textContent = txt;
    const pct = Math.max(0, Math.min(100, (left / (t.seconds * 1000)) * 100));
    el.querySelector('.tt-ring-fill')?.setAttribute('stroke-dashoffset', (100 - pct).toFixed(1));
    el.classList.toggle('is-soon', isRunning(t) && left <= 10000);
  });
}

function onTrayClick(e, el) {
  const id = el.closest('[data-id]')?.dataset.id;
  const t = id && find(id);
  if (!t) return;
  const act = el.dataset.act;
  if (act !== 'cancel') disarm();
  if (act === 'toggle') {
    if (t.done) { onState([], true); return; }
    openId = openId === id ? null : id;
    render();
  } else if (act === 'pause') pauseTimer(id);
  else if (act === 'resume') resumeTimer(id);
  else if (act === 'add') addTime(id, 60);
  else if (act === 'go') {
    e.preventDefault();
    openId = null; render();
    location.hash = `#/r/${t.slug}`;
  } else if (act === 'cancel') {
    if (armedCancel === id) { disarm(); cancelTimer(id); toast(`${t.label} timer cancelled`); return; }
    armedCancel = id;
    clearTimeout(armT);
    armT = setTimeout(() => { disarm(); render(); }, 3000);
    render();
  }
}
function disarm() { armedCancel = null; clearTimeout(armT); }

export function mount() {
  if (tray) return;
  let host = document.getElementById('tools');
  if (!host) { host = document.createElement('div'); host.id = 'tools'; document.body.append(host); }
  tray = document.createElement('div');
  tray.className = 'tt-tray';
  tray.setAttribute('role', 'region');
  tray.setAttribute('aria-label', 'Timers');
  tray.hidden = true;
  host.prepend(tray);
  on(tray, 'click', '[data-act]', onTrayClick);
  // Tap anywhere else collapses an open pill.
  document.addEventListener('click', e => {
    if (openId && !e.composedPath().includes(tray)) { openId = null; disarm(); render(); }
  });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') tick(); });
  window.addEventListener('storage', e => { if (e.key === KEY) { timers = load(); tick(); } });   // other tabs
  tick();
}
