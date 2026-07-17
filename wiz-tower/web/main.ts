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

// Register the offline service worker (secure contexts incl. localhost). Best-effort.
if ('serviceWorker' in navigator && window.isSecureContext) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js', { scope: './' }).catch(() => {});
  });
}

