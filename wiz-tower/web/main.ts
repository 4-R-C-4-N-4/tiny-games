/**
 * Browser entry — the Phase 1 playable. Mounts the GameView (Canvas board + DOM controls)
 * driven by the same headless sim the trainer uses. No renderer code leaks into src/.
 */
import { GameView } from './view.ts';

const root = document.getElementById('app');
if (root) {
  const view = new GameView(root);
  // Debug handle for headless verification / console poking. Harmless in production.
  (window as unknown as { wt: GameView }).wt = view;
}
