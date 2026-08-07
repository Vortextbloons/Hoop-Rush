import { verifySha256 } from './verify-hash.ts';

/**
 * Shared fetch -> hash-verify -> decode -> schema-parse pipeline for packaged
 * JSON artifacts. Every packaged asset loader (pools, players index, roster
 * details, draft catalog, bracket, era profiles, season artifacts) routes
 * through this single implementation so the boundary validation, error
 * messages, and verification semantics cannot drift between loaders.
 */

export interface LoadJsonAssetOptions<T> {
  /** Artifact label used in error messages (e.g. 'pool', 'players index'). */
  label: string;
  /** Manifest content hash; the response bytes must match when provided. */
  expectedHash?: string;
  /** Runtime schema validation of the decoded JSON. */
  parse: (value: unknown) => T;
  init?: RequestInit;
}

/**
 * Fetches the asset, verifies its bytes against the manifest content hash
 * (skipped when WebCrypto is unavailable), decodes, and validates through the
 * caller's schema parser.
 */
export async function loadJsonAsset<T>(url: string, options: LoadJsonAssetOptions<T>): Promise<T> {
  const response = await fetch(url, options.init);
  if (!response.ok) {
    throw new Error(
      `${options.label} request failed: ${String(response.status)} ${response.statusText}`,
    );
  }
  const bytes = await response.arrayBuffer();
  if (options.expectedHash !== undefined) {
    await verifySha256(bytes, options.expectedHash);
  }
  return options.parse(JSON.parse(new TextDecoder().decode(bytes)) as unknown);
}
