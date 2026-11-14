/**
 * stopwatch.js — global collapsible stopwatch (WS4 implements; this is the contract).
 *   mount()            add the floating stopwatch button + panel to #tools (once, from app.js)
 *   toggleStopwatch()  open/close the panel from anywhere
 * State (startedAt, elapsed, laps, running) persists in localStorage across reloads.
 *
 * Notes: stored under 'bb.stopwatch' as { running, startedAt, accumulated, laps:[totalMs…] };
 * elapsed = accumulated + (running ? now − startedAt : 0), recomputed from Date.now() on
 * every paint (rAF while the panel is open, once a second while collapsed). Collapsed with
 * time on the clock, the round button becomes a pill showing m:ss. The button also carries
 * the wake-lock indicator (small sun badge) and publishes the #tools height as --tools-h.
 */
import { html, fmtClock } from './util.js';
import { on } from './ui.js';
import { onWakeLock, wakeLockStatus } from './wakelock.js';

const KEY = 'bb.stopwatch';
const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
let st = load(), root = null, els = {}, open = false, raf = 0, slowT = 0, closeT = 0;

function blank() { return { running: false, startedAt: null, accumulated: 0, laps: [] }; }
function load() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (s && typeof s === 'object') {
      const running = !!s.running && Number.isFinite(+s.startedAt) && s.startedAt != null;
      return {
        running, startedAt: running ? +s.startedAt : null, accumulated: Math.max(0, +s.accumulated || 0),
        laps: Array.isArray(s.laps) ? s.laps.map(Number).filter(Number.isFinite) : []
      };
    }
  } catch { /* corrupt → fresh */ }
  return blank();
}
function save() { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch { /* quota */ } }
const elapsed = (now = Date.now()) => st.accumulated + (st.running ? Math.max(0, now - st.startedAt) : 0);

/* ---------- actions ---------- */
function startPause() {
  if (st.running) { st.accumulated = elapsed(); st.running = false; st.startedAt = null; }
  else { st.running = true; st.startedAt = Date.now(); }
  commit();
}
function lap() { if (st.running) { st.laps.push(elapsed()); commit(); } }
function reset() { st = blank(); commit(); }
function commit() { save(); paint(true); loop(); }

/* ---------- view ---------- */
const I = {
  watch: html`<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="13.5" r="7.5"/><path d="M12 13.5V10M9.5 2.75h5M12 2.75V6M18.2 6.8l1.4-1.4"/></svg>`,
  down: html`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>`,
  sun: html`<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/></svg>`,
  play: html`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l10.5-6.5z"/></svg>`,
  pause: html`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6v12M15 6v12"/></svg>`,
  flag: html`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 21V4M6 4.5h10.5l-2 4 2 4H6"/></svg>`,
  reset: html`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3M4.5 4.5v3.7h3.7"/></svg>`
};

function markup() {
  return html`
    <button type="button" class="sw-fab" data-sw="toggle" aria-expanded="false" aria-controls="sw-panel" aria-label="Open stopwatch">
      ${I.watch}<b class="sw-fab-time" aria-hidden="true">0:00</b>
      <i class="sw-awake" title="Screen stays awake" aria-hidden="true" hidden>${I.sun}</i>
    </button>
    <section class="sw-panel" id="sw-panel" aria-label="Stopwatch" hidden>
      <div class="sw-head">
        <h2 class="sw-title">Stopwatch</h2>
        <i class="sw-awake-chip" hidden>${I.sun}Screen awake</i>
        <button type="button" class="icon-btn sw-collapse" data-sw="toggle" aria-expanded="true" aria-controls="sw-panel" aria-label="Collapse stopwatch">${I.down}</button>
      </div>
      <div class="sw-display" role="timer" aria-live="off">0:00.0</div>
      <div class="sw-ctrls">
        <button type="button" class="btn sw-btn" data-sw="reset">${I.reset}Reset</button>
        <button type="button" class="btn sw-btn" data-sw="lap">${I.flag}Lap</button>
        <button type="button" class="btn btn-primary sw-btn sw-main" data-sw="startpause"></button>
      </div>
      <div class="sw-laps-wrap" hidden>
        <div class="sw-laps-head" aria-hidden="true"><span>Lap</span><span>Split</span><span>Total</span></div>
        <ol class="sw-laps" aria-label="Laps, newest first"></ol>
      </div>
    </section>`;
}

const setText = (el, s) => { if (el.textContent !== s) el.textContent = s; };

