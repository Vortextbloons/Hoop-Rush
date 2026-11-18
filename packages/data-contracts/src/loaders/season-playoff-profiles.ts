import {
  seasonPlayoffProfilesSchema,
  type SeasonPlayoffProfiles,
} from '../season-playoff-profiles.ts';

export function parseSeasonPlayoffProfiles(value: unknown): SeasonPlayoffProfiles {
  return seasonPlayoffProfilesSchema.parse(value);
}
