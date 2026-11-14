/**
 * components/editor-icons.js — inline stroke icons for the add / upload / edit / pending views (WS3).
 *   icon(name, cls?) → raw svg (24×24, currentColor, aria-hidden). Unknown name → empty.
 */
import { raw, esc } from '../util.js';

const P = {
  pen: '<path d="M4 20h4L18.5 9.5a2.1 2.1 0 0 0-4-4L4 16v4z"/><path d="M13.5 6.5l4 4"/>',
  upload: '<path d="M12 15V4M7.5 8.5L12 4l4.5 4.5"/><path d="M4 15v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4"/>',
  chevron: '<path d="M9 6l6 6-6 6"/>',
  file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>',
  pdf: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h4"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  text: '<path d="M5 6h14M5 10h14M5 14h10M5 18h7"/>',
  camera: '<path d="M4 8.5h3l1.8-3h6.4l1.8 3h3V19H4z"/><circle cx="12" cy="13.5" r="3.5"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="2.5"/><circle cx="8.5" cy="9.5" r="1.5"/><path d="M21 15.5l-5-5L6.5 20"/>',
  timer: '<circle cx="12" cy="13.5" r="7.5"/><path d="M12 10v3.5l2.2 2M9.5 3h5"/>',
  x: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  alert: '<path d="M12 3.5l9 16H3z"/><path d="M12 10v4M12 17v.01"/>',
  plug: '<path d="M9 3v4.5M15 3v4.5M6.5 7.5h11v3a5.5 5.5 0 0 1-11 0zM12 16v5"/>',
  inbox: '<path d="M3 13l3-8h12l3 8v6H3z"/><path d="M3 13h5l1.2 2.5h5.6L16 13h5"/>',
  youtube: '<rect x="2.5" y="5.5" width="19" height="13" rx="4"/><path d="M10.2 9.3v5.4l4.6-2.7z"/>',
  instagram: '<rect x="3.5" y="3.5" width="17" height="17" rx="5"/><circle cx="12" cy="12" r="4"/><path d="M17 7v.01"/>',
  tiktok: '<path d="M14 4v10.5a3.5 3.5 0 1 1-3.5-3.5"/><path d="M14 4c.6 2.6 2.5 4.2 5 4.4"/>',
  web: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z"/>',
  spark: '<path d="M12 3.5l1.9 6.6 6.6 1.9-6.6 1.9L12 20.5l-1.9-6.6L3.5 12l6.6-1.9z"/>',
  history: '<path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1L3.5 8.5"/><path d="M3.5 4v4.5H8M12 7.5V12l3 2"/>',
  clipboard: '<rect x="5.5" y="4.5" width="13" height="16" rx="2"/><path d="M9 4.5V3h6v1.5M9 10h6M9 14h4"/>',
  external: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  book: '<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5z"/><path d="M4 20.5A2.5 2.5 0 0 0 6.5 23H20v-5"/>'
};

export function icon(name, cls = '') {
  const p = P[name];
  return raw(p ? `<svg viewBox="0 0 24 24" aria-hidden="true"${cls ? ` class="${esc(cls)}"` : ''}>${p}</svg>` : '');
}

/** Icon for an inbox file path / File, by extension or MIME type. */
export function fileIcon(nameOrType = '') {
  const s = String(nameOrType).toLowerCase();
  if (/^image\/|\.(jpe?g|png|gif|webp|heic|heif|avif|bmp)$/.test(s)) return icon('image');
  if (/pdf$/.test(s)) return icon('pdf');
  return icon('file');
}
