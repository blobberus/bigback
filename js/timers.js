/**
 * timers.js — global countdown timers (WS4 implements; this is the contract).
 *   mount()                                   create the timers tray in #tools (called once by app.js)
 *   startTimer({ label, seconds, slug, stepId }) → id   starts + persists (endAt) across reloads
 *   cancelTimer(id)   pauseTimer(id)   resumeTimer(id)   addTime(id, seconds)
 *   listTimers() → [{ id, label, seconds, endAt, pausedLeft, slug, stepId, done }]
 *   onTimers(fn) → unsubscribe            fn(list) on every tick/state change
 */
const timers = [];
const subs = new Set();
export function mount() {}
export function startTimer({ label = 'Timer', seconds = 60, slug = null, stepId = null } = {}) {
  const t = { id: 't' + Date.now().toString(36), label, seconds, endAt: Date.now() + seconds * 1000, pausedLeft: null, slug, stepId, done: false };
  timers.push(t); subs.forEach(fn => fn([...timers])); return t.id;
}
export function cancelTimer(id) { const i = timers.findIndex(t => t.id === id); if (i > -1) timers.splice(i, 1); subs.forEach(fn => fn([...timers])); }
export function pauseTimer() {} export function resumeTimer() {} export function addTime() {}
export const listTimers = () => [...timers];
export const onTimers = fn => (subs.add(fn), () => subs.delete(fn));
