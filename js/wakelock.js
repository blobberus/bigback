/**
 * wakelock.js — keep the screen on while the site is open (WS4 implements; contract).
 *   initWakeLock()                 reads prefs.wakeLock, acquires/re-acquires on visibilitychange
 *   wakeLockStatus() → 'active' | 'off' | 'unsupported' | 'error'
 *   onWakeLock(fn) → unsubscribe   fn(status)
 */
export function initWakeLock() {}
export const wakeLockStatus = () => ('wakeLock' in navigator ? 'off' : 'unsupported');
export const onWakeLock = () => () => {};
