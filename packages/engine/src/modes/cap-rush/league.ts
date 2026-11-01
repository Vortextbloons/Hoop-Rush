import type {
  CapRushLeagueResult,
  EraSimulationProfile,
  OpponentBracketCore,
  Seed,
} from '@hoop-rush/data-contracts';
import { leagueRecordDigest, leagueRecordSchema } from '@hoop-rush/data-contracts';
import type { EngineContext } from '../../sim/kernel.ts';
import { createLeagueSimulationCore, leagueQuotas } from '../../challenge/league.ts';

export interface CapRushLeagueSimulation {
  readonly gamesTotal: number;
  readonly gamesDone: number;
  advance(count: number): void;
  finish(): CapRushLeagueResult;
}

export interface CapRushLeagueSimulationInput {
  readonly seed: Seed;
  readonly bracket: OpponentBracketCore;
  readonly profile: EraSimulationProfile;
}

export function createCapRushLeagueSimulation(
  input: CapRushLeagueSimulationInput,
  context: EngineContext,
): CapRushLeagueSimulation {
  const pointsByTeam = new Map<
    string,
    { teamId: string; pointsFor: number; pointsAgainst: number }
  >(
    input.bracket.opponents.map((opponent) => [
      opponent.teamId,
      { teamId: opponent.teamId, pointsFor: 0, pointsAgainst: 0 },
    ]),
  );
  const core = createLeagueSimulationCore(
    {
      seed: input.seed,
      bracket: input.bracket,
      profile: input.profile,
      errorLabel: 'cap rush league',
      checkResult: true,
      onGame: ({ result, home, away }) => {
        const homePoints = pointsByTeam.get(home.teamId);
        const awayPoints = pointsByTeam.get(away.teamId);
        if (homePoints === undefined || awayPoints === undefined) {
          throw new Error('cap rush league: missing team points');
        }
        homePoints.pointsFor += result.home.box.points;
        homePoints.pointsAgainst += result.away.box.points;
        awayPoints.pointsFor += result.away.box.points;
        awayPoints.pointsAgainst += result.home.box.points;
      },
    },
    context,
  );
  return {
    gamesTotal: core.gamesTotal,
    get gamesDone(): number {
      return core.gamesDone;
    },
    advance(count: number): void {
      core.advance(count);
    },
    finish(): CapRushLeagueResult {
      core.assertComplete();
      const quotas = leagueQuotas(input.bracket);
      for (const [index, record] of core.teamRecords.entries()) {
        if (record.gamesPlayed !== quotas[index]) {
          throw new Error(
            `cap rush league: ${record.teamId} played ${String(record.gamesPlayed)} of ${String(quotas[index])} remaining games`,
          );
        }
      }
      const material = core.material();
      return {
        league: leagueRecordSchema.parse({
          ...material,
          digest: leagueRecordDigest(material),
        }),
        points: [...pointsByTeam.values()],
      };
    },
  };
}
