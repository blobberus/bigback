/**
 * timers.js — global countdown timers (WS4 implements; this is the contract).
 *   mount()                                   create the timers tray in #tools (called once by app.js)
 *   startTimer({ label, seconds, slug, stepId }) → id   starts + persists (endAt) across reloads
 *   cancelTimer(id)   pauseTimer(id)   resumeTimer(id)   addTime(id, seconds)
 *   listTimers() → [{ id, label, seconds, endAt, pausedLeft, slug, stepId, done }]
 *   onTimers(fn) → unsubscribe            fn(list) on every tick/state change
 *
 * Units: `seconds` = total duration in SECONDS; `endAt` = epoch MILLISECONDS (null while
 *   paused); `pausedLeft` = MILLISECONDS remaining while paused (null while running).
 *
 * Notes (additive to the contract):
 *   - List items also carry `left` (ms remaining, live, ≥ 0) and `running` (bool).
 *   - Remaining time is always recomputed from Date.now() — nothing accumulates, so
 *     reloads and phone sleep never lose time. Stored under localStorage 'bb.timers'.
 *   - A finished timer (done: true) rings until dismissed (= cancelTimer) or snoozed
 *     (= addTime(id, 60)); after 20 unanswered minutes it goes quiet but stays on screen.
 *     Timers that finished more than 6 hours ago are dropped on load.
 *   - The tick only runs while a timer is counting, aligned to the soonest one's second.
 *   - startTimer() again with the same slug + stepId + label while that timer is live
 *     returns the existing id (double-tap guard) and opens its pill.
 */
import { html, fmtClock } from './util.js';
import { on, sheet, toast } from './ui.js';
import { getPrefs } from './prefs.js';

const KEY = 'bb.timers';
const STALE_MS = 6 * 3600e3;      // drop timers that finished this long ago (app was closed)
const QUIET_MS = 20 * 60e3;       // stop beeping after this long unanswered (sheet stays)
const subs = new Set();
let timers = load();
let tray = null, openId = null, armedCancel = null, armT = 0, lastSig = '', tickT = 0;
const shown = new Set();          // ids already rendered (so only new pills animate in)

