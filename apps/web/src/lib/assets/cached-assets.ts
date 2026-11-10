/**
 * One module-level cache for data assets shared by every room in a mode.
 *
 * Concurrent callers share the in-flight promise, so opening two rooms still
 * loads the catalog once. A rejection is forgotten as soon as it settles, so
 * the next `load()` retries instead of replaying the same failure for the rest
 * of the page's life.
 */
export interface CachedAssets<T> {
  load(): Promise<T>;
}

export function cachedAssets<T>(build: () => Promise<T>): CachedAssets<T> {
  let current: Promise<T> | null = null;
  return {
    load() {
      const pending = current ?? (current = build());
      return pending.catch((error: unknown) => {
        if (current === pending) current = null;
        throw error;
      });
    },
  };
}
