/**
 * views/pending.js — #/pending/<id>: an inbox upload waiting for "update the site" (WS3).
 * Shows what was sent (link, files, pasted text, note for the builder), the builder's
 * `blocked` reason when it couldn't extract a recipe, and a delete button.
 * Missing item → "Already built (or removed)".
 */
import { setTopbar, on, busy, confirmSheet, toast, reportError } from '../ui.js';
import { html } from '../util.js';
import { getPending, deletePending, mediaUrl, rawUrl } from '../store.js';
import { linkType } from '../components/editor-parse.js';
import { icon, fileIcon } from '../components/editor-icons.js';

const LINK_LABEL = { youtube: 'YouTube', instagram: 'Instagram', tiktok: 'TikTok', web: 'Web page' };
const IMG_RE = /\.(jpe?g|png|gif|webp|avif)$/i;
const baseName = p => String(p).split('/').pop();
const safeHref = u => (/^https?:\/\//i.test(String(u || '')) ? u : null);
const shortUrl = u => { try { const x = new URL(u); return (x.hostname.replace(/^www\./, '') + x.pathname).replace(/\/$/, ''); } catch { return u; } };
const fmtDate = iso => { const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }); };

function kindOf(item) {
  const files = item.files || [];
  if (item.kind === 'link') { const t = linkType(item.url || ''); return { ic: t, label: `${LINK_LABEL[t]} link` }; }
  if (item.kind === 'text') return { ic: 'text', label: 'Pasted text' };
  if (files.length > 1) return { ic: 'file', label: `${files.length} files` };
  if (IMG_RE.test(files[0] || '')) return { ic: 'image', label: 'Photo' };
  if (/\.pdf$/i.test(files[0] || '')) return { ic: 'pdf', label: 'PDF' };
  return { ic: 'file', label: 'File' };
}

function notFound(root) {
  root.innerHTML = html`
    <div class="pd-gone">
      <span class="pd-gone-ic">${icon('check')}</span>
      <h1>Already built (or removed)</h1>
      <p>This upload isn’t in the inbox anymore. If Claude built it, it’s waiting in your library.</p>
      <a class="btn btn-primary" href="#/">${icon('book')}<span>Go to your library</span></a>
    </div>`;
}

function itemHtml(item) {
  const kind = kindOf(item);
  const files = item.files || [];
  const images = files.filter(p => IMG_RE.test(p)), others = files.filter(p => !IMG_RE.test(p));
  // Pages needs a minute to publish fresh uploads; raw.githubusercontent has them at once.
  const fresh = Date.now() - new Date(item.createdAt || 0) < 15 * 60 * 1000;
  const fileHref = p => (fresh ? rawUrl(p) : mediaUrl(p));
  const href = safeHref(item.url);
  const type = item.url ? linkType(item.url) : null;
  const text = String(item.text || '');
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  const title = item.title || (href ? shortUrl(href) : kind.label === 'Pasted text' ? 'Pasted recipe' : files[0] ? baseName(files[0]) : 'Untitled upload');

  return html`
    <article class="pd">
      <header class="pd-head">
        <span class="pd-kind">${icon(kind.ic)}<span>${kind.label}</span></span>
        <h1 class="pd-title">${title}</h1>
        ${item.createdAt ? html`<p class="pd-date">Sent ${fmtDate(item.createdAt)}</p>` : ''}
      </header>

      ${item.blocked ? html`
        <div class="pd-blocked" role="alert">
          <span class="pd-blocked-ic">${icon('alert')}</span>
          <div class="pd-blocked-body">
            <p class="pd-blocked-msg"><strong>Claude needs help:</strong> ${item.blocked}</p>
            <p>Send it again with what’s missing (for a post, paste its caption under Link), then delete this one.</p>
            <a class="btn btn-sm btn-soft" href="#/add/upload">${icon('upload')}<span>Upload again</span></a>
          </div>
        </div>` : ''}

      <div class="pd-status">
        <span class="pd-dot" aria-hidden="true"></span>
        <div><strong>Waiting for <q>update the site</q></strong>
          <span>The next time you tell Claude <q>update the site</q>, this becomes a full recipe in your library.</span></div>
      </div>

      ${item.url ? html`
        <section class="pd-sec">
          <h2 class="section-title">Link</h2>
          ${href ? html`<a class="pd-link" href="${href}" target="_blank" rel="noopener noreferrer">
              <span class="pd-link-ic">${icon(type)}</span>
              <span class="pd-link-body"><strong>${LINK_LABEL[type]}</strong><span>${shortUrl(href)}</span></span>
              ${icon('external', 'pd-link-ext')}
            </a>` : html`<p class="pd-plain">${item.url}</p>`}
        </section>` : ''}

      ${files.length ? html`
        <section class="pd-sec">
          <h2 class="section-title">${files.length === 1 ? 'File' : `Files · ${files.length}`}</h2>
          ${images.length ? html`<div class="pd-thumbs">${images.map(p => html`
            <a class="pd-thumb" href="${fileHref(p)}" target="_blank" rel="noopener">
              <img src="${mediaUrl(p)}" data-fallback="${rawUrl(p)}" alt="${baseName(p)}" loading="lazy">
            </a>`)}</div>` : ''}
          ${others.length ? html`<ul class="pd-files">${others.map(p => html`
            <li><a href="${fileHref(p)}" target="_blank" rel="noopener">
              <span class="pd-file-ic">${fileIcon(p)}</span>
              <span class="pd-file-name">${baseName(p)}</span>
              ${icon('external', 'pd-link-ext')}
            </a></li>`)}</ul>` : ''}
        </section>` : ''}

      ${text.trim() ? html`
        <section class="pd-sec">
          <details class="pd-text" ${text.length < 400 ? 'open' : ''}>
            <summary><span>${item.kind === 'link' ? 'Caption / description' : 'Pasted text'}</span><span class="pd-count">${words} word${words === 1 ? '' : 's'}</span></summary>
            <div class="pd-pre">${text}</div>
          </details>
        </section>` : ''}

      ${item.hint ? html`
        <section class="pd-sec">
          <h2 class="section-title">Note for the builder</h2>
          <p class="pd-hint">${item.hint}</p>
        </section>` : ''}

      <div class="pd-actions">
        <button type="button" class="btn ed-btn-danger" data-act="delete">${icon('trash')}<span>Delete upload</span></button>
      </div>
    </article>`;
}

export async function render(root, { id } = {}) {
  setTopbar({ title: 'Inbox', back: '#/' });
  const item = id ? await getPending(id, { force: true }) : null;
  if (!item) return notFound(root);
  root.innerHTML = itemHtml(item);

  return on(root, 'click', '[data-act="delete"]', async (e, btn) => {
    const ok = await confirmSheet('The upload and its files leave the inbox and won’t be built into a recipe.',
      { title: 'Delete this upload?', ok: 'Delete', danger: true });
    if (!ok) return;
    try {
      await busy(btn, deletePending(id));
      toast('Upload deleted', { type: 'ok' });
      location.hash = '#/';
    } catch (err) { reportError(err); }
  });
}
