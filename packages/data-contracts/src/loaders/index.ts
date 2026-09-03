import type { z } from 'zod';
import { loadJsonAsset } from './load-json.ts';

export async function loadAsset<T>(
  url: string,
  schema: z.ZodType<T>,
  label: string,
  expectedHash?: string,
  init?: RequestInit,
): Promise<T> {
  return loadJsonAsset(url, {
    label,
    expectedHash,
    parse: (value: unknown) => schema.parse(value),
    init,
  });
}
