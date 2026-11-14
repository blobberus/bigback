/** views/playlists.js — placeholder; replaced by its workstream (see autopilot/TASKS.md). */
import { setTopbar } from '../ui.js';
export async function render(root, params) {
  setTopbar({ title: 'playlists' });
  root.innerHTML = '<div class="empty"><p>Coming soon: playlists</p></div>';
}
