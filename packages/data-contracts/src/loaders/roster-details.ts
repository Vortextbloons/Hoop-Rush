import { rosterDetailsSchema, type RosterDetails } from '../player-season.ts';
export function parseRosterDetails(value: unknown): RosterDetails {
  return rosterDetailsSchema.parse(value);
}
