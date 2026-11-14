/**
 * components/editor-upload.js — the #/add/upload form (WS3): File | Link | Text → inbox.
 *   mountUploadForm(root) → cleanup()
 * Sends store.uploadToInbox({ kind, title, url, text, hint, files }) and swaps to a success
 * state linking to #/pending/<id>. Text fields + mode autosave (files can't be stored).
 *   normalizeUrl(s) → "https://…" | null     (accepts bare domains and share text with a link)
 */
import { html, debounce } from '../util.js';
import { $, $$, on, toast, busy, reportError, scrollToEl } from '../ui.js';
import { uploadToInbox } from '../store.js';
import { isConnected } from '../prefs.js';
import { linkType } from './editor-parse.js';
import { icon, fileIcon } from './editor-icons.js';
import { connectBanner } from './editor-form.js';
import { draftKey, loadDraft, saveDraft, clearDraft } from './editor-drafts.js';

const MAX_BYTES = 20 * 1024 * 1024;
const TEXT_FIELDS = ['title', 'url', 'caption', 'text', 'hint'];
const LINK_LABEL = { youtube: 'YouTube', instagram: 'Instagram', tiktok: 'TikTok', web: 'Web page' };

export function normalizeUrl(input) {
  let s = String(input ?? '').trim();
  if (!s) return null;
  const found = s.match(/https?:\/\/[^\s<>"']+/i);
  if (found) s = found[0];
  else if (/\s/.test(s)) return null;
  if (!/^[a-z][\w+.-]*:\/\//i.test(s)) s = `https://${s}`;
  try {
    const u = new URL(s);
    if (!/^https?:$/.test(u.protocol) || !u.hostname.includes('.')) return null;
    return u.href;
  } catch { return null; }
}

const fmtSize = n => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(n >= 10 * 1024 * 1024 ? 0 : 1)} MB`
  : n >= 1024 ? `${Math.round(n / 1024)} KB` : `${n} B`);
const isImage = f => /^image\//.test(f.type) || /\.(jpe?g|png|gif|webp|heic|heif|avif)$/i.test(f.name);

function formHtml(mode, d) {
  const canPaste = !!navigator.clipboard?.readText;
  const segBtn = (m, ic, label) => html`<button type="button" data-mode="${m}" aria-pressed="${m === mode}">${icon(ic)}<span>${label}</span></button>`;
  return html`
    ${isConnected() ? '' : connectBanner('Keep going — anything you type stays on this device (files need picking again).')}
    <form class="up" data-form novalidate autocomplete="off">
      <div class="seg up-seg" role="group" aria-label="What are you adding?">
        ${segBtn('file', 'file', 'File')}${segBtn('link', 'link', 'Link')}${segBtn('text', 'text', 'Text')}
      </div>

      <section class="up-panel" data-panel="file" ${mode === 'file' ? '' : 'hidden'}>
        <label class="up-drop" data-drop>
          <input type="file" multiple class="sr-only" data-files aria-label="Choose files">
          <span class="up-drop-ic">${icon('upload')}</span>
          <strong>Choose files</strong>
          <span>PDFs, photos, text or Word docs. Anything with the recipe in it.</span>
        </label>
        <label class="btn btn-soft btn-block up-camera">
          <input type="file" accept="image/*" capture="environment" class="sr-only" data-files aria-label="Take a photo">
          ${icon('camera')}<span>Take a photo of a recipe card</span>
        </label>
        <ul class="up-files" data-filelist aria-label="Chosen files"></ul>
        <p class="ed-err" data-err="files" role="alert" hidden></p>
      </section>

      <section class="up-panel" data-panel="link" ${mode === 'link' ? '' : 'hidden'}>
        <div class="field">
          <label for="up-url">Link</label>
          <div class="up-url-row">
            <input id="up-url" name="url" type="url" inputmode="url" class="input" value="${d.url}" placeholder="https://"
              autocapitalize="none" autocorrect="off" spellcheck="false" enterkeyhint="next" aria-describedby="up-err-url">
            ${canPaste ? html`<button type="button" class="btn up-paste" data-act="paste">${icon('clipboard')}<span>Paste</span></button>` : ''}
          </div>
          <div class="up-type" data-linktype aria-live="polite"></div>
          <p class="ed-err" id="up-err-url" data-err="url" hidden></p>
        </div>
        <div class="field up-caption" data-caption>
          <label for="up-caption">Caption or description <span class="ed-opt up-opt">optional</span><span class="ed-opt up-rec">recommended</span></label>
          <p class="hint">Paste the caption/description (recommended for Instagram/TikTok). Claude often can’t open those posts, so the caption is what it builds from.</p>
          <textarea id="up-caption" name="caption" class="input" rows="4" data-grow autocapitalize="sentences"
            placeholder="Paste the post’s caption or the video description">${d.caption}</textarea>
        </div>
      </section>

      <section class="up-panel" data-panel="text" ${mode === 'text' ? '' : 'hidden'}>
        <div class="field">
          <label for="up-text">Recipe text</label>
          <textarea id="up-text" name="text" class="input up-bigtext" rows="12" data-grow autocapitalize="sentences" aria-describedby="up-err-text"
            placeholder="Paste the whole recipe: ingredients, steps, notes. Messy is fine.">${d.text}</textarea>
          <p class="ed-err" id="up-err-text" data-err="text" hidden></p>
        </div>
      </section>

      <section class="up-common">
        <div class="field">
          <label for="up-title">Title <span class="ed-opt">optional</span></label>
          <input id="up-title" name="title" class="input" value="${d.title}" placeholder="Grandma’s lasagna" autocapitalize="words" enterkeyhint="next">
        </div>
        <div class="field">
          <label for="up-hint">Note for the builder <span class="ed-opt">optional</span></label>
          <textarea id="up-hint" name="hint" class="input ed-short" rows="2" data-grow autocapitalize="sentences"
            placeholder="e.g. use the second version, make it serve 2">${d.hint}</textarea>
        </div>
      </section>

      <div class="ed-savebar">
        <span class="ed-status" data-status aria-live="polite"></span>
        <button type="submit" class="btn btn-primary ed-save" data-send>${icon('inbox')}<span>Send to inbox</span></button>
      </div>
    </form>`;
}

function successHtml(id, label) {
  return html`
    <div class="up-done" role="status">
      <span class="up-done-ic">${icon('check')}</span>
      <h1 tabindex="-1">In your inbox</h1>
      <p><strong>${label}</strong> will be built into a full recipe the next time you tell Claude <q>update the site</q>.</p>
      <div class="up-done-acts">
        <a class="btn btn-primary" href="#/pending/${id}">${icon('inbox')}<span>View upload</span></a>
        <button type="button" class="btn" data-act="another">${icon('plus')}<span>Add another</span></button>
      </div>
      <a class="up-done-back" href="#/">Back to recipes</a>
    </div>`;
}

export function mountUploadForm(root) {
  const saved = loadDraft(draftKey.upload) || {};
  let mode = ['file', 'link', 'text'].includes(saved.mode) ? saved.mode : 'file';
  let files = [];            // [{ file, url }]  url = object URL for image thumbnails
  let form = null;

  const field = n => form?.elements.namedItem(n);
  const grow = ta => { ta.style.height = 'auto'; ta.style.height = `${ta.scrollHeight + 2}px`; };
  const readFields = () => Object.fromEntries(TEXT_FIELDS.map(k => [k, field(k)?.value ?? '']));
  const revokeAll = () => files.forEach(f => f.url && URL.revokeObjectURL(f.url));

  function persist() {
    if (!form) return;
    const s = readFields();
    if (TEXT_FIELDS.some(k => s[k].trim())) saveDraft(draftKey.upload, { ...s, mode });
    else clearDraft(draftKey.upload);
  }
  const persistSoon = debounce(persist, 500);

  function renderForm(d = {}) {
    root.innerHTML = formHtml(mode, Object.fromEntries(TEXT_FIELDS.map(k => [k, d[k] || ''])));
    form = $('[data-form]', root);
    paintFiles(); paintLinkType();
    requestAnimationFrame(() => $$('[data-grow]', form).forEach(grow));
  }

  function setMode(m) {
    mode = m;
    $$('[data-mode]', form).forEach(b => b.setAttribute('aria-pressed', String(b.dataset.mode === m)));
    $$('[data-panel]', form).forEach(p => { p.hidden = p.dataset.panel !== m; });
    $$('[data-err]', form).forEach(p => { p.hidden = true; });
    requestAnimationFrame(() => $$(`[data-panel="${m}"] [data-grow]`, form).forEach(grow));
    persistSoon();
  }

  function paintFiles() {
    const list = $('[data-filelist]', form);
    list.innerHTML = html`${files.map(({ file, url }, i) => html`
      <li class="up-file${file.size > MAX_BYTES ? ' is-big' : ''}">
        <span class="up-file-ic">${url ? html`<img src="${url}" alt="">` : fileIcon(file.type || file.name)}</span>
        <span class="up-file-meta"><span class="up-file-name">${file.name}</span><span class="up-file-size">${fmtSize(file.size)}</span></span>
        <button type="button" class="icon-btn" data-act="remove-file" data-i="${i}" aria-label="Remove ${file.name}">${icon('x')}</button>
        ${file.size > MAX_BYTES ? html`<p class="up-file-warn">${icon('alert')}<span>Over 20 MB. Uploads this big may fail${isImage(file) ? ' (photos are shrunk first, which usually helps)' : '; a smaller export or a photo of the page works better'}.</span></p>` : ''}
      </li>`)}`;
    $('[data-drop] strong', form).textContent = files.length ? 'Add more files' : 'Choose files';
  }
  function addFiles(list) {
    let added = 0;
    for (const file of list || []) {
      if (files.some(f => f.file.name === file.name && f.file.size === file.size && f.file.lastModified === file.lastModified)) continue;
      files.push({ file, url: isImage(file) && /^image\/(jpeg|png|gif|webp|avif)$/.test(file.type) ? URL.createObjectURL(file) : null });
      added++;
    }
    if (added) { paintFiles(); $('[data-err="files"]', form).hidden = true; }
  }

  function paintLinkType() {
    const el = $('[data-linktype]', form);
    const url = normalizeUrl(field('url').value);
    const type = url ? linkType(url) : null;
    el.innerHTML = type ? html`<span class="up-badge up-badge-${type}">${icon(type)}<span>${LINK_LABEL[type]}</span></span>` : '';
    $('[data-caption]', form).classList.toggle('is-recommended', type === 'instagram' || type === 'tiktok');
  }
  const paintLinkTypeSoon = debounce(paintLinkType, 150);

  function showError(name, msg) {
    const p = $(`[data-err="${name}"]`, form);
    p.textContent = msg; p.hidden = false;
    const target = name === 'files' ? $('[data-drop]', form) : field(name);
    scrollToEl(target);
    if (name !== 'files') target?.focus({ preventScroll: true });
  }

  async function submit(btn) {
    const s = readFields();
    const payload = { kind: mode, title: s.title.trim(), url: null, text: null, hint: s.hint.trim() || null, files: [] };
    if (mode === 'file') {
      if (!files.length) return showError('files', 'Choose at least one file, or take a photo.');
      payload.files = files.map(f => f.file);
    } else if (mode === 'link') {
      const url = normalizeUrl(s.url);
      if (!url) return showError('url', s.url.trim() ? 'That doesn’t look like a link. Try copying it again.' : 'Paste a link first.');
      payload.url = url; payload.text = s.caption.trim() || null;
    } else {
      if (!s.text.trim()) return showError('text', 'Paste the recipe text first.');
      payload.text = s.text.trim();
    }
    const status = $('[data-status]', form);
    status.textContent = mode === 'file' ? `Uploading ${files.length} file${files.length > 1 ? 's' : ''}…` : 'Sending…';
    try {
      const id = await busy(btn, uploadToInbox(payload));
      clearDraft(draftKey.upload);
      revokeAll(); files = [];
      const type = mode === 'link' ? linkType(payload.url) : null;
      const label = payload.title || (type ? `Your ${type === 'web' ? '' : LINK_LABEL[type] + ' '}link`
        : mode === 'text' ? 'Your pasted recipe' : payload.files.length > 1 ? `${payload.files.length} files` : payload.files[0].name);
      form = null;
      root.innerHTML = successHtml(id, label);
      window.scrollTo(0, 0);
      $('.up-done h1', root)?.focus({ preventScroll: true });   // the Send button is gone
      toast('Sent to your inbox', { type: 'ok' });
    } catch (e) {
      status.textContent = '';
      reportError(e);
    }
  }

  const offs = [
    on(root, 'click', '[data-mode]', (e, el) => setMode(el.dataset.mode)),
    on(root, 'click', '[data-act]', async (e, el) => {
      const act = el.dataset.act;
      if (act === 'remove-file') {
        const i = +el.dataset.i;
        const [gone] = files.splice(i, 1);
        if (gone?.url) URL.revokeObjectURL(gone.url);
        paintFiles();
        // Focus the next file's remove button, else the previous one, else the file picker.
        const btns = $$('[data-act="remove-file"]', form);
        (btns[Math.min(i, btns.length - 1)] || $('[data-drop] input', form))?.focus({ preventScroll: true });
      } else if (act === 'paste') {
        try {
          const t = await navigator.clipboard.readText();
          const url = normalizeUrl(t);
          if (!url) { toast('No link on the clipboard.'); return; }
          field('url').value = url;
          paintLinkType(); persistSoon();
          $(`[data-err="url"]`, form).hidden = true;
        } catch { toast('Couldn’t read the clipboard. Long-press the box and choose Paste.'); }
      } else if (act === 'another') {
        renderForm({});
        window.scrollTo(0, 0);
        $('[data-mode][aria-pressed="true"]', form)?.focus({ preventScroll: true });
      }
    }),
    on(root, 'change', '[data-files]', (e, el) => { addFiles(el.files); el.value = ''; }),
    on(root, 'input', 'input, textarea', (e, el) => {
      if (el.type === 'file') return;
      if (el.matches('[data-grow]')) grow(el);
      if (el.name === 'url') { paintLinkTypeSoon(); $(`[data-err="url"]`, form).hidden = true; }
      if (el.name === 'text') $(`[data-err="text"]`, form).hidden = true;
      persistSoon();
    }),
    on(root, 'keydown', 'input:not([type="file"])', (e, el) => {
      if (e.key !== 'Enter' || e.isComposing) return;
      e.preventDefault();
      const items = $$('input:not([type="file"]), textarea', form).filter(x => x.offsetParent !== null);
      items[items.indexOf(el) + 1]?.focus();
    }),
    on(root, 'submit', '[data-form]', e => { e.preventDefault(); submit($('[data-send]', form)); }),
    on(root, 'dragover', '[data-drop]', (e, el) => { e.preventDefault(); el.classList.add('is-over'); }),
    on(root, 'dragleave', '[data-drop]', (e, el) => el.classList.remove('is-over')),
    on(root, 'drop', '[data-drop]', (e, el) => { e.preventDefault(); el.classList.remove('is-over'); addFiles(e.dataTransfer?.files); })
  ];
  const onHide = () => { if (document.visibilityState === 'hidden') persistSoon.flush(); };
  document.addEventListener('visibilitychange', onHide);

  renderForm(saved);
  return () => {
    offs.forEach(off => off());
    document.removeEventListener('visibilitychange', onHide);
    persistSoon.flush();
    revokeAll();
  };
}
