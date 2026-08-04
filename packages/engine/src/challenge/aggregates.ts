import type {
  GameResult,
  PlayerSeasonAggregate,
  RunAggregates,
  SimulationPlayer,
  TeamAggregate,
} from '@hoop-rush/data-contracts';

/**
 * Exact season aggregates (spec/03 outputs). Totals accumulate incrementally
 * from accepted game results; per-game values are always derived for display
 * from the actual number of games played, never stored separately.
 */

function zeroMadeAttempted() {
  return { made: 0, attempted: 0 };
}

function zeroRebounds() {
  return { total: 0, offensive: 0, defensive: 0 };
}

function zeroTeamRebounds() {
  return { total: 0, offensive: 0, defensive: 0, team: 0 };
}

function zeroPlayerAggregate(playerId: string): PlayerSeasonAggregate {
  return {
    playerId,
    gamesPlayed: 0,
    minutes: 0,
    points: 0,
    fieldGoals: zeroMadeAttempted(),
    threes: zeroMadeAttempted(),
    freeThrows: zeroMadeAttempted(),
    rebounds: zeroRebounds(),
    assists: 0,
    steals: 0,
    blocks: 0,
    turnovers: 0,
    fouls: 0,
  };
}

function zeroTeamAggregate(): TeamAggregate {
  return {
    wins: 0,
    losses: 0,
    gamesPlayed: 0,
    points: 0,
    fieldGoals: zeroMadeAttempted(),
    threes: zeroMadeAttempted(),
    freeThrows: zeroMadeAttempted(),
    rebounds: zeroTeamRebounds(),
    assists: 0,
    steals: 0,
    blocks: 0,
    turnovers: 0,
    fouls: 0,
    possessions: 0,
  };
}

/** Fresh zeroed aggregates for the run's five snapshots, in slot order. */
export function zeroRunAggregates(players: readonly SimulationPlayer[]): RunAggregates {
  return {
    team: zeroTeamAggregate(),
    players: players.map((p) => zeroPlayerAggregate(p.playerId)),
  };
}

/** Adds one accepted game result (user team = home side) to the aggregates. */
export function addGameToAggregates(aggregates: RunAggregates, result: GameResult): RunAggregates {
  const team = result.home.box;
  const boxByPlayerId = new Map(result.home.players.map((player) => [player.playerId, player]));
  const won = result.winner === 'home';

  const nextTeam: TeamAggregate = {
    wins: aggregates.team.wins + (won ? 1 : 0),
    losses: aggregates.team.losses + (won ? 0 : 1),
    gamesPlayed: aggregates.team.gamesPlayed + 1,
    points: aggregates.team.points + team.points,
    fieldGoals: addMa(aggregates.team.fieldGoals, team.fieldGoals),
    threes: addMa(aggregates.team.threes, team.threes),
    freeThrows: addMa(aggregates.team.freeThrows, team.freeThrows),
    rebounds: {
      total: aggregates.team.rebounds.total + team.rebounds.total,
      offensive: aggregates.team.rebounds.offensive + team.rebounds.offensive,
      defensive: aggregates.team.rebounds.defensive + team.rebounds.defensive,
      team: aggregates.team.rebounds.team + team.rebounds.team,
    },
    assists: aggregates.team.assists + team.assists,
    steals: aggregates.team.steals + team.steals,
    blocks: aggregates.team.blocks + team.blocks,
    turnovers: aggregates.team.turnovers + team.turnovers,
    fouls: aggregates.team.fouls + team.fouls,
    possessions: aggregates.team.possessions + team.possessions,
  };

  const nextPlayers = aggregates.players.map((aggregate) => {
    const box = boxByPlayerId.get(aggregate.playerId);
    if (!box) return aggregate;
    return {
      playerId: aggregate.playerId,
      gamesPlayed: aggregate.gamesPlayed + 1,
      minutes: aggregate.minutes + box.minutes,
      points: aggregate.points + box.points,
      fieldGoals: addMa(aggregate.fieldGoals, box.fieldGoals),
      threes: addMa(aggregate.threes, box.threes),
      freeThrows: addMa(aggregate.freeThrows, box.freeThrows),
      rebounds: {
        total: aggregate.rebounds.total + box.rebounds.total,
        offensive: aggregate.rebounds.offensive + box.rebounds.offensive,
        defensive: aggregate.rebounds.defensive + box.rebounds.defensive,
      },
      assists: aggregate.assists + box.assists,
      steals: aggregate.steals + box.steals,
      blocks: aggregate.blocks + box.blocks,
      turnovers: aggregate.turnovers + box.turnovers,
      fouls: aggregate.fouls + box.fouls,
    };
  });

  return { team: nextTeam, players: nextPlayers };
}

function addMa(
  left: { made: number; attempted: number },
  right: { made: number; attempted: number },
): { made: number; attempted: number } {
  return { made: left.made + right.made, attempted: left.attempted + right.attempted };
}

/** Per-game values for display; gamesPlayed is the actual number of games played. */
export function perGamePlayer(aggregate: PlayerSeasonAggregate): PlayerSeasonAggregate {
  const games = Math.max(1, aggregate.gamesPlayed);
  return {
    playerId: aggregate.playerId,
    gamesPlayed: aggregate.gamesPlayed,
    minutes: round(aggregate.minutes / games),
    points: round(aggregate.points / games),
    fieldGoals: {
      made: round(aggregate.fieldGoals.made / games),
      attempted: round(aggregate.fieldGoals.attempted / games),
    },
    threes: {
      made: round(aggregate.threes.made / games),
      attempted: round(aggregate.threes.attempted / games),
    },
    freeThrows: {
      made: round(aggregate.freeThrows.made / games),
      attempted: round(aggregate.freeThrows.attempted / games),
    },
    rebounds: {
      total: round(aggregate.rebounds.total / games),
      offensive: round(aggregate.rebounds.offensive / games),
      defensive: round(aggregate.rebounds.defensive / games),
    },
    assists: round(aggregate.assists / games),
    steals: round(aggregate.steals / games),
    blocks: round(aggregate.blocks / games),
    turnovers: round(aggregate.turnovers / games),
    fouls: round(aggregate.fouls / games),
  };
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}
