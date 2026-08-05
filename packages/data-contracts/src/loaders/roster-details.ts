import { rosterDetailsSchema, type RosterDetails } from '../player-season.ts';
import { sha256Hex } from './verify-hash.ts';

/** Validate an unknown roster-details value at a runtime boundary. */
export function parseRosterDetails(value: unknown): RosterDetails {
  return rosterDetailsSchema.parse(value);
}

/**
 * Fetch, hash-verify, and validate the roster-details asset (season
 * statistics and physical profile for the Roster browser). When
 * `expectedHash` is provided (manifest content hash), the response bytes must
 * match before the details are parsed.
 */
export async function loadRosterDetails(
  url: string,
  expectedHash?: string,
  init?: RequestInit,
): Promise<RosterDetails> {
  const response = await fetch(url, init);
  if (!response.ok) {
    throw new Error(
      `roster details request failed: ${String(response.status)} ${response.statusText}`,
    );
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (expectedHash !== undefined) {
    const digest = await sha256Hex(bytes);
    if (digest !== expectedHash) {
      throw new Error(
        `roster details content hash mismatch: expected ${expectedHash}, got ${digest}`,
      );
    }
  }
  const text = new TextDecoder().decode(bytes);
  return parseRosterDetails(JSON.parse(text) as unknown);
}
