/**
 * tests/fixtures/fake-store.js — stands in for js/store.js on a test page, through an import map:
 *   <script type="importmap">{ "imports": { "../js/store.js": "./fixtures/fake-store.js" } }</script>
 * so forms can be driven end to end with no token and nothing ever reaching GitHub.
 *   calls → [[name, ...args]]                every write the page asked for
 *   hold(name) / release(name)               the next `name` call waits until released
 *   setPending(item) / setRecipe(r)          what getPending() / getRecipe() return (holdable too)
 */
export class NotConnectedError extends Error {
  constructor() { super('Connect GitHub in Settings to save changes.'); this.name = 'NotConnectedError'; }
}

export const calls = [];
const gates = new Set(), held = new Map();
export const hold = name => { gates.add(name); };
export function release(name) {
  gates.delete(name);
  const h = held.get(name);
  held.delete(name);
  h?.resolve(h.value);
}
function call(name, value, args) {
  calls.push([name, ...args]);
  if (!gates.has(name)) return Promise.resolve(value);
  return new Promise(resolve => held.set(name, { resolve, value }));
}

export const uploadToInbox = (...a) => call('uploadToInbox', 'test-upload-1', a);
export const saveRecipe = (r, opts) => call('saveRecipe', r.slug || 'test-recipe', [r, opts]);
export const deleteRecipe = (...a) => call('deleteRecipe', undefined, a);
export const deletePending = (...a) => call('deletePending', undefined, a);

let pending = null, recipe = null;
export const setPending = item => { pending = item; };
export const setRecipe = r => { recipe = r; };
export const getPending = (...a) => call('getPending', pending, a);
export const getRecipe = (...a) => call('getRecipe', recipe, a);
export const getJournal = async slug => ({ slug, entries: [] });
export const getIndex = (...a) => call('getIndex', { recipes: [], pending: [] }, a);
export const onChange = () => () => {};
export const mediaUrl = p => (p ? `../${p}` : '');
export const rawUrl = mediaUrl;
