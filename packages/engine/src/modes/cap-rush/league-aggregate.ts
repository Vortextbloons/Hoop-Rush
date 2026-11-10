import type {
  CapRushLeagueAggregate,
  CapRushLeagueGame,
  CapRushLeagueTeamAggregate,
  CapRushTeamBox,
  LeaguePlayerTotals,
  PlayerBoxScore,
} from '@hoop-rush/data-contracts';
import {
  CAP_RUSH_LEAGUE_AGGREGATE_VERSION,
  capRushLeagueAggregateSchema,
  playerIdSchema,
} from '@hoop-rush/data-contracts';
import {
  accumulateLeagueAppearance,
  emptyLeaguePlayerTotals,
} from '../../challenge/league-value.ts';

/** League-value totals plus the display name the aggregate row carries. */
interface PlayerAccumulator extends LeaguePlayerTotals {
  displayName: string;
}

export function capRushEmptyLeagueAggregate(): CapRushLeagueAggregate {
  return {
    version: CAP_RUSH_LEAGUE_AGGREGATE_VERSION,
    games: 0,
    gameIds: [],
    teams: [],
    players: [],
  };
}

/** Player totals keyed exactly as the report's MVP fold keys them. */
export function capRushLeaguePlayerKey(teamId: string, playerId: string): string {
  return `${teamId}:${playerId}`;
}

function boxOfPartner(box: CapRushTeamBox, participantIndex: number): PlayerBoxScore | null {
  const line = box.participants[participantIndex];
  if (line === undefined) return null;
  return {
    playerId: playerIdSchema.parse(line.playerId),
    minutes: line.minutes,
    points: line.points,
    fieldGoals: { made: line.fieldGoalsMade, attempted: line.fieldGoalsAttempted },
    threes: { made: line.threesMade, attempted: line.threesAttempted },
    freeThrows: { made: line.freeThrowsMade, attempted: line.freeThrowsAttempted },
    rebounds: {
      total: line.rebounds,
      offensive: line.offensiveRebounds,
      defensive: line.defensiveRebounds,
    },
    assists: line.assists,
    steals: line.steals,
    blocks: line.blocks,
    turnovers: line.turnovers,
    fouls: line.fouls,
  };
}

/**
 * Fold freshly committed league games into the running compact aggregate.
 *
 * Callers pass only games whose ids are not yet in `gameIds`, which keeps the
 * fold idempotent across retried or resumed commits. Participants accumulate in
 * the same order the full box-score fold uses, so the MVP and baseline come out
 * identical without loading any stored box.
 */
export function capRushFoldLeagueAggregate(
  aggregate: CapRushLeagueAggregate,
  games: readonly CapRushLeagueGame[],
): CapRushLeagueAggregate {
  if (games.length === 0) return aggregate;
  const teams = new Map<string, CapRushLeagueTeamAggregate>(
    aggregate.teams.map((team) => [team.teamId, { ...team }]),
  );
  const players = new Map<string, PlayerAccumulator>(
    aggregate.players.map((player) => [
      capRushLeaguePlayerKey(player.teamId, player.playerId),
      {
        ...emptyLeaguePlayerTotals(player.teamId, player.playerId),
        displayName: player.displayName,
        games: player.games,
        totalValueBase: player.totalValueBase,
        totalValueBaseSquared: player.totalValueBaseSquared,
        totalShots: player.totalShots,
        totalShotsSquared: player.totalShotsSquared,
        totalValueShots: player.totalValueShots,
        totalPoints: player.totalPoints,
        totalRebounds: player.totalRebounds,
        totalAssists: player.totalAssists,
        totalSteals: player.totalSteals,
        totalBlocks: player.totalBlocks,
        totalGameScore: player.totalGameScore,
        totalTrueShooting: player.totalTrueShooting,
      },
    ]),
  );
  const gameIds = [...aggregate.gameIds];
  const seen = new Set(gameIds);
  let added = 0;

  const foldTeam = (teamId: string, displayName: string, forPoints: number, against: number) => {
    const existing = teams.get(teamId) ?? {
      teamId,
      displayName,
      wins: 0,
      losses: 0,
      pointsFor: 0,
      pointsAgainst: 0,
    };
    const won = forPoints > against;
    teams.set(teamId, {
      ...existing,
      displayName,
      wins: existing.wins + (won ? 1 : 0),
      losses: existing.losses + (won ? 0 : 1),
      pointsFor: existing.pointsFor + forPoints,
      pointsAgainst: existing.pointsAgainst + against,
    });
  };

  for (const game of games) {
    if (seen.has(game.gameId)) continue;
    seen.add(game.gameId);
    gameIds.push(game.gameId);
    added += 1;
    foldTeam(game.box.home.teamId, game.box.home.displayName, game.homePoints, game.awayPoints);
    foldTeam(game.box.away.teamId, game.box.away.displayName, game.awayPoints, game.homePoints);
    for (const side of ['home', 'away'] as const) {
      const box = game.box[side];
      const won =
        side === 'home' ? game.homePoints > game.awayPoints : game.awayPoints > game.homePoints;
      for (let index = 0; index < box.participants.length; index += 1) {
        const line = box.participants[index];
        const partnerBox = boxOfPartner(box, index);
        if (line === undefined || partnerBox === null) continue;
        const key = capRushLeaguePlayerKey(box.teamId, line.playerId);
        const totals = players.get(key) ?? {
          ...emptyLeaguePlayerTotals(box.teamId, line.playerId),
          displayName: line.displayName,
        };
        totals.displayName = line.displayName;
        accumulateLeagueAppearance(totals, partnerBox, won);
        players.set(key, totals);
      }
    }
  }

  if (added === 0) return aggregate;
  return capRushLeagueAggregateSchema.parse({
    version: CAP_RUSH_LEAGUE_AGGREGATE_VERSION,
    games: aggregate.games + added,
    gameIds,
    teams: [...teams.values()],
    players: [...players.values()],
  });
}
