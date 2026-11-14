/**
 * wakelock.js — keep the screen on while the site is open (WS4 implements; contract).
 *   initWakeLock()                 reads prefs.wakeLock, acquires/re-acquires on visibilitychange
 *   wakeLockStatus() → 'active' | 'off' | 'unsupported' | 'error'
 *   onWakeLock(fn) → unsubscribe   fn(status)
 *
 * Notes: uses only the Screen Wake Lock API (no hidden-video tricks). The browser drops
 * the lock whenever the page is hidden; we re-request on return. 'error' = the request
 * was refused (battery saver, permissions policy, no user gesture on some browsers) —
 * we retry on the next tap. initWakeLock() is idempotent; status changes notify
 * subscribers only when the value actually changes.
 */
import { getPrefs, onPrefs } from './prefs.js';

const supported = typeof navigator !== 'undefined' && 'wakeLock' in navigator;
const subs = new Set();
let status = supported ? 'off' : 'unsupported';
let sentinel = null, pending = null, inited = false;

export const wakeLockStatus = () => status;
export const onWakeLock = fn => (subs.add(fn), () => subs.delete(fn));

function set(s) {
  if (s === status) return;
  status = s;
  subs.forEach(fn => { try { fn(s); } catch (e) { console.error(e); } });
}

const wanted = () => !!getPrefs().wakeLock;

export function initWakeLock() {
  if (inited) return;
  inited = true;
  if (!supported) return;
  onPrefs(sync);
  document.addEventListener('visibilitychange', sync);
  // Some browsers only grant the lock from a gesture, or drop it silently: retry on a tap.
  document.addEventListener('pointerup', () => { if (wanted() && status !== 'active') sync(); }, { passive: true });
  sync();
}

async function release() {
  const s = sentinel;
  sentinel = null;
  if (s && !s.released) { try { await s.release(); } catch { /* already gone */ } }
}

function sync() {
  if (!supported) return;
  if (!wanted()) { release(); return set('off'); }
  if (document.visibilityState !== 'visible') return;      // released by the browser; re-acquired on return
  if (sentinel && !sentinel.released) return set('active');
  if (pending) return;
  // request() must run synchronously inside the caller (e.g. the Settings switch tap).
  try {
    pending = navigator.wakeLock.request('screen').then(s => {
      if (!wanted()) { s.release().catch(() => {}); return set('off'); }
      sentinel = s;
      s.addEventListener('release', () => { if (sentinel === s) { sentinel = null; set('off'); } });
      set('active');
    }, () => set('error')).finally(() => { pending = null; });
  } catch { pending = null; set('error'); }
}
