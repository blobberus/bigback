/** views/pending.js — placeholder; replaced by its workstream (see autopilot/TASKS.md). */
import { setTopbar } from '../ui.js';
export async function render(root, params) {
  setTopbar({ title: 'pending' });
  root.innerHTML = '<div class="empty"><p>Coming soon: pending</p></div>';
}
