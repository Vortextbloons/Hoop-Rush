import { seasonDraftCatalogSchema, type SeasonDraftCatalog } from '../season-draft-catalog.ts';
import { sha256Hex } from './verify-hash.ts';

/** Validate an unknown draft catalog value at a runtime boundary. */
export function parseSeasonDraftCatalog(value: unknown): SeasonDraftCatalog {
  return seasonDraftCatalogSchema.parse(value);
}

/**
 * Fetch, hash-verify, and validate the packaged Season Run draft catalog.
 * When `expectedHash` is provided (manifest content hash), the response bytes
 * must match before the catalog is parsed.
 */
export async function loadSeasonDraftCatalog(
  url: string,
  expectedHash?: string,
  init?: RequestInit,
): Promise<SeasonDraftCatalog> {
  const response = await fetch(url, init);
  if (!response.ok) {
    throw new Error(
      `draft catalog request failed: ${String(response.status)} ${response.statusText}`,
    );
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (expectedHash !== undefined) {
    const digest = await sha256Hex(bytes);
    if (digest !== expectedHash) {
      throw new Error(
        `draft catalog content hash mismatch: expected ${expectedHash}, got ${digest}`,
      );
    }
  }
  const text = new TextDecoder().decode(bytes);
  return parseSeasonDraftCatalog(JSON.parse(text) as unknown);
}
