import type {
  FullCourtAchievementFacts,
  FullCourtGameLineups,
  FullCourtGamePlayerStats,
  FullCourtPlayerGameStats,
  FullCourtSeasonScore,
} from '@hoop-rush/data-contracts';
import type { FullCourtPlayerLine, FullCourtTeamResult } from './game.ts';
import type { FullCourtGameHealthOutcome } from './health.ts';

function toPlayerGameStats(player: FullCourtPlayerLine): FullCourtPlayerGameStats {
  return {
    playerId: player.playerId,
    started: player.startedGame,
    seconds: player.seconds,
    points: player.points,
    rebounds: player.rebounds.total,
    offRebounds: player.rebounds.offensive,
    defRebounds: player.rebounds.defensive,
    assists: player.assists,
    steals: player.steals,
    blocks: player.blocks,
    turnovers: player.turnovers,
    fouls: player.fouls,
    fgm: player.fieldGoals.made,
    fga: player.fieldGoals.attempted,
    tpm: player.threes.made,
    tpa: player.threes.attempted,
    ftm: player.freeThrows.made,
    fta: player.freeThrows.attempted,
  };
}

function teamPlayerStats(team: FullCourtTeamResult): FullCourtPlayerGameStats[] {
  return team.players
    .filter((player) => player.seconds > 0 || player.points !== 0)
    .map(toPlayerGameStats);
}

export function fullCourtBenchPoints(team: Pick<FullCourtTeamResult, 'players'>): number {
  return team.players.reduce(
    (points, player) => points + (player.startedGame ? 0 : player.points),
    0,
  );
}

export function fullCourtStarterPoints(team: Pick<FullCourtTeamResult, 'players'>): number {
  return team.players.reduce(
    (points, player) => points + (player.startedGame ? player.points : 0),
    0,
  );
}

function benchPlayers(team: FullCourtTeamResult): number {
  return team.players.filter(
    (player) => !player.startedGame && (player.seconds > 0 || player.points !== 0),
  ).length;
}

export interface FullCourtScoreOptions {
  /** True only for a user game where defensive matchups were actually assigned. */
  readonly usedDefensiveMatchups?: boolean;
}

function achievementFactsOf(
  game: Extract<FullCourtGameHealthOutcome, { kind: 'played' }>,
  options: FullCourtScoreOptions,
): FullCourtAchievementFacts | undefined {
  if (game.availability === undefined) return undefined;
  const { home, away } = game.result;
  const injured = (side: 'home' | 'away'): string[] =>
    game.availability?.[side]
      .filter((entry) => !entry.available && entry.reason === 'injury')
      .map((entry) => entry.playerId) ?? [];
  return {
    version: 1,
    possessions: { home: home.box.possessions, away: away.box.possessions },
    overtimePeriods: game.result.overtimePeriods,
    largestDeficit: game.result.largestDeficit ?? { home: 0, away: 0 },
    injuredPlayerIds: { home: injured('home'), away: injured('away') },
    ...(options.usedDefensiveMatchups === true && { usedDefensiveMatchups: true }),
  };
}

export function fullCourtScoreOutcome(
  game: Exclude<FullCourtGameHealthOutcome, { kind: 'rest-conflict' }>,
  retainBenchPoints: boolean,
  lineups?: FullCourtGameLineups,
  retainPlayerStats = false,
  options: FullCourtScoreOptions = {},
): FullCourtSeasonScore['outcome'] {
  if (game.kind === 'forfeit') return { kind: 'forfeit', losingSides: [...game.sides] };
  const { home, away } = game.result;
  const homeBench = fullCourtBenchPoints(home);
  const awayBench = fullCourtBenchPoints(away);
  const homeStarters = fullCourtStarterPoints(home);
  const awayStarters = fullCourtStarterPoints(away);
  const playerStats: FullCourtGamePlayerStats | undefined = retainPlayerStats
    ? {
        home: teamPlayerStats(home),
        away: teamPlayerStats(away),
      }
    : undefined;
  const achievementFacts = achievementFactsOf(game, options);
  return {
    kind: 'played',
    homePoints: home.box.points,
    awayPoints: away.box.points,
    ...(retainBenchPoints && {
      benchPoints: { home: homeBench, away: awayBench },
      benchPlayers: { home: benchPlayers(home), away: benchPlayers(away) },
      ...((homeStarters < 0 || awayStarters < 0 || homeBench < 0 || awayBench < 0) && {
        starterPoints: { home: homeStarters, away: awayStarters },
      }),
    }),
    ...(lineups !== undefined && { lineups }),
    ...(playerStats !== undefined && { playerStats }),
    ...(achievementFacts !== undefined && { achievementFacts }),
  };
}
