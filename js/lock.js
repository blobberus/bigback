/**
 * lock.js — optional site password: a lock screen in front of the whole app.
 * It is a gate, not encryption: the recipe files stay readable in the public repo.
 *
 *   data/lock.json (user-owned; absent = no password) — see docs/SCHEMA.md:
 *     { schemaVersion, kdf: 'PBKDF2-SHA256', iterations, salt: base64, check: hex, updatedAt }
 *     check = SHA-256(PBKDF2(password, salt, iterations)). Slow KDF because the file is public.
 *   A device is remembered by keeping the derived key (never the password) under `bb.unlock`
 *   in localStorage (or sessionStorage when "Remember this device" is off). It only counts while
 *   SHA-256(key) === lock.check, so changing or removing the password re-locks other devices.
 *
 *   Token vault (config.vault): the GitHub token AES-GCM-encrypted with a key derived from the
 *   password, so a device or Home Screen app whose storage was wiped gets its token back by
 *   unlocking: no new token, no re-pasting. On by default: the first device that has both the
 *   token and the password saves it (autoVault). `vault: false` = turned off in Settings.
 *   Public like the rest of the file, so its safety is the password (600k PBKDF2 rounds/guess).
 *
 *   unlockGate()                       → Promise; resolves once the app may render (and restores
 *                                        the token from the vault when this device has none).
 *                                        Remembered devices open at once on their last copy of
 *                                        lock.json; the live file is checked right behind it
 *                                        and locks the app if the password changed meanwhile.
 *   showLockScreen(config)             → Promise<key>; resolves after the right password
 *   sealToken(key, token) → vault      openVault(config, key) → token | null
 *   storedKey() → this device's derived key | null      restoreToken(config, key) → bool
 *   autoVault(config, key) → bool      saves the vault when it's missing and this device has a token
 *   makeLock(password, {iterations})   → { config, key }      checkPassword(config, pw) → key | null
 *   validLock(c) · isRemembered(config) · remember(key, persist) · forgetDevice() · supported()
 */
import { getLock, peekLock, saveLock } from './store.js';
import { getPrefs, setPrefs } from './prefs.js';

export const ITERATIONS = 600000;     // OWASP 2023 guidance for PBKDF2-HMAC-SHA256
export const MIN_LENGTH = 4;
const KEY = 'bb.unlock';
const te = new TextEncoder();
const HEX64 = /^[0-9a-f]{64}$/;

const toHex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
const fromHex = s => Uint8Array.from(s.match(/../g) || [], h => parseInt(h, 16));
const toB64 = bytes => btoa(String.fromCharCode(...bytes));
const fromB64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
const sha256 = async bytes => toHex(await crypto.subtle.digest('SHA-256', bytes));

/** WebCrypto only exists in secure contexts (https, localhost). */
export const supported = () => !!globalThis.crypto?.subtle;

async function derive(password, salt, iterations) {
  const base = await crypto.subtle.importKey('raw', te.encode(String(password).normalize('NFC')), 'PBKDF2', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, base, 256));
}

export function validLock(c) {
  if (!c || typeof c !== 'object' || !HEX64.test(c.check || '') || !Number.isInteger(c.iterations) || c.iterations < 1000) return false;
  try { return fromB64(c.salt).length >= 8; } catch { return false; }
}

export async function makeLock(password, { iterations = ITERATIONS } = {}) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await derive(password, salt, iterations);
  const config = {
    schemaVersion: 1, kdf: 'PBKDF2-SHA256', iterations, salt: toB64(salt),
    check: await sha256(key), updatedAt: new Date().toISOString().replace(/\.\d+Z$/, 'Z')
  };
  return { config, key: toHex(key) };
}

export async function checkPassword(config, password) {
  const key = await derive(password, fromB64(config.salt), config.iterations);
  return (await sha256(key)) === config.check ? toHex(key) : null;
}

/* ---------- remembered devices ---------- */
const stored = () => { try { return localStorage.getItem(KEY) || sessionStorage.getItem(KEY); } catch { return null; } };
export function forgetDevice() { try { localStorage.removeItem(KEY); sessionStorage.removeItem(KEY); } catch { /* private mode */ } }
export function remember(key, persist = true) {
  forgetDevice();
  try { (persist ? localStorage : sessionStorage).setItem(KEY, key); } catch { /* private mode: ask every time */ }
}
export async function isRemembered(config) {
  const k = stored();
  return !!k && HEX64.test(k) && validLock(config) && (await sha256(fromHex(k))) === config.check;
}
export const rememberedHere = () => { try { return localStorage.getItem(KEY) ? 'device' : sessionStorage.getItem(KEY) ? 'session' : null; } catch { return null; } };
export const storedKey = () => { const k = stored(); return k && HEX64.test(k) ? k : null; };

/* ---------- token vault ---------- */
// AES key = SHA-256(derived key ‖ label): a different hash of the key than the public `check`.
async function vaultKey(keyHex, usage) {
  const bytes = new Uint8Array([...fromHex(keyHex), ...te.encode('bigback token vault v1')]);
  return crypto.subtle.importKey('raw', await crypto.subtle.digest('SHA-256', bytes), 'AES-GCM', false, [usage]);
}
export async function sealToken(keyHex, token) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await vaultKey(keyHex, 'encrypt'), te.encode(token));
  return { alg: 'AES-GCM', iv: toB64(iv), data: toB64(new Uint8Array(ct)) };
}
export async function openVault(config, keyHex) {
  const v = config?.vault;
  if (!v?.iv || !v?.data || !keyHex || !supported()) return null;
  try {
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(v.iv) }, await vaultKey(keyHex, 'decrypt'), fromB64(v.data));
    return new TextDecoder().decode(pt);
  } catch { return null; }
}
export const isoNow = () => new Date().toISOString().replace(/\.\d+Z$/, 'Z');

