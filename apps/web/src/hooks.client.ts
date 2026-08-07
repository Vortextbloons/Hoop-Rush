import { browser } from '$app/environment';

/**
 * Dev-only recovery when Vite HMR serves stale route chunk URLs (common over
 * Tailscale/LAN after dependency re-optimization). Reload once so SvelteKit
 * fetches fresh `nodes/*.js` modules instead of failing the router start.
 */
if (browser && import.meta.hot) {
  let reloaded = false;
  window.addEventListener('vite:preloadError', (event) => {
    if (reloaded) return;
    event.preventDefault();
    reloaded = true;
    window.location.reload();
  });
}
