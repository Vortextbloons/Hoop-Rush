import type {
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
  franchiseIdSchema,
  leagueRecordDigest,
  leagueRecordSchema,
} from '@hoop-rush/data-contracts';
import type { EngineContext } from '../sim/kernel.ts';
import { simulateGame } from '../sim/game.ts';
import { accumulateLeagueAppearance, emptyLeaguePlayerTotals } from './league-value.ts';
import { deriveLeagueGameSeed } from './seeds.ts';

export const LEAGUE_GAMES_PER_TEAM = 82;
const LEAGUE_GAME_NUMBER_CYCLE = 82;

export interface LeagueGamePlan {
  gameIndex: number;
  homeTeamIndex: number;
  awayTeamIndex: number;
}

export function leagueUserGameCounts(bracket: OpponentBracketCore): number[] {
  const indexByOpponentId = new Map(
    bracket.opponents.map((opponent, index) => [opponent.opponentId, index]),
  );
  const counts = bracket.opponents.map(() => 0);
  for (const entry of bracket.schedule) {
    const index = indexByOpponentId.get(entry.opponentId);
    if (index === undefined) {
      throw new Error(`league: schedule references unknown opponent ${entry.opponentId}`);
    }
    counts[index] = (counts[index] ?? 0) + 1;
  }
  return counts;
}

export function leagueQuotas(bracket: OpponentBracketCore): number[] {
  return leagueUserGameCounts(bracket).map((count) => LEAGUE_GAMES_PER_TEAM - count);
}

export function leagueGamesSimulated(bracket: OpponentBracketCore): number {
  const total = leagueQuotas(bracket).reduce((sum, quota) => sum + quota, 0);
  if (total % 2 !== 0) {
    throw new Error(
      `league: opponent game quotas must sum to an even number (got ${String(total)})`,
    );
  }
  return total / 2;
}

function circlePairs(teamCount: number, round: number): Array<[number, number]> {
  const ring = teamCount - 1;
  const pairs: Array<[number, number]> = [];
  const teamAt = (slot: number): number => (slot === 0 ? 0 : 1 + ((slot - 1 + round) % ring));
  for (let i = 0; i < teamCount / 2; i += 1) {
    pairs.push([teamAt(i), teamAt(teamCount - 1 - i)]);
  }
  return pairs;
}

export function planLeagueSchedule(bracket: OpponentBracketCore): LeagueGamePlan[] {
  const teamCount = bracket.opponents.length;
  const quotas = leagueQuotas(bracket);
  const remaining = [...quotas];
  const games: LeagueGamePlan[] = [];
  const accept = (first: number, second: number): void => {
    const firstRemaining = remaining[first];
    const secondRemaining = remaining[second];
    if (firstRemaining === undefined || secondRemaining === undefined) {
      throw new Error('league: schedule pairing references an unknown team');
    }
    remaining[first] = firstRemaining - 1;
    remaining[second] = secondRemaining - 1;
    const swap = games.length % 2 === 1;
    games.push({
      gameIndex: games.length,
      homeTeamIndex: swap ? second : first,
      awayTeamIndex: swap ? first : second,
    });
  };
  for (let round = 0; round < LEAGUE_GAMES_PER_TEAM; round += 1) {
    for (const [first, second] of circlePairs(teamCount, round)) {
      if ((remaining[first] ?? 0) > 0 && (remaining[second] ?? 0) > 0) accept(first, second);
    }
  }
  for (;;) {
    const order = quotas
      .map((_, index) => index)
      .sort((a, b) => (remaining[b] ?? 0) - (remaining[a] ?? 0) || a - b);
    const first = order[0];
    const second = order[1];
    if (first === undefined || second === undefined) break;
    if ((remaining[first] ?? 0) <= 0 || (remaining[second] ?? 0) <= 0) break;
    accept(first, second);
  }
  const failures = validateLeagueSchedule(games, bracket);
  if (failures.length > 0) {
    throw new Error(`league: schedule plan is invalid: ${failures.join('; ')}`);
  }
  return games;
}

