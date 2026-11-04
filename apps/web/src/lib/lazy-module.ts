/** Caches a dynamic import so repeated calls share one module load. */
export function lazyModule<T>(load: () => Promise<T>): () => Promise<T> {
  let module: Promise<T> | null = null;
  return () => (module ??= load());
}
