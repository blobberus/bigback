/**
 * share.js — the public, read-only page for one shared recipe: share.html?r=<slug>.
 * No password gate (lock.js isn't loaded), no bottom nav or links into the vault, nothing that
 * writes: photo, title, summary, times, source → "About this dish" (the profile) → equipment →
 * ingredients (scaler, conversions, check-off) → method (tap a number to check it off, timers,
 * why-tips). Notes, photos, ratings, tags, the changelog, cook mode and Edit are never rendered.
 * Check-offs and timers stay on the viewer's own device (sessionStorage / localStorage).
 *
 * Only recipes whose library entry has `sharedAt` show (owner: recipe page → Share); any other
 * slug gets "isn't shared" and its recipe file isn't fetched. The site's copy of data/library.json
 * trails a commit by the Pages redeploy (~1 min), so a recipe it doesn't list is checked once
 * against the repo itself (GitHub API, no token), and a link created a moment ago works at once.
 * A later refresh that drops `sharedAt` (sharing stopped) repaints to "isn't shared".
 *   renderShared(root, slug) → cleanup   (tests call it directly)
 *   boot()                                share.html: reads ?r=, mounts the timer tray, renders #view
 */
import { getRecipe, getLibrary, onChange } from './store.js';
import { GitHub } from './github.js';
import { getPrefs } from './prefs.js';
import { on, setTopbar } from './ui.js';
import { html } from './util.js';
import { icon } from './components/recipe-icons.js';
import { heroHtml, statsHtml, sourceHtml, photoCreditHtml } from './components/recipe-head.js';
import { rxState, rxPatch, toggleId } from './components/recipe-state.js';
import { ingredientsHtml, bindIngredients } from './components/recipe-ingredients.js';
import { groupBySection, stepTextHtml, tempsHtml, timerButtonsHtml, bindTimers } from './components/recipe-steps.js';
import { mentionMatcher, bindMentions } from './components/recipe-mentions.js';

const LIB = 'data/library.json';
const SLUG = /^[a-z0-9][a-z0-9-]{0,80}$/;
const PAST_TITLE = 'rx-past-title';

/** The repo's own library.json, not the site's copy. False when unreachable (offline, or over the
 *  API's 60 reads an hour without a token). */
async function sharedInRepo(slug) {
  try {
    const lib = await new GitHub({ ...getPrefs(), token: '' }).readJson(LIB, null);
    return !!lib?.recipes?.[slug]?.sharedAt;
  } catch { return false; }
}