export function validateLeagueSchedule(
  plan: readonly LeagueGamePlan[],
  bracket: OpponentBracketCore,
): string[] {
  const failures: string[] = [];
  const quotas = leagueQuotas(bracket);
  const counts = quotas.map(() => 0);
  const expectedGames = leagueGamesSimulated(bracket);
  if (plan.length !== expectedGames) {
    failures.push(`plan must contain ${String(expectedGames)} games (got ${String(plan.length)})`);
  }
  for (const [index, game] of plan.entries()) {
    if (game.gameIndex !== index)
      failures.push(`plan game ${String(index)} has mismatched gameIndex`);
    const { homeTeamIndex, awayTeamIndex } = game;
    if (homeTeamIndex === awayTeamIndex) {
      failures.push(`plan game ${String(index)} pairs a team with itself`);
      continue;
    }
    if (
      homeTeamIndex < 0 ||
      homeTeamIndex >= counts.length ||
      awayTeamIndex < 0 ||
      awayTeamIndex >= counts.length
    ) {
      failures.push(
        `plan game ${String(index)} references a team outside 0..${String(counts.length - 1)}`,
      );
      continue;
    }
    counts[homeTeamIndex] = (counts[homeTeamIndex] ?? 0) + 1;
    counts[awayTeamIndex] = (counts[awayTeamIndex] ?? 0) + 1;
  }
  for (let index = 0; index < quotas.length; index += 1) {
    if (counts[index] !== quotas[index]) {
      failures.push(
        `opponent ${String(index)} must play ${String(quotas[index])} league games (got ${String(counts[index])})`,
      );
    }
  }
  return failures;
}

export interface LeagueSimulation {
  readonly gamesTotal: number;
  readonly gamesDone: number;
  advance(count: number): void;
  finish(): LeagueRecord;
}

export interface LeagueSimulationInput {
  seed: Seed;
  bracket: OpponentBracketCore;
  profile: EraSimulationProfile;
}

function teamSimulationOf(
  bracket: OpponentBracketCore,
  teamIndex: number,
): { teamId: string; displayName: string; players: SimulationPlayer[] } {
  const opponent = bracket.opponents[teamIndex];
  if (!opponent) throw new Error(`league: missing opponent ${String(teamIndex)}`);
  return { teamId: opponent.teamId, displayName: opponent.displayName, players: opponent.players };
}

export function createLeagueSimulation(
  input: LeagueSimulationInput,
  context: EngineContext,
): LeagueSimulation {
  const plan = planLeagueSchedule(input.bracket);
  const totalsByKey = new Map<string, LeaguePlayerTotals>();
  const teamRecords: LeagueTeamRecord[] = input.bracket.opponents.map((opponent) => ({
    teamId: franchiseIdSchema.parse(opponent.teamId),
    gamesPlayed: 0,
    wins: 0,
    losses: 0,
  }));
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
        throw new Error(`league: missing totals for ${box.playerId} on team ${String(teamIndex)}`);
      }
      accumulateLeagueAppearance(totals, box, won);
    }
    const record = teamRecords[teamIndex];
    if (record === undefined) throw new Error(`league: missing team record ${String(teamIndex)}`);
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
        if (!game) throw new Error(`league: missing planned game ${String(index)}`);
        const home = teamSimulationOf(input.bracket, game.homeTeamIndex);
        const away = teamSimulationOf(input.bracket, game.awayTeamIndex);
        const result: GameResult = simulateGame(
          {
            schemaVersion: 2,
            seed: deriveLeagueGameSeed(input.seed, game.gameIndex),
            gameNumber: (game.gameIndex % LEAGUE_GAME_NUMBER_CYCLE) + 1,
            dataVersion: input.profile.dataVersion,
            profile: input.profile,
            home: { teamId: home.teamId, displayName: home.displayName, players: home.players },
            away: { teamId: away.teamId, displayName: away.displayName, players: away.players },
          },
          context,
        );
        const homeWon = result.winner === 'home';
        foldSide(game.homeTeamIndex, result.home, homeWon);
        foldSide(game.awayTeamIndex, result.away, !homeWon);
        done = index + 1;
      }
    },
    finish(): LeagueRecord {
      if (done !== plan.length) {
        throw new Error(
          `league: simulation is incomplete (${String(done)}/${String(plan.length)})`,
        );
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
      return leagueRecordSchema.parse({ ...material, digest: leagueRecordDigest(material) });
    },
  };
}

export function simulateLeague(input: LeagueSimulationInput, context: EngineContext): LeagueRecord {
  const simulation = createLeagueSimulation(input, context);
  simulation.advance(simulation.gamesTotal);
  return simulation.finish();
}
