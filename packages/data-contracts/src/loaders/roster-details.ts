import { rosterDetailsSchema, type RosterDetails } from '../player-season.ts';
import { loadJsonAsset } from './load-json.ts';

export function parseRosterDetails(value: unknown): RosterDetails {
  return rosterDetailsSchema.parse(value);
}

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
