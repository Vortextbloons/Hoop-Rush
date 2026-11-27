import type { FullCourtGameLineups, FullCourtSeasonScore } from '@hoop-rush/data-contracts';
import type { FullCourtTeamResult } from './game.ts';
import type { FullCourtGameHealthOutcome } from './health.ts';

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

export function fullCourtScoreOutcome(
  game: Exclude<FullCourtGameHealthOutcome, { kind: 'rest-conflict' }>,
  retainBenchPoints: boolean,
  lineups?: FullCourtGameLineups,
): FullCourtSeasonScore['outcome'] {
  if (game.kind === 'forfeit') return { kind: 'forfeit', losingSides: [...game.sides] };
  const { home, away } = game.result;
  const homeBonus = home.teamBonusPoints ?? 0;
  const awayBonus = away.teamBonusPoints ?? 0;
  const homeBench = fullCourtBenchPoints(home);
  const awayBench = fullCourtBenchPoints(away);
  const homeStarters = fullCourtStarterPoints(home);
  const awayStarters = fullCourtStarterPoints(away);
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
      ...((homeBonus !== 0 || awayBonus !== 0) && {
        teamBonusPoints: { home: homeBonus, away: awayBonus },
      }),
    }),
    ...(lineups !== undefined && { lineups }),
  };
}