/** Vault missing (never saved, not turned off) and this device has the token → save it.
 *  At most one save per page load, even if boot and Settings both ask. */
let saving = null, saved = false;
export function autoVault(config, keyHex, { save = saveLock } = {}) {
  if (saved) return Promise.resolve(false);
  if (saving) return saving;
  const token = getPrefs().token;
  if (!token || !keyHex || !supported() || !validLock(config) || config.vault !== undefined) return Promise.resolve(false);
  saving = (async () => {
    const vault = await sealToken(keyHex, token);
    await save({ ...config, vault, updatedAt: isoNow() }, { message: 'Keep the GitHub token with the site password' });
    saved = true;
    return true;
  })().finally(() => { saving = null; });
  return saving;
}

/** No token on this device, but the vault has one → put it back. */
export async function restoreToken(config, keyHex) {
  if (getPrefs().token || !config?.vault) return false;
  const token = await openVault(config, keyHex);
  if (!token) return false;
  setPrefs({ token });
  return true;
}

/* ---------- gate ---------- */
const root = document.documentElement;
const mayOpen = async config => !validLock(config) || (supported() && await isRemembered(config));

/**
 * Fast path (no network): this device's copy of data/lock.json from its last visit says the
 * app may open (no password, or one this device is remembered for) → open now, and let the
 * live file decide right behind it: a password set or changed since then shows the lock
 * screen over the app a moment later. Otherwise (first visit, or not remembered) wait for
 * the live file, as before.
 */
export async function unlockGate({ peek = peekLock, fetchLive = () => getLock({ force: true }) } = {}) {
  try {
    const last = peek();
    if (last !== undefined && await mayOpen(last).catch(() => false)) {
      const key = validLock(last) ? storedKey() : null;
      if (key) await restoreToken(last, key).catch(e => console.warn('lock: token vault', e));
      const live = fetchLive().catch(e => { console.warn('lock: could not read data/lock.json', e); return last; });
      live.then(admit).catch(e => console.warn('lock:', e));
      return;
    }
    let config = null;
    try { config = await fetchLive(); } catch (e) { console.warn('lock: could not read data/lock.json', e); }
    await admit(config);
  } finally {
    root.classList.remove('is-gating');
  }
}

/** Ask for the password unless this config lets the device in; then restore / save the token copy. */
async function admit(config) {
  if (!validLock(config)) return;
  const key = supported() && await isRemembered(config) ? storedKey() : await showLockScreen(config);
  await restoreToken(config, key).catch(e => console.warn('lock: token vault', e));
  // In the background: the first device with token + password saves the copy for the others.
  autoVault(config, key).catch(e => console.warn('lock: could not save the token copy', e));
}

// Resolved from this module, so it also works from tests/ pages.
const LOGO = new URL('../assets/icons/icon-192.png', import.meta.url).href;
const EYE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/></svg>';

export function showLockScreen(config, { host = document.body } = {}) {
  return new Promise(resolve => {
    const el = document.createElement('div');
    el.className = 'lock';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-labelledby', 'lock-h');
    const ok = supported();
    el.innerHTML = `
      <form class="lock-card" novalidate>
        <img class="lock-logo" src="${LOGO}" alt="" width="72" height="72">
        <h1 id="lock-h">Bigback</h1>
        <p class="muted lock-lede">Enter the password to open your recipes.</p>
        <input class="sr-only" type="text" name="username" value="Bigback" autocomplete="username" tabindex="-1" aria-hidden="true">
        <div class="field">
          <label for="lock-pw" class="sr-only">Password</label>
          <div class="lock-secret">
            <input id="lock-pw" class="input" type="password" name="password" autocomplete="current-password"
              autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="Password" aria-describedby="lock-err"${ok ? '' : ' disabled'}>
            <button type="button" class="btn btn-ghost lock-reveal" aria-label="Show password" aria-pressed="false" aria-controls="lock-pw">${EYE}</button>
          </div>
        </div>
        <label class="lock-remember"><input type="checkbox" name="remember" checked> Remember this device</label>
        <p class="lock-err" id="lock-err" role="alert">${ok ? '' : 'This browser can only check the password on the secure (https) site.'}</p>
        <button type="submit" class="btn btn-primary lock-btn"${ok ? '' : ' disabled'}>Unlock</button>
      </form>`;
    host.append(el);
    root.classList.add('is-locked');
    root.classList.remove('is-gating');

    const form = el.querySelector('form'), input = el.querySelector('#lock-pw');
    const err = el.querySelector('.lock-err'), btn = el.querySelector('.lock-btn'), eye = el.querySelector('.lock-reveal');
    input.focus({ preventScroll: true });

    eye.addEventListener('click', () => {
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      eye.setAttribute('aria-pressed', String(show));
      eye.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
      input.focus({ preventScroll: true });
    });

    let checking = false;
    form.addEventListener('submit', async e => {
      e.preventDefault();
      if (checking || !ok) return;
      if (!input.value) { err.textContent = 'Enter the password.'; input.focus(); return; }
      checking = true; btn.disabled = true; btn.textContent = 'Checking…'; err.textContent = '';
      let key = null;
      try { key = await checkPassword(config, input.value); } catch (x) { console.warn('lock: check failed', x); }
      if (key) {
        remember(key, form.elements.remember.checked);
        el.remove();
        root.classList.remove('is-locked');
        resolve(key);
        return;
      }
      checking = false; btn.disabled = false; btn.textContent = 'Unlock';
      err.textContent = 'Wrong password. Try again.';
      input.select();
    });
  });
}