function paint(full) {
  if (!root) return;
  const ms = elapsed();
  if (full) {
    const state = st.running ? 'running' : ms > 0 ? 'paused' : 'idle';
    root.dataset.state = state;
    els.main.innerHTML = html`${st.running ? I.pause : I.play}${st.running ? 'Pause' : ms > 0 ? 'Resume' : 'Start'}`;
    els.lap.disabled = !st.running;
    els.reset.disabled = !ms && !st.laps.length;
    els.fab.setAttribute('aria-label', state === 'idle' ? 'Open stopwatch' : `Open stopwatch, ${state}`);
    renderLaps();
  }
  setText(els.display, fmtClock(ms, { tenths: true }));
  setText(els.fabTime, fmtClock(ms));
}

function renderLaps() {
  const laps = st.laps.map((total, i) => ({ n: i + 1, split: total - (st.laps[i - 1] || 0), total })).reverse();
  els.lapsWrap.hidden = !laps.length;
  els.laps.innerHTML = html`${laps.map(l => html`<li>
    <span class="sw-lap-n">Lap ${l.n}</span>
    <span class="sw-lap-split">${fmtClock(l.split, { tenths: true })}</span>
    <span class="sw-lap-total">${fmtClock(l.total, { tenths: true })}</span>
  </li>`)}`;
}

/** Repaint loop: every frame while the panel is open, once per second while collapsed. */
function loop() {
  cancelAnimationFrame(raf); clearTimeout(slowT); raf = slowT = 0;
  if (!root || !st.running || document.hidden) return;
  if (open) {
    const frame = () => { paint(false); raf = requestAnimationFrame(frame); };
    raf = requestAnimationFrame(frame);
  } else {
    const step = () => { paint(false); slowT = setTimeout(step, 1000 - (elapsed() % 1000) + 10); };
    step();
  }
}

function setOpen(v, focus) {
  if (v === open) return;
  open = v;
  const host = root.parentElement;
  clearTimeout(closeT);
  els.fab.setAttribute('aria-expanded', String(v));
  if (v) {
    els.panel.hidden = false;
    root.toggleAttribute('data-open', true);
    host.classList.add('sw-open');
    requestAnimationFrame(() => requestAnimationFrame(() => els.panel.classList.add('is-open')));
    if (focus) els.main.focus({ preventScroll: true });
  } else {
    els.panel.classList.remove('is-open');
    const done = () => {
      els.panel.hidden = true;
      root.toggleAttribute('data-open', false);
      host.classList.remove('sw-open');
      if (focus) els.fab.focus({ preventScroll: true });
    };
    if (reduceMotion()) done(); else closeT = setTimeout(done, 180);
  }
  paint(true); loop();
}

export function toggleStopwatch() {
  if (!root) mount();
  setOpen(!open, true);
}

function paintAwake(status) {
  const on = status === 'active';
  els.awake.hidden = !on;
  els.awakeChip.hidden = !on;
}

export function mount() {
  if (root) return;
  let host = document.getElementById('tools');
  if (!host) { host = document.createElement('div'); host.id = 'tools'; document.body.append(host); }
  root = document.createElement('div');
  root.className = 'sw';
  root.innerHTML = markup();
  host.append(root);
  const q = s => root.querySelector(s);
  els = {
    fab: q('.sw-fab'), fabTime: q('.sw-fab-time'), awake: q('.sw-awake'), awakeChip: q('.sw-awake-chip'),
    panel: q('.sw-panel'), display: q('.sw-display'), main: q('.sw-main'), lap: q('[data-sw="lap"]'),
    reset: q('[data-sw="reset"]'), laps: q('.sw-laps'), lapsWrap: q('.sw-laps-wrap')
  };
  on(root, 'click', '[data-sw]', (e, el) => {
    const act = el.dataset.sw;
    if (act === 'toggle') setOpen(!open, true);
    else if (act === 'startpause') startPause();
    else if (act === 'lap') lap();
    else if (act === 'reset') reset();
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && open && !document.querySelector('.sheet-backdrop')) setOpen(false, true);
  });
  document.addEventListener('visibilitychange', () => { paint(true); loop(); });
  window.addEventListener('storage', e => { if (e.key === KEY) { st = load(); paint(true); loop(); } });
  onWakeLock(paintAwake);
  paintAwake(wakeLockStatus());

  // Publish the tools stack height so toasts + page padding clear it (see tools.css).
  const publish = () => document.documentElement.style.setProperty('--tools-h', `${Math.ceil(host.getBoundingClientRect().height)}px`);
  if ('ResizeObserver' in window) new ResizeObserver(publish).observe(host);
  publish();

  paint(true); loop();
}
