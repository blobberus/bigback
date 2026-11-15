/**
 * tests/fake-github.js — a stand-in GitHub API so test pages can run the app's write paths
 * (library batches, notes, photos) with a token, without the network.
 *   const gh = fakeGitHub({ files })   wraps window.fetch: api.github.com reads serve the repo's own
 *                             files (the page needs <base href="/">) or a fixture from files
 *                             { 'recipes/x.json': obj }, commits are only recorded in
 *                             gh.commits [{ message, paths }]; sets a fake token in bb.prefs
 *   gh.restore()              puts bb.prefs back and drops the store's bb.cache:* snapshots
 *                             (smoke.py runs every route in one browser profile)
 */
export function fakeGitHub({ files = {} } = {}) {
  const realFetch = window.fetch.bind(window);
  const commits = [];
  let n = 0;
  const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json' } });
  window.fetch = async (u, o = {}) => {
    const url = String(u);
    if (!url.startsWith('https://api.github.com/')) return realFetch(u, o);
    const p = url.replace(/^https:\/\/api\.github\.com\/repos\/[^/]+\/[^/]+/, '').split('?')[0], method = o.method || 'GET';
    if (p.startsWith('/contents/')) {
      const path = decodeURIComponent(p.slice('/contents/'.length));
      if (files[path]) return new Response(JSON.stringify(files[path]));
      const r = await realFetch(path, { cache: 'no-store' });
      return r.ok ? new Response(await r.text()) : json({ message: 'Not Found' }, 404);
    }
    if (p.startsWith('/git/ref/')) return json({ object: { sha: 'c0' } });
    if (p.startsWith('/git/commits/')) return json({ tree: { sha: 't0' } });
    if (method === 'POST' && p === '/git/blobs') return json({ sha: `b${++n}` });
    if (method === 'POST' && p === '/git/trees') { commits.push({ paths: JSON.parse(o.body).tree.map(t => t.path) }); return json({ sha: `t${++n}` }); }
    if (method === 'POST' && p === '/git/commits') { commits.at(-1).message = JSON.parse(o.body).message; return json({ sha: `c${++n}` }); }
    if (method === 'PATCH') return json({});
    return json({ message: `unexpected ${method} ${p}` }, 500);
  };
  const PREFS = 'bb.prefs', prev = localStorage.getItem(PREFS);
  localStorage.setItem(PREFS, JSON.stringify({ token: 'fake-token', owner: 'test', repo: 'test', branch: 'main' }));
  return {
    commits,
    restore() {
      window.fetch = realFetch;
      if (prev == null) localStorage.removeItem(PREFS); else localStorage.setItem(PREFS, prev);
      Object.keys(localStorage).filter(k => k.startsWith('bb.cache:')).forEach(k => localStorage.removeItem(k));
    }
  };
}
