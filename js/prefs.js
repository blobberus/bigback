/**
 * prefs.js — device-local preferences (localStorage, never committed).
 *   getPrefs() → { token, owner, repo, branch, wakeLock, theme, units, sound }
 *   setPrefs({ wakeLock: true })   // merges + notifies
 *   onPrefs(fn)                    // fn(prefs) on every change; returns unsubscribe
 */
import { DEFAULT_REPO } from './config.js';

const KEY = 'bb.prefs';
const DEFAULTS = {
  token: '', ...DEFAULT_REPO,
  wakeLock: false,     // keep screen awake while the site is open
  theme: 'auto',       // auto | light | dark
  units: 'us',         // us | metric (display preference)
  sound: true          // timer alarm sound
};
const subs = new Set();

export function getPrefs() {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; }
  catch { return { ...DEFAULTS }; }
}

export function setPrefs(patch) {
  const next = { ...getPrefs(), ...patch };
  localStorage.setItem(KEY, JSON.stringify(next));
  subs.forEach(fn => { try { fn(next); } catch (e) { console.error(e); } });
  return next;
}

export function onPrefs(fn) { subs.add(fn); return () => subs.delete(fn); }

export const isConnected = () => !!getPrefs().token;
