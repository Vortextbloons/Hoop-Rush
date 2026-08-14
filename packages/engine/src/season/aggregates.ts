import {
  SEASON_LEADER_DEPTH,
  SEASON_LEADER_MIN_GAME_SHARE,
  SEASON_LEADERS_VERSION,
  type SeasonGameSummary,
  type SeasonLeaderCategory,
  type SeasonLeaderEntry,
  type SeasonLeaders,
  type SeasonPlayerAggregate,
  type SeasonStandings,
  type SeasonTeamAggregate,
} from '@hoop-rush/data-contracts';

const ZERO_TEAM: Omit<SeasonTeamAggregate, 'franchiseId' | 'gamesPlayed' | 'wins' | 'losses'> = {
  points: 0,
  fieldGoalsMade: 0,
  fieldGoalsAttempted: 0,
  threePointersMade: 0,
  threePointersAttempted: 0,
  freeThrowsMade: 0,
  freeThrowsAttempted: 0,
  offensiveRebounds: 0,
  defensiveRebounds: 0,
  assists: 0,
  steals: 0,
  blocks: 0,
  turnovers: 0,
  fouls: 0,
  possessions: 0,
};

const ZERO_PLAYER: Omit<SeasonPlayerAggregate, 'playerVersionId' | 'franchiseId'> = {
  gamesPlayed: 0,
  appearances: 0,
  started: 0,
  seconds: 0,
  points: 0,
  fieldGoalsMade: 0,
  fieldGoalsAttempted: 0,
  threePointersMade: 0,
  threePointersAttempted: 0,
  freeThrowsMade: 0,
  freeThrowsAttempted: 0,
  offensiveRebounds: 0,
  defensiveRebounds: 0,
  assists: 0,
  steals: 0,
  blocks: 0,
  turnovers: 0,
  fouls: 0,
};

function winnerOf(summary: SeasonGameSummary): string {
  if (summary.status === 'forfeit') {
    const loser = summary.forfeitLoserFranchiseId;
    if (loser === null) {
      throw new Error(`forfeit summary ${summary.gameId} does not name the losing team`);
    }
    return loser === summary.homeFranchiseId ? summary.awayFranchiseId : summary.homeFranchiseId;
  }
  return summary.homeScore > summary.awayScore ? summary.homeFranchiseId : summary.awayFranchiseId;
}

export function foldSeasonTeamAggregates(
  summaries: readonly SeasonGameSummary[],
): SeasonTeamAggregate[] {
  const rows = new Map<string, SeasonTeamAggregate>();
  for (const summary of summaries) {
    for (const side of ['home', 'away'] as const) {
      const franchiseId = summary[`${side}FranchiseId`];
      let row = rows.get(franchiseId);
      if (row === undefined) {
        row = { franchiseId, gamesPlayed: 0, wins: 0, losses: 0, ...ZERO_TEAM };
        rows.set(franchiseId, row);
      }
      const box = side === 'home' ? summary.homeBox : summary.awayBox;
      row.gamesPlayed += 1;
      row.points += box.points;
      row.fieldGoalsMade += box.fieldGoalsMade;
      row.fieldGoalsAttempted += box.fieldGoalsAttempted;
      row.threePointersMade += box.threePointersMade;
      row.threePointersAttempted += box.threePointersAttempted;
      row.freeThrowsMade += box.freeThrowsMade;
      row.freeThrowsAttempted += box.freeThrowsAttempted;
      row.offensiveRebounds += box.offensiveRebounds;
      row.defensiveRebounds += box.defensiveRebounds;
      row.assists += box.assists;
      row.steals += box.steals;
      row.blocks += box.blocks;
      row.turnovers += box.turnovers;
      row.fouls += box.fouls;
      row.possessions += box.possessions;
      if (winnerOf(summary) === franchiseId) row.wins += 1;
      else row.losses += 1;
    }
  }
  return [...rows.values()].sort((a, b) => (a.franchiseId < b.franchiseId ? -1 : 1));
}

export function foldSeasonPlayerAggregates(
  summaries: readonly SeasonGameSummary[],
): SeasonPlayerAggregate[] {
  const rows = new Map<string, SeasonPlayerAggregate>();
  for (const summary of summaries) {
    if (summary.status === 'forfeit') continue;
    for (const side of ['home', 'away'] as const) {
      const box = side === 'home' ? summary.homeBox : summary.awayBox;
      const lines = side === 'home' ? summary.homePlayers : summary.awayPlayers;
      for (const line of lines) {
        let row = rows.get(line.playerVersionId);
        if (row === undefined) {
          row = {
            playerVersionId: line.playerVersionId,
            franchiseId: box.franchiseId,
            ...ZERO_PLAYER,
          };
          rows.set(line.playerVersionId, row);
        }
        row.gamesPlayed += 1;
        row.appearances += line.seconds > 0 ? 1 : 0;
        row.started += line.started === true ? 1 : 0;
        row.seconds += line.seconds;
        row.points += line.points;
        row.fieldGoalsMade += line.fieldGoalsMade;
        row.fieldGoalsAttempted += line.fieldGoalsAttempted;
        row.threePointersMade += line.threePointersMade;
        row.threePointersAttempted += line.threePointersAttempted;
        row.freeThrowsMade += line.freeThrowsMade;
        row.freeThrowsAttempted += line.freeThrowsAttempted;
        row.offensiveRebounds += line.offensiveRebounds;
        row.defensiveRebounds += line.defensiveRebounds;
        row.assists += line.assists;
        row.steals += line.steals;
        row.blocks += line.blocks;
        row.turnovers += line.turnovers;
        row.fouls += line.fouls;
      }
    }
  }
  return [...rows.values()].sort((a, b) =>
    a.playerVersionId < b.playerVersionId ? -1 : a.playerVersionId > b.playerVersionId ? 1 : 0,
  );
}