/* ---------- state ---------- */
function load() {
  try {
    const a = JSON.parse(localStorage.getItem(KEY) || '[]');
    const now = Date.now();
    const stale = t => (t.done ? +t.doneAt || 0 : t.pausedLeft == null ? +t.endAt || 0 : Infinity) < now - STALE_MS;
    return Array.isArray(a) ? a.filter(t => t && t.id && !stale(t)).map(t => ({
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
  onState();
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

/* ---------- alarm: sound, vibration, notification, title flash, done sheet ---------- */
const ASKED = 'bb.notifyAsked';
let actx = null, ringT = 0, ringN = 0, alarm = null;
let flash = { base: null, set: null, on: false };
const pageNotes = new Map();        // id → Notification created from the page (fallback path)

/** Called inside the startTimer tap: unlock audio for later + ask for notifications once. */
function onStart() {
  unlockAudio();
  try {
    if (!('Notification' in window) || Notification.permission !== 'default' || localStorage.getItem(ASKED)) return;
    localStorage.setItem(ASKED, '1');
    const p = Notification.requestPermission();      // non-blocking; the timer is already running
    p?.catch?.(() => {});
  } catch { /* never block a timer on this */ }
}

/** Create/resume the AudioContext. Only inside a user gesture, so iOS allows sound later. */
function unlockAudio() {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC || navigator.userActivation?.isActive === false) return;
  try {
    if (!actx) actx = new AC();
    if (actx.state !== 'running') actx.resume?.()?.catch?.(() => {});
    // A silent blip inside the gesture fully unlocks output on iOS Safari.
    const o = actx.createOscillator(), g = actx.createGain();
    g.gain.value = 0; o.connect(g); g.connect(actx.destination);
    o.start(); o.stop(actx.currentTime + 0.02);
  } catch { /* no audio on this device */ }
}

/** One "bip-bip-beep" phrase (~0.6 s). */
function beep() {
  if (!actx || actx.state !== 'running') return;
  const t0 = actx.currentTime + 0.03;
  [[0, 880], [0.2, 880], [0.4, 1175]].forEach(([dt, f]) => {
    const o = actx.createOscillator(), g = actx.createGain(), t = t0 + dt;
    o.type = 'triangle'; o.frequency.value = f;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.32, t + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.17);
    o.connect(g); g.connect(actx.destination);
    o.start(t); o.stop(t + 0.2);
  });
}

function buzz(pattern) {
  if (!navigator.vibrate || navigator.userActivation?.hasBeenActive === false) return;
  try { navigator.vibrate(pattern); } catch { /* unsupported */ }
}

function onFinish(t) {
  buzz([220, 120, 220, 120, 480]);
  notify(t);
}

function notify(t) {
  try {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    if (document.visibilityState === 'visible' && document.hasFocus()) return;  // the sheet + sound cover it
    const title = `Done: ${t.label}`;
    const opts = {
      body: 'Your timer is up.', tag: `bb-timer-${t.id}`, renotify: true, requireInteraction: true,
      icon: 'assets/icons/icon-192.png', badge: 'assets/icons/icon-192.png',
      data: { url: t.slug ? `#/r/${t.slug}` : '' }
    };
    const viaPage = () => {
      try {
        const n = new Notification(title, opts);
        n.onclick = () => { window.focus(); n.close(); };
        pageNotes.set(t.id, n);
      } catch { /* e.g. Android requires the service worker path */ }
    };
    const sw = navigator.serviceWorker;
    if (sw?.controller) sw.getRegistration().then(r => (r ? r.showNotification(title, opts) : viaPage())).catch(viaPage);
    else viaPage();
  } catch { /* notifications are a bonus */ }
}

function onCancel(id) {
  pageNotes.get(id)?.close(); pageNotes.delete(id);
  navigator.serviceWorker?.getRegistration?.()
    .then(r => r?.getNotifications({ tag: `bb-timer-${id}` }))
    .then(ns => ns?.forEach(n => n.close()))
    .catch(() => {});
}

/** Keep the ringing + sheet in step with "is anything done?" (also after a reload or another tab). */
function onState() {
  const done = timers.filter(t => t.done);
  if (!done.length) {
    stopRing();
    if (alarm) { const a = alarm; alarm = null; a.close?.(null); }
    return;
  }
  if (!ringT) { ringN = 0; ringStep(); ringT = setInterval(ringStep, 1000); }
  if (alarm) paintAlarm(); else openAlarm();
}

function ringStep() {
  const done = timers.filter(t => t.done);
  if (!done.length) return stopRing();
  // Title flash every second; a beep phrase + buzz every other second.
  if (document.title !== flash.set) flash.base = document.title;
  flash.on = !flash.on;
  flash.set = flash.on ? `Done: ${done[0].label}${done.length > 1 ? ` (+${done.length - 1})` : ''}` : flash.base;
  document.title = flash.set;
  const fresh = done.some(t => Date.now() - (t.doneAt || 0) < QUIET_MS);
  if (ringN++ % 2 === 0 && fresh) {
    if (getPrefs().sound) beep();
    if (ringN > 1) buzz([220, 120, 220]);
  }
}

function stopRing() {
  if (!ringT) return;
  clearInterval(ringT); ringT = 0;
  if (flash.set != null && document.title === flash.set && flash.base != null) document.title = flash.base;
  flash = { base: null, set: null, on: false };
  buzz(0);
}

function openAlarm() {
  const body = document.createElement('div');
  body.className = 'tt-alarm-body';
  const a = alarm = { body, sig: '', close: null, wrap: null };
  on(body, 'click', '[data-alarm]', (e, el) => {
    const id = el.dataset.id, act = el.dataset.alarm;
    if (act === 'snooze') addTime(id, 60);
    else if (act === 'dismiss') cancelTimer(id);
    else if (act === 'all') timers.filter(t => t.done).map(t => t.id).forEach(cancelTimer);
    else if (act === 'open') {
      const slug = find(id)?.slug;
      cancelTimer(id);
      if (slug) location.hash = `#/r/${slug}`;
    }
  });
  sheet({
    body, className: 'tt-alarm', dismissable: false,
    onOpen: (wrap, close) => { a.wrap = wrap; a.close = close; }
  }).then(() => { if (alarm === a) alarm = null; });
  paintAlarm();
}

const durLabel = s => {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return [h && `${h} hr`, m && `${m} min`, r && `${r} sec`].filter(Boolean).join(' ');
};
const clock = ms => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

function paintAlarm() {
  if (!alarm) return;
  const done = timers.filter(t => t.done);
  const sig = done.map(t => t.id).join();
  if (sig === alarm.sig) return;
  const first = !alarm.sig;
  alarm.sig = sig;
  const one = done.length === 1 ? done[0] : null;
  alarm.wrap?.querySelector('.sheet')?.setAttribute('aria-label', one ? `Timer done: ${one.label}` : `${done.length} timers done`);
  alarm.body.innerHTML = one ? html`
    <div class="tt-alarm-hero">
      <div class="tt-bell" aria-hidden="true">${I.bell}</div>
      <p class="tt-alarm-kicker">Timer done</p>
      <h2 class="tt-alarm-title">${one.label}</h2>
      <p class="tt-alarm-meta">${durLabel(one.seconds)} · finished ${clock(one.doneAt || Date.now())}</p>
    </div>
    <div class="tt-alarm-actions">
      <button type="button" class="btn tt-alarm-btn" data-alarm="snooze" data-id="${one.id}">Snooze +1 min</button>
      <button type="button" class="btn btn-primary tt-alarm-btn" data-alarm="dismiss" data-id="${one.id}" autofocus>Dismiss</button>
    </div>
    ${one.slug ? html`<button type="button" class="btn btn-ghost btn-block tt-alarm-open" data-alarm="open" data-id="${one.id}">Dismiss and open the recipe</button>` : ''}`
  : html`
    <div class="tt-alarm-hero">
      <div class="tt-bell" aria-hidden="true">${I.bell}</div>
      <p class="tt-alarm-kicker">Timers done</p>
      <h2 class="tt-alarm-title">${done.length} timers finished</h2>
    </div>
    <ul class="tt-alarm-list">
      ${done.map(t => html`<li>
        <div class="tt-alarm-item"><strong>${t.label}</strong><small>finished ${clock(t.doneAt || Date.now())}</small></div>
        <button type="button" class="btn btn-sm" data-alarm="snooze" data-id="${t.id}" aria-label="Snooze ${t.label} 1 minute">+1 min</button>
        <button type="button" class="btn btn-sm btn-soft" data-alarm="dismiss" data-id="${t.id}" aria-label="Dismiss ${t.label}">Dismiss</button>
      </li>`)}
    </ul>
    <div class="tt-alarm-actions"><button type="button" class="btn btn-primary tt-alarm-btn" data-alarm="all" autofocus>Dismiss all</button></div>`;
  if (!first) alarm.body.querySelector('[autofocus]')?.focus({ preventScroll: true });
}

// Any tap re-arms audio (iOS suspends it in the background; a reload needs a fresh gesture).
// pointerup/keydown (not pointerdown) are the events that grant user activation on touch.
const rearm = () => { if (timers.length && actx?.state !== 'running') unlockAudio(); };
document.addEventListener('pointerup', rearm, { capture: true, passive: true });
document.addEventListener('keydown', rearm, { capture: true });

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
    <button type="button" class="tt-main" data-act="toggle" aria-expanded="${String(open)}"${open ? html` aria-controls="tt-c-${t.id}"` : ''}>
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
    if (t.done) { onState(); return; }
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
