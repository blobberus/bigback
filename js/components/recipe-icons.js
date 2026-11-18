/**
 * components/recipe-icons.js — inline stroke icons for the recipe page and cook mode.
 *   icon(name, cls?) → html raw  (<svg class="rx-ic …" aria-hidden="true">)
 * Names: timer check plus minus edit flame camera note external file chevL chevR close
 *        list trash reset pan info spark
 */
import { raw } from '../util.js';

const P = {
  timer: '<circle cx="12" cy="13.5" r="7.5"/><path d="M12 10v3.5l2.3 1.8M9.5 3h5M12 3v3"/>',
  check: '<path d="M5 12.5l4.2 4.2L19 7"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  edit: '<path d="M4 20l1-4.5L15.5 5a1.5 1.5 0 0 1 2.1 0l1.4 1.4a1.5 1.5 0 0 1 0 2.1L8.5 19z"/><path d="M13.5 7l3.5 3.5"/>',
  flame: '<path d="M12 3c.6 3-1.2 4.6-2.7 6.3C7.9 10.9 7 12.4 7 14.5a5 5 0 0 0 10 0c0-2.2-1-3.9-2.2-5.1-.2 1.4-.9 2.3-1.8 2.7.4-3.3-.4-6.6-1-9.1z"/>',
  camera: '<path d="M4 8.5A1.5 1.5 0 0 1 5.5 7h2.2l1.5-2h5.6l1.5 2h2.2A1.5 1.5 0 0 1 20 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5z"/><circle cx="12" cy="13" r="3.5"/>',
  note: '<path d="M5 5h14v10H10l-5 4z"/><path d="M9 9h6M9 12h3.5"/>',
  external: '<path d="M14 4h6v6M20 4l-8.5 8.5M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
  file: '<path d="M14 3H7a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V7z"/><path d="M14 3v4h4M9 13h6M9 17h4"/>',
  chevL: '<path d="M15 5l-7 7 7 7"/>',
  chevR: '<path d="M9 5l7 7-7 7"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  share: '<path d="M12 3.5v11M8 7.5l4-4 4 4"/><path d="M7 11H5.5v9h13v-9H17"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  copy: '<rect x="8.5" y="8.5" width="11" height="11" rx="2"/><path d="M15.5 8.5V6a1.5 1.5 0 0 0-1.5-1.5H6A1.5 1.5 0 0 0 4.5 6v8A1.5 1.5 0 0 0 6 15.5h2.5"/>',
  list: '<path d="M9.5 6H20M9.5 12H20M9.5 18H20"/><circle cx="5" cy="6" r="1.2"/><circle cx="5" cy="12" r="1.2"/><circle cx="5" cy="18" r="1.2"/>',
  trash: '<path d="M4 7h16M9.5 7V4.5h5V7M6.5 7l.9 12.5h9.2L17.5 7M10 11v5M14 11v5"/>',
  reset: '<path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3L4.5 9"/><path d="M4.5 4.5V9H9"/>',
  pan: '<circle cx="10" cy="14.5" r="6"/><path d="M16 14.5h5.5"/><path d="M7.8 3.5c-.9 1 .9 2.1 0 3.3M11.8 3.5c-.9 1 .9 2.1 0 3.3"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5M12 8h.01"/>',
  spark: '<path d="M12 3.5l1.7 5 5 1.7-5 1.7-1.7 5-1.7-5-5-1.7 5-1.7z"/><path d="M18.5 15.5l.6 1.8 1.8.6-1.8.6-.6 1.8-.6-1.8-1.8-.6 1.8-.6z"/>'
};

export const icon = (name, cls = '') =>
  raw(`<svg class="rx-ic${cls ? ' ' + cls : ''}" viewBox="0 0 24 24" aria-hidden="true">${P[name] || ''}</svg>`);