export async function renderShared(root, slug) {
  const valid = SLUG.test(slug || '');
  const openDetails = new Set();
  let recipe = null, repoSays = null, seq = 0, io = null, timers = null, alive = true;

  async function isShared() {
    if (!valid) return false;
    if ((await getLibrary())?.recipes?.[slug]?.sharedAt) return true;
    if (repoSays === null) repoSays = await sharedInRepo(slug);
    return repoSays;
  }

  async function paint() {
    const my = ++seq;
    const ok = await isShared();
    const r = ok ? await getRecipe(slug) : null;
    if (my !== seq || !alive) return;
    recipe = r;
    if (!r) return paintClosed(ok ? 'missing' : 'not-shared');
    setTopbar({ title: r.title || 'Recipe' });
    root.innerHTML = page(r);
    timers?.refresh();
    observeTitle();
  }

  function paintClosed(kind) {
    setTopbar({ title: 'Bigback' });
    document.title = 'Shared recipe · Bigback';
    io?.disconnect();
    document.body.classList.add(PAST_TITLE);
    root.innerHTML = html`
      <div class="empty rx-missing">
        ${icon('pan', 'rx-missing-ic')}
        ${kind === 'missing' ? html`
          <h2>This recipe isn’t available anymore</h2>
          <p>It may have been renamed or removed.</p>` : html`
          <h2>This recipe isn’t shared</h2>
          <p>The link may be incomplete, or sharing was turned off. Ask whoever sent it for a new link.</p>`}
      </div>`;
  }

  function observeTitle() {
    io?.disconnect();
    const t = root.querySelector('.rx-title');
    if (!t || !('IntersectionObserver' in window)) { document.body.classList.add(PAST_TITLE); return; }
    document.body.classList.remove(PAST_TITLE);
    io = new IntersectionObserver(([en]) => {
      document.body.classList.toggle(PAST_TITLE, !en.isIntersecting && en.boundingClientRect.top < 80);
    }, { rootMargin: '-60px 0px 0px 0px' });
    io.observe(t);
  }

  /* ---------- markup ---------- */
  function page(r) {
    const st = rxState(slug);
    const steps = r.steps || [];
    return html`
      <article class="rx rx-shared">
        ${heroHtml(r)}
        <header class="rx-head">
          <h1 class="rx-title">${r.title}</h1>
          ${r.summary ? html`<p class="rx-summary">${r.summary}</p>` : ''}
          ${statsHtml(r)}
          ${r.yield ? html`<p class="rx-line"><span class="rx-label">Makes</span><span>${r.yield}</span></p>` : ''}
          ${sourceHtml(r)}
          ${photoCreditHtml(r)}
        </header>
        ${r.profile ? html`
          <details class="rx-details" data-key="profile" ${openDetails.has('profile') ? 'open' : ''}>
            <summary><span>About this dish</span>${icon('chevR', 'rx-chev')}</summary>
            <div class="rx-details-body"><p>${r.profile}</p></div>
          </details>` : ''}
        ${(r.equipment || []).length ? html`
          <section class="rx-section" aria-labelledby="rx-h-equip">
            <h2 id="rx-h-equip" class="rx-h rx-h-sm">Equipment</h2>
            <ul class="rx-equip">${r.equipment.map(e => html`<li>${e}</li>`)}</ul>
          </section>` : ''}
        <section class="rx-section" aria-labelledby="rx-h-ing">
          <h2 id="rx-h-ing" class="rx-h">Ingredients</h2>
          <div data-ingredients>${ingredientsHtml(r, slug)}</div>
        </section>
        <section class="rx-section" aria-labelledby="rx-h-steps">
          <div class="rx-h-row">
            <h2 id="rx-h-steps" class="rx-h">Method</h2>
            <span class="rx-h-aside" data-steps-meta>${stepsMeta(st, steps)}</span>
          </div>
          ${steps.length ? stepsHtml(r, st) : html`<p class="muted">No steps yet.</p>`}
        </section>
        <p class="rx-share-foot">Shared from a Bigback recipe vault · view only</p>
      </article>`;
  }

  function stepsMeta(st, steps) {
    const done = steps.filter(s => st.done.includes(s.id)).length;
    if (!steps.length) return '';
    if (!done) return html`<span>Tap a number to check it off</span>`;
    return html`<span>${done} of ${steps.length} done</span><button type="button" class="rx-link-btn" data-act="steps-reset">${icon('reset')} Reset</button>`;
  }

  function stepsHtml(r, st) {
    const done = new Set(st.done);
    const match = mentionMatcher(r.ingredients, { slug });
    let n = 0;
    return groupBySection(r.steps).map((g, gi) => html`
      ${g.section ? html`<h3 class="rx-subhead">${g.section}</h3>` : gi ? html`<hr class="rx-sep">` : ''}
      <ol class="rx-steps">${g.items.map(s => {
        n += 1;
        const isDone = done.has(s.id);
        return html`
          <li class="rx-step${isDone ? ' is-done' : ''}" id="step-${s.id}">
            <button type="button" class="rx-num" data-act="step-done" data-id="${s.id}" aria-pressed="${isDone}" aria-label="Step ${n} done">
              <span class="rx-num-n">${n}</span>${icon('check', 'rx-num-check')}
            </button>
            <div class="rx-step-body">
              <p class="rx-step-text">${stepTextHtml(s, n, { match })}</p>
              ${timerButtonsHtml(s)}
              ${s.tip ? html`<aside class="rx-tip"><span class="rx-tip-label">Why</span>${tempsHtml(s.tip)}</aside>` : ''}
            </div>
          </li>`;
      })}</ol>`);
  }

  /* ---------- actions ---------- */
  function onClick(e, el) {
    if (!recipe) return;
    if (el.dataset.act === 'step-done') {
      const id = el.dataset.id;
      const st = rxPatch(slug, s => ({ ...s, done: toggleId(s.done, id) }));
      const isDone = st.done.includes(id);
      el.setAttribute('aria-pressed', String(isDone));
      el.closest('.rx-step')?.classList.toggle('is-done', isDone);
      const meta = root.querySelector('[data-steps-meta]');
      if (meta) meta.innerHTML = stepsMeta(st, recipe.steps || []);
    } else if (el.dataset.act === 'steps-reset') {
      rxPatch(slug, { done: [], step: null });
      paint();
    }
  }
  const onToggle = e => {
    const d = e.target;
    if (d?.tagName === 'DETAILS' && d.dataset.key) { if (d.open) openDetails.add(d.dataset.key); else openDetails.delete(d.dataset.key); }
  };

  await paint();
  timers = bindTimers(root, slug);
  const mine = new Set([LIB, `recipes/${slug}.json`]);
  const offs = [
    timers,
    bindIngredients(root, () => recipe, slug),
    bindMentions(root, () => recipe, slug),
    on(root, 'click', '[data-act]', onClick),
    onChange(ev => { if ((ev.paths || []).some(p => mine.has(p))) paint().catch(console.error); })
  ];
  root.addEventListener('toggle', onToggle, true);
  return () => {
    alive = false;
    offs.forEach(off => off());
    root.removeEventListener('toggle', onToggle, true);
    io?.disconnect();
    document.body.classList.remove(PAST_TITLE);
  };
}

export function boot() {
  // <img data-fallback>: a photo the site hasn't redeployed yet comes from raw.githubusercontent.
  document.addEventListener('error', e => {
    const img = e.target;
    if (img.tagName === 'IMG' && img.dataset.fallback && img.src !== img.dataset.fallback) {
      img.src = img.dataset.fallback; delete img.dataset.fallback;
    }
  }, true);
  import('./timers.js').then(m => m.mount()).catch(console.error);
  const root = document.getElementById('view');
  root.setAttribute('aria-busy', 'true');
  renderShared(root, new URLSearchParams(location.search).get('r') || '')
    .catch(e => { console.error(e); root.innerHTML = '<div class="empty"><p>Couldn’t open this recipe.</p></div>'; })
    .finally(() => root.removeAttribute('aria-busy'));
}
