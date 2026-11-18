/**
 * components/share-sheet.js — the owner's side of sharing one recipe (recipe page → topbar Share).
 *   shareUrl(slug) → absolute link to share.html?r=<slug>: the recipe alone, read-only, no password
 *   openShareSheet(slug, { title }) → Promise (resolves when the sheet closes)
 *       not shared: what the link shows and doesn't, and "Create share link"
 *       shared:     the link, Share… (Web Share API, phones), Copy link, Stop sharing
 * Sharing is the library entry's `sharedAt` (store.setShared), committed right away rather than in
 * the usual 1.2 s batch, so it needs a token. The link itself never changes: stop and share again
 * and the old link works again. share.js only shows recipes whose entry has `sharedAt`.
 */
import { getLibrary, entryFor, setShared, flushLibrary } from '../store.js';
import { sheet, toast, reportError, busy } from '../ui.js';
import { html, toStr } from '../util.js';
import { isConnected } from '../prefs.js';
import { icon } from './recipe-icons.js';

export const shareUrl = slug => new URL(`share.html?r=${encodeURIComponent(slug)}`, document.baseURI).href;

const canShare = () => typeof navigator.share === 'function';

function bodyHtml(slug, shared) {
  if (!shared) {
    const connected = isConnected();
    return html`
      <p class="sh-lead">Anyone with the link sees this recipe (photo, ingredients and method) without the password.</p>
      <p class="sh-fine">They can't see your notes, photos, ratings or other recipes, and they can't change anything.</p>
      ${connected ? '' : html`<p class="sh-fine">Connect GitHub in <a href="#/settings">Settings</a> to create a link.</p>`}
      <div class="sh-actions">
        <button type="button" class="btn btn-primary btn-block" data-sh="create" ${connected ? '' : 'disabled'}>${icon('link')} Create share link</button>
      </div>`;
  }
  return html`
    <p class="sh-lead">Anyone with this link can view the recipe: read-only, no password.</p>
    <input class="input sh-url" value="${shareUrl(slug)}" readonly aria-label="Share link" data-sh-url>
    <div class="sh-actions">
      ${canShare() ? html`<button type="button" class="btn btn-primary" data-sh="send">${icon('share')} Share…</button>` : ''}
      <button type="button" class="btn ${canShare() ? 'btn-soft' : 'btn-primary'}" data-sh="copy">${icon('copy')} Copy link</button>
    </div>
    <p class="sh-fine">A new link starts working within a minute or two, once the site updates.</p>
    <button type="button" class="rx-link-btn sh-stop" data-sh="stop">Stop sharing</button>`;
}

async function copy(text, input) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    input?.select();                                   // older browsers / no clipboard permission
    if (!document.execCommand?.('copy')) throw new Error('copy failed');
  }
}

export async function openShareSheet(slug, { title = '' } = {}) {
  const box = document.createElement('div');
  box.className = 'sh-body';
  let shared = !!entryFor(await getLibrary(), slug).sharedAt;
  const paint = () => {
    box.innerHTML = toStr(bodyHtml(slug, shared));
    box.querySelector('[data-sh]:not([disabled])')?.focus({ preventScroll: true });
  };
  const toggle = async (btn, on) => {
    try {
      await busy(btn, (async () => { setShared(slug, on); await flushLibrary(); })());
      shared = on;
      paint();
      toast(on ? 'Share link created' : 'Sharing stopped: the link no longer shows this recipe', { type: 'ok' });
    } catch (err) {
      shared = !!entryFor(await getLibrary(), slug).sharedAt;
      paint();
      reportError(err);
    }
  };
  return sheet({
    title: 'Share recipe', body: box, className: 'sh-sheet',
    onOpen: (wrap, close) => {
      paint();
      box.addEventListener('click', async e => {
        if (e.target.closest('a[href^="#/"]')) return close(null);           // Settings link
        const btn = e.target.closest('[data-sh]');
        if (!btn || btn.disabled) return;
        const url = shareUrl(slug), input = box.querySelector('[data-sh-url]');
        switch (btn.dataset.sh) {
          case 'create': return toggle(btn, true);
          case 'stop': return toggle(btn, false);
          case 'copy':
            try { await copy(url, input); toast('Link copied', { type: 'ok' }); }
            catch { input?.select(); toast('Couldn’t copy: select the link and copy it yourself', { type: 'error' }); }
            return;
          case 'send':
            try { await navigator.share({ title: title || 'Recipe', url }); }
            catch (err) { if (err?.name !== 'AbortError') reportError(err); }
            return;
          default:
        }
      });
      box.addEventListener('focusin', e => { if (e.target.matches('[data-sh-url]')) e.target.select(); });
    }
  });
}
