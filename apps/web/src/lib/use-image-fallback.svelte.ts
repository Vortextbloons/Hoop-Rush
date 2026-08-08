/**
 * Shared image-fallback chain for logo components: a source-index state that
 * advances through candidate URLs on `onerror`, resets when the identity
 * key changes (new franchise/team/candidates), and reports exhaustion so the
 * caller can render its own placeholder. Values are exposed through getters
 * so template reads stay reactive.
 */

export interface ImageFallbackState {
  /** Current candidate URL ('' when every candidate failed). */
  get src(): string;
  /** True when every candidate failed (caller renders its fallback). */
  get failed(): boolean;
  /** Advance to the next candidate (no-op on the last). */
  onError(): void;
}

export function useImageFallback(options: {
  /** The candidate URLs in fallback order (reactive read). */
  urls: () => readonly string[];
  /** Identity key; when it changes the fallback restarts at the first URL. */
  key: () => string;
}): ImageFallbackState {
  let attempt = $state(0);
  let lastKey = '';
  $effect(() => {
    const current = options.key();
    if (current !== lastKey) {
      lastKey = current;
      attempt = 0;
    }
  });
  const urls = $derived(options.urls());
  return {
    get src() {
      return urls[attempt] ?? '';
    },
    get failed() {
      return attempt >= urls.length;
    },
    onError() {
      if (attempt < urls.length - 1) {
        attempt += 1;
        return;
      }
      attempt = urls.length;
    },
  };
}