export function auditSeasonAggregates(input: {
  teams: readonly SeasonTeamAggregate[];
  players: readonly SeasonPlayerAggregate[];
  summaries: readonly SeasonGameSummary[];
  standings: SeasonStandings;
}): string[] {
  const failures: string[] = [];
  const freshTeams = foldSeasonTeamAggregates(input.summaries);
  const freshPlayers = foldSeasonPlayerAggregates(input.summaries);

  const teamFields: ReadonlyArray<keyof Omit<SeasonTeamAggregate, 'franchiseId'>> = [
    'gamesPlayed',
    'wins',
    'losses',
    'points',
    'fieldGoalsMade',
    'fieldGoalsAttempted',
    'threePointersMade',
    'threePointersAttempted',
    'freeThrowsMade',
    'freeThrowsAttempted',
    'offensiveRebounds',
    'defensiveRebounds',
    'assists',
    'steals',
    'blocks',
    'turnovers',
    'fouls',
    'possessions',
  ];
  const freshTeamMap = new Map(freshTeams.map((row) => [row.franchiseId, row]));
  for (const row of input.teams) {
    const want = freshTeamMap.get(row.franchiseId);
    if (want === undefined) {
      failures.push(`team aggregate ${row.franchiseId} has no matching fold`);
      continue;
    }
    for (const field of teamFields) {
      if (row[field] !== want[field]) {
        failures.push(
          `team ${row.franchiseId} ${field}: stored ${String(row[field])} != fold ${String(want[field])}`,
        );
      }
    }
  }
  const freshTeamIds = new Set(freshTeams.map((row) => row.franchiseId));
  for (const row of input.teams) {
    if (!freshTeamIds.has(row.franchiseId)) {
      failures.push(`stored team aggregate ${row.franchiseId} does not appear in the fold`);
    }
  }

  const playerFields: ReadonlyArray<
    keyof Omit<SeasonPlayerAggregate, 'playerVersionId' | 'franchiseId'>
  > = [
    'gamesPlayed',
    'appearances',
    'started',
    'seconds',
    'points',
    'fieldGoalsMade',
    'fieldGoalsAttempted',
    'threePointersMade',
    'threePointersAttempted',
    'freeThrowsMade',
    'freeThrowsAttempted',
    'offensiveRebounds',
    'defensiveRebounds',
    'assists',
    'steals',
    'blocks',
    'turnovers',
    'fouls',
  ];
  const freshPlayerMap = new Map(freshPlayers.map((row) => [row.playerVersionId, row]));
  for (const row of input.players) {
    const want = freshPlayerMap.get(row.playerVersionId);
    if (want === undefined) {
      failures.push(`player aggregate ${row.playerVersionId} has no matching fold`);
      continue;
    }
    if (row.franchiseId !== want.franchiseId) {
      failures.push(
        `player ${row.playerVersionId} franchise: stored ${row.franchiseId} != fold ${want.franchiseId}`,
      );
    }
    for (const field of playerFields) {
      if (row[field] !== want[field]) {
        failures.push(
          `player ${row.playerVersionId} ${field}: stored ${String(row[field])} != fold ${String(want[field])}`,
        );
      }
    }
  }
  const freshPlayerIds = new Set(freshPlayers.map((row) => row.playerVersionId));
  for (const row of input.players) {
    if (!freshPlayerIds.has(row.playerVersionId)) {
      failures.push(`stored player aggregate ${row.playerVersionId} does not appear in the fold`);
    }
  }
  for (const row of freshPlayers) {
    if (!input.players.some((stored) => stored.playerVersionId === row.playerVersionId)) {
      failures.push(
        `player ${row.playerVersionId} played games but is missing from the stored table`,
      );
    }
  }

  const recordOf = new Map<string, { wins: number; losses: number; gamesPlayed: number }>();
  const pointsFor = new Map<string, number>();
  const pointsAgainst = new Map<string, number>();
  const addGames = (franchiseId: string, wins: number, losses: number): void => {
    const record = recordOf.get(franchiseId) ?? { wins: 0, losses: 0, gamesPlayed: 0 };
    record.wins += wins;
    record.losses += losses;
    record.gamesPlayed += 1;
    recordOf.set(franchiseId, record);
  };
  for (const summary of input.summaries) {
    const homeScore = summary.homeScore;
    const awayScore = summary.awayScore;
    const winner = winnerOf(summary);
    const homeWon = winner === summary.homeFranchiseId;
    addGames(summary.homeFranchiseId, homeWon ? 1 : 0, homeWon ? 0 : 1);
    addGames(summary.awayFranchiseId, homeWon ? 0 : 1, homeWon ? 1 : 0);
    pointsFor.set(
      summary.homeFranchiseId,
      (pointsFor.get(summary.homeFranchiseId) ?? 0) + homeScore,
    );
    pointsFor.set(
      summary.awayFranchiseId,
      (pointsFor.get(summary.awayFranchiseId) ?? 0) + awayScore,
    );
    pointsAgainst.set(
      summary.homeFranchiseId,
      (pointsAgainst.get(summary.homeFranchiseId) ?? 0) + awayScore,
    );
    pointsAgainst.set(
      summary.awayFranchiseId,
      (pointsAgainst.get(summary.awayFranchiseId) ?? 0) + homeScore,
    );
  }
  for (const row of input.standings.rows) {
    const record = recordOf.get(row.franchiseId);
    const expectedPointsFor = pointsFor.get(row.franchiseId) ?? 0;
    const expectedPointsAgainst = pointsAgainst.get(row.franchiseId) ?? 0;
    if (record !== undefined) {
      if (row.wins !== record.wins) {
        failures.push(
          `standings ${row.franchiseId} wins: stored ${String(row.wins)} != summaries ${String(record.wins)}`,
        );
      }
      if (row.losses !== record.losses) {
        failures.push(
          `standings ${row.franchiseId} losses: stored ${String(row.losses)} != summaries ${String(record.losses)}`,
        );
      }
      if (row.gamesPlayed !== record.gamesPlayed) {
        failures.push(
          `standings ${row.franchiseId} gamesPlayed: stored ${String(row.gamesPlayed)} != summaries ${String(record.gamesPlayed)}`,
        );
      }
    } else if (row.wins !== 0 || row.losses !== 0 || row.gamesPlayed !== 0) {
      failures.push(`standings ${row.franchiseId} has games but no matching summary`);
    }
    if (row.pointsFor !== expectedPointsFor) {
      failures.push(
        `standings ${row.franchiseId} pointsFor: stored ${String(row.pointsFor)} != summaries ${String(expectedPointsFor)}`,
      );
    }
    if (row.pointsAgainst !== expectedPointsAgainst) {
      failures.push(
        `standings ${row.franchiseId} pointsAgainst: stored ${String(row.pointsAgainst)} != summaries ${String(expectedPointsAgainst)}`,
      );
    }
  }
  return failures;
}

