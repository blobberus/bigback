/**
 * components/recipe-steps.js — step text with tappable durations + timer buttons
 * (recipe page and cook mode).
 *   groupBySection(list) → [{ section, items }]   consecutive runs, order preserved
 *   stepTextHtml(step, n, { slug }) → html        durations parsed from the text that no explicit
 *                                                 timer covers become inline timer links
 *   timerButtonsHtml(step, n) → html               one button per step.timers[] ("Dry brine · 15:00")
 *   bindTimers(root, slug) → off (off.refresh())   tap → startTimer; live remaining time on
 *                                                 running timers of this recipe (onTimers + 1s tick)
 * Every trigger carries data-timer data-step data-label data-seconds; running timers are
 * matched back to triggers by (slug, stepId, label), preferring the same seconds.
 */
import { html, parseDurations, fmtClock, fmtMinutes } from '../util.js';
import { on, toast } from '../ui.js';
import { startTimer, onTimers, listTimers } from '../timers.js';
import { icon } from './recipe-icons.js';

export function groupBySection(list = []) {
  const groups = [];
  for (const it of list) {
    const section = (it.section || '').trim() || null;
    const last = groups[groups.length - 1];
    if (last && last.section === section) last.items.push(it);
    else groups.push({ section, items: [it] });
  }
  return groups;
}

/** 45 → "45 sec", 600 → "10 min", 5400 → "1 hr 30 min" */
function durText(sec) {
  if (sec < 60) return `${sec} sec`;
  const m = Math.floor(sec / 60), s = sec % 60;
  return s ? `${fmtMinutes(m)} ${s} sec` : fmtMinutes(m);
}
export function durLabel(lo, hi) {
  if (!hi || hi === lo) return durText(lo);
  if (lo % 60 === 0 && hi % 60 === 0 && hi < 3600) return `${lo / 60}–${hi / 60} min`;
  if (lo % 3600 === 0 && hi % 3600 === 0) return `${lo / 3600}–${hi / 3600} hr`;
  return `${durText(lo)}–${durText(hi)}`;
}

const covered = (d, timers) => timers.some(t =>
  t.seconds === d.seconds || t.seconds === d.maxSeconds ||
  (d.maxSeconds && t.seconds >= d.seconds && t.seconds <= d.maxSeconds));

/** Durations in the text that need an inline link (not already an explicit timer). */
export function inlineDurations(step) {
  const timers = (step.timers || []).filter(t => t && t.seconds > 0);
  return parseDurations(step.text || '').filter(d => !covered(d, timers));
}

export function stepTextHtml(step, n) {
  const text = step.text || '';
  const out = [];
  let pos = 0;
  for (const d of inlineDurations(step)) {
    if (d.index < pos) continue;
    out.push(text.slice(pos, d.index));
    const label = `Step ${n} · ${durLabel(d.seconds, d.maxSeconds)}`;
    const idle = fmtClock(d.seconds * 1000);
    out.push(html`<button type="button" class="rx-dur" data-act="timer" data-timer data-inline data-step="${step.id}" data-label="${label}" data-seconds="${d.seconds}" data-idle="${idle}">${icon('timer')}<span class="rx-dur-text">${text.slice(d.index, d.index + d.length)}</span><span class="sr-only rx-timer-sr"> (start timer)</span><span class="rx-timer-time" hidden></span></button>`);
    pos = d.index + d.length;
  }
  out.push(text.slice(pos));
  return html`${out}`;
}

export function timerButtonsHtml(step) {
  const timers = (step.timers || []).filter(t => t && t.seconds > 0);
  if (!timers.length) return '';
  return html`<div class="rx-timers">${timers.map(t => {
    const label = t.label || 'Timer';
    const idle = fmtClock(t.seconds * 1000);
    return html`<button type="button" class="rx-timer" data-act="timer" data-timer data-step="${step.id}" data-label="${label}" data-seconds="${t.seconds}" data-idle="${idle}" data-dur="${durText(t.seconds)}" aria-label="Start timer: ${label}, ${durText(t.seconds)}">
      ${icon('timer')}<span class="rx-timer-label">${label}</span><span class="rx-timer-sep" aria-hidden="true">·</span><span class="rx-timer-time">${idle}</span>
    </button>`;
  })}</div>`;
}

// seconds is only a tiebreaker: "+1 min" in the tray may change it on a running timer.
const matches = (t, slug, el) => t.slug === slug && t.stepId === el.dataset.step && t.label === el.dataset.label;

const leftMs = t => (t.pausedLeft != null ? t.pausedLeft : t.endAt - Date.now());

export function bindTimers(root, slug) {
  let tick = null;

  function find(el, list) {
    const mine = list.filter(t => matches(t, slug, el));
    const exact = t => Number(t.seconds) === Number(el.dataset.seconds);
    return mine.find(t => !t.done && exact(t)) || mine.find(t => !t.done) || mine.find(exact) || mine[0] || null;
  }

  function refresh() {
    const list = listTimers();
    let live = false;
    root.querySelectorAll('[data-timer]').forEach(el => {
      const t = find(el, list);
      const time = el.querySelector('.rx-timer-time');
      const running = !!t && !t.done;
      el.classList.toggle('is-running', running);
      el.classList.toggle('is-paused', running && t.pausedLeft != null);
      el.classList.toggle('is-done', !!t && !!t.done);
      // Name follows the state (not the ticking time, so screen readers aren't re-read every second).
      const state = !t ? 'idle' : t.done ? 'done' : t.pausedLeft != null ? 'paused' : 'running';
      if (el.dataset.state !== state) {
        el.dataset.state = state;
        const label = el.dataset.label;
        if (el.hasAttribute('aria-label')) {
          el.setAttribute('aria-label', state === 'idle' ? `Start timer: ${label}, ${el.dataset.dur}` : `${label} timer ${state}`);
        } else {
          const sr = el.querySelector('.rx-timer-sr');
          if (sr) sr.textContent = state === 'idle' ? ' (start timer)' : ` (timer ${state})`;
        }
      }
      if (!time) return;
      if (running) {
        live = true;
        time.textContent = fmtClock(Math.max(0, Math.ceil(leftMs(t) / 1000) * 1000));
      } else if (t?.done) {
        time.textContent = 'Done';
      } else {
        time.textContent = el.dataset.idle || '';
      }
      if (el.hasAttribute('data-inline')) time.hidden = !t;
    });
    if (live && !tick) tick = setInterval(refresh, 1000);
    if (!live && tick) { clearInterval(tick); tick = null; }
  }

  const offClick = on(root, 'click', '[data-act="timer"]', (e, el) => {
    e.preventDefault();
    const t = find(el, listTimers());
    if (t && !t.done) {
      toast(`${el.dataset.label} is already running`);
      return;
    }
    startTimer({ label: el.dataset.label, seconds: Number(el.dataset.seconds), slug, stepId: el.dataset.step });
    refresh();
  });
  const offTimers = onTimers(() => refresh());
  refresh();

  const off = () => { offClick(); offTimers(); if (tick) clearInterval(tick); tick = null; };
  off.refresh = refresh;
  return off;
}
