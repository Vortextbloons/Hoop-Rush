import { rosterDetailsSchema, type RosterDetails } from '../player-season.ts';
import { loadAsset } from './index.ts';
export function parseRosterDetails(value: unknown): RosterDetails {
  return rosterDetailsSchema.parse(value);
}
export function loadRosterDetails(
  url: string,
  expectedHash?: string,
  init?: RequestInit,
): Promise<RosterDetails> {
  return loadAsset(url, rosterDetailsSchema, 'roster details', expectedHash, init);
}
