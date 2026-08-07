import { rosterDetailsSchema, type RosterDetails } from '../player-season.ts';
import { loadJsonAsset } from './load-json.ts';

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
export function loadRosterDetails(
  url: string,
  expectedHash?: string,
  init?: RequestInit,
): Promise<RosterDetails> {
  return loadJsonAsset(url, {
    label: 'roster details',
    expectedHash,
    parse: parseRosterDetails,
    init,
  });
}