function categoryValue(player: SeasonPlayerAggregate, category: SeasonLeaderCategory): number {
  switch (category) {
    case 'points':
      return player.points;
    case 'rebounds':
      return player.offensiveRebounds + player.defensiveRebounds;
    case 'assists':
      return player.assists;
    case 'steals':
      return player.steals;
    case 'blocks':
      return player.blocks;
    case 'threePointersMade':
      return player.threePointersMade;
  }
}

export function deriveSeasonLeaders(
  teams: readonly SeasonTeamAggregate[],
  players: readonly SeasonPlayerAggregate[],
): SeasonLeaders {
  const teamGames = new Map(teams.map((team) => [team.franchiseId, team.gamesPlayed]));
  const leaders = (category: SeasonLeaderCategory): SeasonLeaderEntry[] => {
    const eligible = players.filter((player) => {
      const games = teamGames.get(player.franchiseId) ?? 0;
      return player.gamesPlayed >= SEASON_LEADER_MIN_GAME_SHARE * games;
    });
    const rows = eligible
      .map((player) => {
        const value = categoryValue(player, category);
        return {
          playerVersionId: player.playerVersionId,
          franchiseId: player.franchiseId,
          gamesPlayed: player.gamesPlayed,
          value,
          perGame: player.gamesPlayed === 0 ? 0 : value / player.gamesPlayed,
        };
      })
      .sort(
        (a, b) =>
          b.perGame - a.perGame ||
          b.value - a.value ||
          (a.playerVersionId < b.playerVersionId ? -1 : 1),
      )
      .slice(0, SEASON_LEADER_DEPTH);
    return rows;
  };
  return {
    schemaVersion: 1,
    leadersVersion: SEASON_LEADERS_VERSION,
    minimumGameShare: SEASON_LEADER_MIN_GAME_SHARE,
    depth: SEASON_LEADER_DEPTH,
    categories: {
      points: leaders('points'),
      rebounds: leaders('rebounds'),
      assists: leaders('assists'),
      steals: leaders('steals'),
      blocks: leaders('blocks'),
      threePointersMade: leaders('threePointersMade'),
    },
  };
}

export function provisionalStandingOrder(standings: SeasonStandings): string[] {
  return [...standings.rows]
    .sort(
      (a, b) =>
        b.wins - a.wins ||
        b.pointsFor - b.pointsAgainst - (a.pointsFor - a.pointsAgainst) ||
        (a.franchiseId < b.franchiseId ? -1 : 1),
    )
    .map((row) => row.franchiseId);
}
