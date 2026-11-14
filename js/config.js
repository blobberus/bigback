/** config.js — repo defaults (overridable per device in Settings). */
export const DEFAULT_REPO = { owner: 'blobberus', repo: 'bigback', branch: 'main' };
export const APP_VERSION = '0.1.0';
/** Public raw URL base — new uploads are visible here before Pages redeploys. */
export const rawBase = ({ owner, repo, branch }) => `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/`;
