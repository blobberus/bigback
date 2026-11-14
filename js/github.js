/**
 * github.js — minimal GitHub REST client for a repo-as-database.
 *
 *   const gh = new GitHub({ token, owner, repo, branch });
 *   await gh.readText('recipes/index.json')        // string | null (404)
 *   await gh.readJson('data/library.json', {})     // parsed | fallback
 *   await gh.list('inbox')                         // [{ name, path, type, sha }]
 *   await gh.commit('Add note', async (read) => [  // atomic multi-file commit
 *     { path: 'journal/x.json', text: '...' },      //   text content (utf-8)
 *     { path: 'media/x/a.jpg', base64: '...' },     //   binary content
 *     { path: 'inbox/old/item.json', delete: true } //   deletion
 *   ]);
 *
 * `commit` takes either an array or an async builder. With a builder, the builder
 * receives `read(path)` (text|null at the exact parent commit) and is re-run if the
 * branch moved underneath us, so read-modify-write of JSON files never clobbers.
 */
const API = 'https://api.github.com';

export class GitHubError extends Error {
  constructor(message, status, body) { super(message); this.status = status; this.body = body; }
}

export class GitHub {
  constructor({ token, owner, repo, branch = 'main' }) {
    Object.assign(this, { token, owner, repo, branch });
  }
  get base() { return `${API}/repos/${this.owner}/${this.repo}`; }

  async req(method, url, body, { accept = 'application/vnd.github+json', allow404 = false } = {}) {
    const res = await fetch(url.startsWith('http') ? url : this.base + url, {
      method,
      headers: {
        Accept: accept,
        ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        'X-GitHub-Api-Version': '2022-11-28'
      },
      body: body ? JSON.stringify(body) : undefined,
      cache: 'no-store'
    });
    if (allow404 && res.status === 404) return null;
    if (!res.ok) {
      let detail = ''; try { detail = (await res.json()).message; } catch {}
      throw new GitHubError(`GitHub ${method} ${res.status}: ${detail || res.statusText}`, res.status, detail);
    }
    if (accept.includes('raw')) return res.text();
    return res.status === 204 ? null : res.json();
  }

  /** Raw file text at `ref` (default branch head). null when missing. */
  readText(path, ref = this.branch) {
    return this.req('GET', `/contents/${encodePath(path)}?ref=${encodeURIComponent(ref)}`, null,
      { accept: 'application/vnd.github.raw+json', allow404: true });
  }

  async readJson(path, fallback = null, ref) {
    const t = await this.readText(path, ref);
    if (t == null) return fallback;
    try { return JSON.parse(t); } catch { return fallback; }
  }

  async list(path, ref = this.branch) {
    const r = await this.req('GET', `/contents/${encodePath(path)}?ref=${encodeURIComponent(ref)}`, null, { allow404: true });
    return Array.isArray(r) ? r.map(({ name, path, type, sha, size }) => ({ name, path, type, sha, size })) : [];
  }

  /** Repo metadata + whether the token can push. */
  async check() {
    const r = await this.req('GET', '');
    return { fullName: r.full_name, private: r.private, canPush: !!r.permissions?.push, defaultBranch: r.default_branch, pagesUrl: `https://${this.owner}.github.io/${this.repo}/` };
  }

  /** Atomic multi-file commit. Returns the new commit sha. */
  async commit(message, changes, { retries = 3 } = {}) {
    for (let attempt = 0; ; attempt++) {
      const ref = await this.req('GET', `/git/ref/heads/${this.branch}`);
      const parent = ref.object.sha;
      const parentCommit = await this.req('GET', `/git/commits/${parent}`);
      const read = path => this.readText(path, parent);
      const files = typeof changes === 'function' ? await changes(read) : changes;
      if (!files || !files.length) return parent;

      const tree = [];
      for (const f of files) {
        if (f.delete) { tree.push({ path: f.path, mode: '100644', type: 'blob', sha: null }); continue; }
        const blob = await this.req('POST', '/git/blobs',
          f.base64 != null ? { content: f.base64, encoding: 'base64' } : { content: f.text, encoding: 'utf-8' });
        tree.push({ path: f.path, mode: '100644', type: 'blob', sha: blob.sha });
      }
      const newTree = await this.req('POST', '/git/trees', { base_tree: parentCommit.tree.sha, tree });
      const commit = await this.req('POST', '/git/commits', { message, tree: newTree.sha, parents: [parent] });
      try {
        await this.req('PATCH', `/git/refs/heads/${this.branch}`, { sha: commit.sha, force: false });
        return commit.sha;
      } catch (e) {
        // 422 = not a fast-forward (someone pushed meanwhile). Rebuild on the new head.
        if (e.status === 422 && attempt < retries) { await new Promise(r => setTimeout(r, 400 * (attempt + 1))); continue; }
        throw e;
      }
    }
  }
}

function encodePath(p) { return String(p).split('/').map(encodeURIComponent).join('/'); }

/** Pretty JSON exactly as the Python scripts write it (2-space, trailing newline). */
export const toJsonText = obj => JSON.stringify(obj, null, 2) + '\n';
