import { describe, expect, it } from 'bun:test';
import { CAP_RUSH_FRANCHISE_ALIGNMENT, type Seed } from '@hoop-rush/data-contracts';
import {
  buildCapRushLeagueSchedule,
  capRushAssignFranchise,
} from '../modes/cap-rush/league-schedule.ts';
import { NBA_LEAGUE_RULES } from './nba.ts';
import { assignLeagueFranchise, buildLeagueSchedule } from './schedule.ts';

const FIELD = CAP_RUSH_FRANCHISE_ALIGNMENT.map((entry) => ({
  teamId: entry.franchiseId,
  displayName: entry.franchiseId,
}));

describe('shared NBA league schedule', () => {
  it('matches the Cap Rush binding for the packaged field', () => {
    for (const seed of ['1111111111111111', '2222222222222222'] as Seed[]) {
      expect(buildLeagueSchedule({ runSeed: seed, field: FIELD, rules: NBA_LEAGUE_RULES })).toEqual(
        buildCapRushLeagueSchedule({ runSeed: seed, field: FIELD }),
      );
      expect(
        assignLeagueFranchise({ runSeed: seed, field: FIELD, rules: NBA_LEAGUE_RULES }),
      ).toEqual(capRushAssignFranchise({ runSeed: seed, field: FIELD }));
    }
  });
});
