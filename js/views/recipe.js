/** views/recipe.js — placeholder; replaced by its workstream (see autopilot/TASKS.md). */
import { setTopbar } from '../ui.js';
export async function render(root, params) {
  setTopbar({ title: 'recipe' });
  root.innerHTML = '<div class="empty"><p>Coming soon: recipe</p></div>';
}
