import { browser } from '$app/env';
if (browser && import.meta.hot) {
  let reloaded = false;
  window.addEventListener('vite:preloadError', (event) => {
    if (reloaded) return;
    event.preventDefault();
    reloaded = true;
    window.location.reload();
  });
}
