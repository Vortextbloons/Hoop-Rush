import type {
  CapRushLeagueResult,
  EraSimulationProfile,
  GameResult,
  LeaguePlayerTotals,
  LeagueRecord,
  LeagueTeamRecord,
  OpponentBracketCore,
  Seed,
  SimulationPlayer,
  TeamResult,
} from '@hoop-rush/data-contracts';
import {
  LEAGUE_RECORD_VERSION,
  LEAGUE_SCHEDULE_VERSION,
  leagueRecordDigest,
  leagueRecordSchema,
} from '@hoop-rush/data-contracts';
import type { EngineContext } from '../../sim/kernel.ts';
import { simulateGame } from '../../sim/game.ts';
import { checkGameResult } from '../../sim/invariants.ts';
import { deriveLeagueGameSeed } from '../../challenge/seeds.ts';
import { leagueQuotas, planLeagueSchedule } from '../../challenge/league.ts';
import {
  accumulateLeagueAppearance,
  emptyLeaguePlayerTotals,
} from '../../challenge/league-value.ts';

const LEAGUE_GAME_NUMBER_CYCLE = 82;

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

function simulationTeamOf(
  bracket: OpponentBracketCore,
  teamIndex: number,
): { teamId: string; displayName: string; players: SimulationPlayer[] } {
  const opponent = bracket.opponents[teamIndex];
  if (!opponent) throw new Error(`cap rush league: missing opponent ${String(teamIndex)}`);
  return {
    teamId: opponent.teamId,
    displayName: opponent.displayName,
    players: opponent.players,
  };
}

export function createCapRushLeagueSimulation(
  input: CapRushLeagueSimulationInput,
  context: EngineContext,
): CapRushLeagueSimulation {
  const plan = planLeagueSchedule(input.bracket);
  const totalsByKey = new Map<string, LeaguePlayerTotals>();
  const teamRecords: LeagueTeamRecord[] = input.bracket.opponents.map((opponent) => ({
    teamId: opponent.teamId,
    gamesPlayed: 0,
    wins: 0,
    losses: 0,
  }));
  const pointsByTeam = new Map<
    string,
    { teamId: string; pointsFor: number; pointsAgainst: number }
  >(
    input.bracket.opponents.map((opponent) => [
      opponent.teamId,
      { teamId: opponent.teamId, pointsFor: 0, pointsAgainst: 0 },
    ]),
  );
  const keyOf = (teamIndex: number, playerId: string): string => `${String(teamIndex)}:${playerId}`;
  for (const [teamIndex, opponent] of input.bracket.opponents.entries()) {
    for (const player of opponent.players) {
      totalsByKey.set(
        keyOf(teamIndex, player.playerId),
        emptyLeaguePlayerTotals(opponent.teamId, player.playerId),
      );
    }
  }
  const foldSide = (teamIndex: number, side: TeamResult, won: boolean): void => {
    for (const box of side.players) {
      const totals = totalsByKey.get(keyOf(teamIndex, box.playerId));
      if (!totals) {
        throw new Error(
          `cap rush league: missing totals for ${box.playerId} on team ${String(teamIndex)}`,
        );
      }
      accumulateLeagueAppearance(totals, box, won);
    }
    const record = teamRecords[teamIndex];
    if (record === undefined) {
      throw new Error(`cap rush league: missing team record ${String(teamIndex)}`);
    }
    record.gamesPlayed += 1;
    if (won) {
      record.wins += 1;
    } else {
      record.losses += 1;
    }
  };
  let done = 0;
  return {
    gamesTotal: plan.length,
    get gamesDone(): number {
      return done;
    },
    advance(count: number): void {
      const until = Math.min(plan.length, done + Math.max(0, Math.floor(count)));
      for (let index = done; index < until; index += 1) {
        const game = plan[index];
        if (!game) throw new Error(`cap rush league: missing planned game ${String(index)}`);
        const home = simulationTeamOf(input.bracket, game.homeTeamIndex);
        const away = simulationTeamOf(input.bracket, game.awayTeamIndex);
        const result: GameResult = simulateGame(
          {
            schemaVersion: 2,
            seed: deriveLeagueGameSeed(input.seed, game.gameIndex),
            gameNumber: (game.gameIndex % LEAGUE_GAME_NUMBER_CYCLE) + 1,
            dataVersion: input.profile.dataVersion,
            profile: input.profile,
            home,
            away,
          },
          context,
        );
        const failures = checkGameResult(result);
        if (failures.length > 0) {
          throw new Error(
            `cap rush league: game ${String(game.gameIndex)} failed accounting: ${failures.join('; ')}`,
          );
        }
        const homeWon = result.winner === 'home';
        foldSide(game.homeTeamIndex, result.home, homeWon);
        foldSide(game.awayTeamIndex, result.away, !homeWon);
        const homePoints = pointsByTeam.get(home.teamId);
        const awayPoints = pointsByTeam.get(away.teamId);
        if (homePoints === undefined || awayPoints === undefined) {
          throw new Error('cap rush league: missing team points');
        }
        homePoints.pointsFor += result.home.box.points;
        homePoints.pointsAgainst += result.away.box.points;
        awayPoints.pointsFor += result.away.box.points;
        awayPoints.pointsAgainst += result.home.box.points;
        done = index + 1;
      }
    },
    finish(): CapRushLeagueResult {
      if (done !== plan.length) {
        throw new Error(
          `cap rush league: simulation is incomplete (${String(done)}/${String(plan.length)})`,
        );
      }
      const quotas = leagueQuotas(input.bracket);
      for (const [index, record] of teamRecords.entries()) {
        if (record.gamesPlayed !== quotas[index]) {
          throw new Error(
            `cap rush league: ${record.teamId} played ${String(record.gamesPlayed)} of ${String(quotas[index])} remaining games`,
          );
        }
      }
      const material: Omit<LeagueRecord, 'digest'> = {
        leagueVersion: LEAGUE_RECORD_VERSION,
        scheduleVersion: LEAGUE_SCHEDULE_VERSION,
        seed: input.seed,
        bracketVersion: input.bracket.bracketVersion,
        dataVersion: input.profile.dataVersion,
        eraProfileVersion: input.profile.profileVersion,
        gamesSimulated: plan.length,
        teams: teamRecords,
        players: [...totalsByKey.values()],
      };
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
