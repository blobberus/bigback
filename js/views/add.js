/**
 * views/add.js — #/add chooser, #/add/custom, #/add/upload, #/edit/<slug> (WS3).
 *   params.mode: 'choose' | 'custom' | 'upload' | 'edit' (+ params.slug)
 * The forms live in components/editor-form.js (custom + edit) and editor-upload.js.
 */
import { setTopbar } from '../ui.js';
import { html } from '../util.js';
import { getIndex, getRecipe, onChange } from '../store.js';
import { linkType } from '../components/editor-parse.js';
import { icon } from '../components/editor-icons.js';
import { loadDraft, draftKey, draftAge } from '../components/editor-drafts.js';
import { mountRecipeForm } from '../components/editor-form.js';
import { mountUploadForm } from '../components/editor-upload.js';

export async function render(root, params = {}) {
  const mode = params.mode || 'choose';
  if (mode === 'custom') {
    setTopbar({ title: 'New recipe', back: '#/add' });
    return mountRecipeForm(root, { recipe: null });
  }
  if (mode === 'edit') {
    setTopbar({ title: 'Edit recipe', back: `#/r/${params.slug}` });
    const recipe = await getRecipe(params.slug);
    if (!recipe) {
      root.innerHTML = html`<div class="empty">
        <p><strong>That recipe isn’t here.</strong></p>
        <p class="muted small">It may have been renamed or deleted.</p>
        <a class="btn" href="#/">Back to recipes</a></div>`;
      return;
    }
    return mountRecipeForm(root, { recipe });
  }
  if (mode === 'upload') {
    setTopbar({ title: 'Upload', back: '#/add' });
    return mountUploadForm(root);
  }
  return renderChooser(root);
}

const shortDate = iso => { const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); };
export const kindIcon = p => icon(p.kind === 'link' ? linkType(p.url || '') : p.kind === 'text' ? 'text' : 'file');

async function renderChooser(root) {
  setTopbar({ title: 'Add', back: '#/' });
  const paint = idx => {
    const draft = loadDraft(draftKey.new);
    const pending = [...(idx?.pending || [])].sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
    root.innerHTML = html`
      <div class="add">
        <header class="add-head">
          <h1>Add a recipe</h1>
          <p>Type it in yourself, or hand over the raw material and let Claude build it.</p>
        </header>
        <div class="add-cards">
          <a class="add-card" href="#/add/custom">
            <span class="add-ic">${icon('pen')}</span>
            <span class="add-body">
              <span class="add-title">Write it myself</span>
              <span class="add-desc">Type or paste ingredients and steps. Each line is understood as you go.</span>
              ${draft ? html`<span class="add-draft">${icon('history')}<span>Draft · ${draft.title || 'Untitled'} · ${draftAge(draft.savedAt)}</span></span>` : ''}
            </span>
            ${icon('chevron', 'add-chev')}
          </a>
          <a class="add-card add-card-alt" href="#/add/upload">
            <span class="add-ic">${icon('upload')}</span>
            <span class="add-body">
              <span class="add-title">Upload a file or link</span>
              <span class="add-desc">A PDF, a photo of a recipe card, a YouTube, Instagram, TikTok or web link, or pasted text.</span>
            </span>
            ${icon('chevron', 'add-chev')}
          </a>
        </div>
        <p class="add-note">${icon('spark')}<span>Uploads wait in your inbox and are built into a full recipe the next time Claude is told <q>update the site</q>.</span></p>
        ${pending.length ? html`
          <h2 class="section-title">Waiting in your inbox · ${pending.length}</h2>
          <ul class="add-inbox">
            ${pending.map(p => html`<li><a href="#/pending/${p.id}">
              <span class="add-inbox-ic">${kindIcon(p)}</span>
              <span class="add-inbox-t">${p.title || p.url || 'Untitled upload'}</span>
              <span class="add-inbox-d">${shortDate(p.createdAt)}</span>
              ${icon('chevron', 'add-chev')}
            </a></li>`)}
          </ul>` : ''}
      </div>`;
  };
  paint(await getIndex().catch(() => null));
  return onChange(ev => { if (ev.type === 'write' || ev.paths?.includes('recipes/index.json')) getIndex().then(paint, () => {}); });
}
