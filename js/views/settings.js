/** views/settings.js — placeholder; replaced by its workstream (see autopilot/TASKS.md). */
import { setTopbar } from '../ui.js';
export async function render(root, params) {
  setTopbar({ title: 'settings' });
  root.innerHTML = '<div class="empty"><p>Coming soon: settings</p></div>';
}
