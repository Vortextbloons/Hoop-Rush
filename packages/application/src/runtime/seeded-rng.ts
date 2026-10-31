import { createRng } from '@hoop-rush/engine';

export function createSeededRng(seed: string): () => number {
  const rng = createRng(seed);
  return () => rng.next();
}
