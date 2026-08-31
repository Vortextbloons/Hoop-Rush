import {
  SEASON_INFLUENCE_CAP,
  SEASON_INFLUENCE_FLOOR,
  SEASON_RECAP_VERSION,
  SEASON_ROSTER_MAX_SIZE,
  SEASON_ROSTER_MIN_SIZE,
  SEASON_ROTATION_SIZE,
  SEASON_ROUND_COUNT,
  blockRoundRange,
  type HoopRushManifest,
  type SeasonBlockInjuryEvidence,
  type SeasonBlockRecap,
  type SeasonCampaignCondition,
  type SeasonCampaignEvaluation,
  type SeasonCampaignOpportunity,
  type SeasonCampaignReward,
  type SeasonCampaignState,
  type SeasonFreeAgencyState,
  type SeasonGame,
  type SeasonGameSummary,
  type SeasonLeaderCategory,
  type SeasonLeague,
  type SeasonNotablePerformance,
  type SeasonPlayerAggregate,
  type SeasonRecordMovement,
  type SeasonRosterEntry,
  type SeasonRun,
  type SeasonStandings,
  type SeasonStandingsRow,
  type SeasonStreak,
  type SeasonTeamAggregate,
  type SeasonTeamBox,
  type SeasonTradeBoardTeamProfile,
  type SeasonTradeNegotiation,
  type SeasonTradeValueTrend,
  type SeasonUpcomingHumanGame,
  type SeasonVersionSpotlight,
} from '@hoop-rush/data-contracts';
import { humanUpcomingGames } from './season-lock-preview';
export function provisionalRanking(
  standings: SeasonStandings,
  league: SeasonLeague,
): {
  row: SeasonStandingsRow;
  rank: number;
  conference: 'east' | 'west';
}[] {
  const conferenceOf = new Map(league.teams.map((team) => [team.franchiseId, team.conference]));
  const rows = [...standings.rows].sort(
    (a, b) =>
      b.wins - a.wins ||
      pointDifferential(b) - pointDifferential(a) ||
      a.franchiseId.localeCompare(b.franchiseId),
  );
  const east: typeof rows = [];
  const west: typeof rows = [];
  for (const row of rows) {
    const conference = conferenceOf.get(row.franchiseId);
    if (conference === 'east') east.push(row);
    else west.push(row);
  }
  return [
    ...east.map((row, index) => ({ row, rank: index + 1, conference: 'east' as const })),
    ...west.map((row, index) => ({ row, rank: index + 1, conference: 'west' as const })),
  ];
}
export function pointDifferential(row: SeasonStandingsRow): number {
  return row.pointsFor - row.pointsAgainst;
}
export function winPct(wins: number, losses: number): number {
  if (wins + losses === 0) return 0;
  return wins / (wins + losses);
}
export function recordLabel(wins: number, losses: number): string {
  return `${String(wins)}–${String(losses)}`;
}
export function streakLabel(kind: 'wins' | 'losses', length: number): string {
  if (length < 2) return '—';
  return kind === 'wins' ? `${String(length)} W` : `${String(length)} L`;
}
export function ordinal(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${String(n)}th`;
  switch (n % 10) {
    case 1:
      return `${String(n)}st`;
    case 2:
      return `${String(n)}nd`;
    case 3:
      return `${String(n)}rd`;
    default:
      return `${String(n)}th`;
  }
}
export function formatClock(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes)}:${String(seconds).padStart(2, '0')}`;
}
function streakOfGames(
  games: readonly SeasonGameSummary[],
  franchiseId: string,
): {
  kind: 'wins' | 'losses';
  length: number;
} | null {
  if (games.length === 0) return null;
  let streak = 0;
  let kind: 'wins' | 'losses' | null = null;
  for (let i = games.length - 1; i >= 0; i -= 1) {
    const game = games[i];
    if (game === undefined) break;
    const won = didWin(game, franchiseId);
    const gameKind = won ? 'wins' : 'losses';
    if (kind === null) {
      kind = gameKind;
      streak = 1;
    } else if (kind === gameKind) {
      streak += 1;
    } else {
      break;
    }
  }
  if (kind === null) return null;
  return { kind, length: streak };
}
export function franchiseStreak(
  summaries: readonly SeasonGameSummary[],
  franchiseId: string,
): {
  kind: 'wins' | 'losses';
  length: number;
} | null {
  const games = summaries
    .filter(
      (summary) =>
        summary.homeFranchiseId === franchiseId || summary.awayFranchiseId === franchiseId,
    )
    .sort((a, b) => a.round - b.round);
  return streakOfGames(games, franchiseId);
}
export function franchiseStreaks(
  summaries: readonly SeasonGameSummary[],
  franchiseIds: readonly string[],
): Map<
  string,
  {
    kind: 'wins' | 'losses';
    length: number;
  } | null
> {
  const gamesByFranchise = new Map<string, SeasonGameSummary[]>();
  for (const summary of summaries) {
    const home = gamesByFranchise.get(summary.homeFranchiseId);
    if (home !== undefined) {
      home.push(summary);
    } else {
      gamesByFranchise.set(summary.homeFranchiseId, [summary]);
    }
    const away = gamesByFranchise.get(summary.awayFranchiseId);
    if (away !== undefined) {
      away.push(summary);
    } else {
      gamesByFranchise.set(summary.awayFranchiseId, [summary]);
    }
  }
  for (const games of gamesByFranchise.values()) {
    games.sort((a, b) => a.round - b.round);
  }
  const result = new Map<
    string,
    {
      kind: 'wins' | 'losses';
      length: number;
    } | null
  >();
  for (const franchiseId of franchiseIds) {
    result.set(franchiseId, streakOfGames(gamesByFranchise.get(franchiseId) ?? [], franchiseId));
  }
  return result;
}
export function didWin(summary: SeasonGameSummary, franchiseId: string): boolean {
  const isHome = summary.homeFranchiseId === franchiseId;
  if (summary.status === 'forfeit') {
    return summary.forfeitLoserFranchiseId !== franchiseId;
  }
  return isHome ? summary.homeScore > summary.awayScore : summary.awayScore > summary.homeScore;
}
export function finalizeGameRecords(
  games: readonly SeasonGame[],
  summaries: readonly SeasonGameSummary[],
): SeasonGame[] {
  const byId = new Map(games.map((game) => [game.gameId, game]));
  const result: SeasonGame[] = [...games];
  for (const summary of summaries) {
    const game = byId.get(summary.gameId);
    if (!game) continue;
    const index = result.indexOf(game);
    result[index] = {
      ...game,
      status: summary.status,
      homeScore: summary.homeScore,
      awayScore: summary.awayScore,
      forfeitLoserFranchiseId: summary.forfeitLoserFranchiseId,
    };
  }
  return result;
}
export const LEADER_CATEGORY_LABELS: Record<SeasonLeaderCategory, string> = {
  points: 'Points',
  rebounds: 'Rebounds',
  assists: 'Assists',
  steals: 'Steals',
  blocks: 'Blocks',
  threePointersMade: '3-pointers',
};
export function franchiseLabelMap(manifest: HoopRushManifest): Map<string, string> {
  return new Map(manifest.modernFranchiseSlots.map((slot) => [slot.franchiseId, slot.displayName]));
}
export interface BoxScoreRow {
  playerVersionId: string;
  displayName: string;
  position: string;
  seconds: number;
  points: number;
  fieldGoalsMade: number;
  fieldGoalsAttempted: number;
  threePointersMade: number;
  threePointersAttempted: number;
  freeThrowsMade: number;
  freeThrowsAttempted: number;
  offensiveRebounds: number;
  defensiveRebounds: number;
  assists: number;
  steals: number;
  blocks: number;
  turnovers: number;
  fouls: number;
}
export interface BoxScore {
  team: SeasonTeamBox;
  players: BoxScoreRow[];
  opponent: {
    franchiseId: string;
    points: number;
  };
  won: boolean;
}
export function boxScoreFromSummary(
  summary: SeasonGameSummary,
  franchiseId: string,
  names: ReadonlyMap<string, string>,
  playable: ReadonlyMap<string, readonly string[]>,
): BoxScore | null {
  const isHome = summary.homeFranchiseId === franchiseId;
  if (!isHome && summary.awayFranchiseId !== franchiseId) return null;
  const box = isHome ? summary.homeBox : summary.awayBox;
  const lines = isHome ? summary.homePlayers : summary.awayPlayers;
  return {
    team: box,
    players: lines.map((line) => ({
      playerVersionId: line.playerVersionId,
      displayName: names.get(line.playerVersionId) ?? line.playerVersionId,
      position: playable.get(line.playerVersionId)?.[0] ?? '—',
      seconds: line.seconds,
      points: line.points,
      fieldGoalsMade: line.fieldGoalsMade,
      fieldGoalsAttempted: line.fieldGoalsAttempted,
      threePointersMade: line.threePointersMade,
      threePointersAttempted: line.threePointersAttempted,
      freeThrowsMade: line.freeThrowsMade,
      freeThrowsAttempted: line.freeThrowsAttempted,
      offensiveRebounds: line.offensiveRebounds,
      defensiveRebounds: line.defensiveRebounds,
      assists: line.assists,
      steals: line.steals,
      blocks: line.blocks,
      turnovers: line.turnovers,
      fouls: line.fouls,
    })),
    opponent: {
      franchiseId: isHome ? summary.awayFranchiseId : summary.homeFranchiseId,
      points: isHome ? summary.awayScore : summary.homeScore,
    },
    won: didWin(summary, franchiseId),
  };
}
export interface ScheduleRow {
  game: SeasonGame;
  opponentFranchiseId: string;
  humanIsHome: boolean;
  won: boolean | null;
  humanScore: number | null;
  opponentScore: number | null;
}
export function humanScheduleRows(
  games: readonly SeasonGame[],
  humanFranchiseId: string,
): ScheduleRow[] {
  return games
    .filter(
      (game) =>
        game.homeFranchiseId === humanFranchiseId || game.awayFranchiseId === humanFranchiseId,
    )
    .sort((a, b) => a.round - b.round)
    .map((game) => {
      const humanIsHome = game.homeFranchiseId === humanFranchiseId;
      const opponentFranchiseId = humanIsHome ? game.awayFranchiseId : game.homeFranchiseId;
      const isFinal = game.status === 'final' || game.status === 'forfeit';
      const humanScore = isFinal ? (humanIsHome ? game.homeScore : game.awayScore) : null;
      const opponentScore = isFinal ? (humanIsHome ? game.awayScore : game.homeScore) : null;
      let won: boolean | null = null;
      if (isFinal) {
        if (game.status === 'forfeit') {
          won = game.forfeitLoserFranchiseId !== humanFranchiseId;
        } else if (humanScore !== null && opponentScore !== null) {
          won = humanScore > opponentScore;
        }
      }
      return { game, opponentFranchiseId, humanIsHome, won, humanScore, opponentScore };
    });
}
export function progressLabel(completedRounds: number): string {
  if (completedRounds >= SEASON_ROUND_COUNT) return 'Season complete';
  return `Rounds 1–${String(completedRounds)} complete`;
}
const aggregateFoldCache = new WeakMap<
  readonly SeasonGameSummary[],
  {
    teams: SeasonTeamAggregate[];
    players: SeasonPlayerAggregate[];
  }
>();
export function foldSeasonAggregates(summaries: readonly SeasonGameSummary[]): {
  teams: SeasonTeamAggregate[];
  players: SeasonPlayerAggregate[];
} {
  const cached = aggregateFoldCache.get(summaries);
  if (cached !== undefined) return cached;
  const teams = new Map<string, SeasonTeamAggregate>();
  const players = new Map<string, SeasonPlayerAggregate>();
  const touchTeam = (franchiseId: string): SeasonTeamAggregate => {
    const existing = teams.get(franchiseId);
    if (existing) return existing;
    const zero = {
      franchiseId,
      gamesPlayed: 0,
      wins: 0,
      losses: 0,
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
    teams.set(franchiseId, zero);
    return zero;
  };
  const touchPlayer = (playerVersionId: string, franchiseId: string): SeasonPlayerAggregate => {
    const existing = players.get(playerVersionId);
    if (existing) return existing;
    const zero = {
      playerVersionId,
      franchiseId,
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
    players.set(playerVersionId, zero);
    return zero;
  };
  for (const summary of summaries) {
    const home = touchTeam(summary.homeFranchiseId);
    const away = touchTeam(summary.awayFranchiseId);
    home.gamesPlayed += 1;
    away.gamesPlayed += 1;
    if (summary.status === 'forfeit') {
      const loser = summary.forfeitLoserFranchiseId;
      if (loser === summary.homeFranchiseId) {
        away.wins += 1;
        home.losses += 1;
      } else {
        home.wins += 1;
        away.losses += 1;
      }
      continue;
    }
    const homeWon = summary.homeScore > summary.awayScore;
    if (homeWon) {
      home.wins += 1;
      away.losses += 1;
    } else {
      away.wins += 1;
      home.losses += 1;
    }
    for (const [team, box, lines] of [
      [home, summary.homeBox, summary.homePlayers],
      [away, summary.awayBox, summary.awayPlayers],
    ] as const) {
      team.points += box.points;
      team.fieldGoalsMade += box.fieldGoalsMade;
      team.fieldGoalsAttempted += box.fieldGoalsAttempted;
      team.threePointersMade += box.threePointersMade;
      team.threePointersAttempted += box.threePointersAttempted;
      team.freeThrowsMade += box.freeThrowsMade;
      team.freeThrowsAttempted += box.freeThrowsAttempted;
      team.offensiveRebounds += box.offensiveRebounds;
      team.defensiveRebounds += box.defensiveRebounds;
      team.assists += box.assists;
      team.steals += box.steals;
      team.blocks += box.blocks;
      team.turnovers += box.turnovers;
      team.fouls += box.fouls;
      team.possessions += box.possessions;
      for (const line of lines) {
        const player = touchPlayer(line.playerVersionId, team.franchiseId);
        player.gamesPlayed += 1;
        if (line.seconds > 0) player.appearances += 1;
        if (line.started === true) player.started += 1;
        player.seconds += line.seconds;
        player.points += line.points;
        player.fieldGoalsMade += line.fieldGoalsMade;
        player.fieldGoalsAttempted += line.fieldGoalsAttempted;
        player.threePointersMade += line.threePointersMade;
        player.threePointersAttempted += line.threePointersAttempted;
        player.freeThrowsMade += line.freeThrowsMade;
        player.freeThrowsAttempted += line.freeThrowsAttempted;
        player.offensiveRebounds += line.offensiveRebounds;
        player.defensiveRebounds += line.defensiveRebounds;
        player.assists += line.assists;
        player.steals += line.steals;
        player.blocks += line.blocks;
        player.turnovers += line.turnovers;
        player.fouls += line.fouls;
      }
    }
  }
  const result = {
    teams: [...teams.values()].sort((a, b) => a.franchiseId.localeCompare(b.franchiseId)),
    players: [...players.values()].sort((a, b) =>
      a.playerVersionId.localeCompare(b.playerVersionId),
    ),
  };
  aggregateFoldCache.set(summaries, result);
  return result;
}
export function rebaseStandingsBefore(
  standings: SeasonStandings,
  league: SeasonLeague,
  blockSummaries: readonly SeasonGameSummary[],
): SeasonStandings {
  const byId = new Map(
    standings.rows.map((row) => [
      row.franchiseId,
      {
        ...row,
        headToHead: row.headToHead.map((record) => ({ ...record })),
      },
    ]),
  );
  const conferenceOf = new Map(league.teams.map((team) => [team.franchiseId, team.conference]));
  const divisionOf = new Map(league.teams.map((team) => [team.franchiseId, team.division]));
  const adjust = (
    franchiseId: string,
    delta: {
      wins?: number;
      losses?: number;
      gamesPlayed?: number;
      home?: number;
      away?: number;
      conference?: number;
      division?: number;
      pointsFor?: number;
      pointsAgainst?: number;
    },
  ): void => {
    const row = byId.get(franchiseId);
    if (!row) return;
    row.wins += delta.wins ?? 0;
    row.losses += delta.losses ?? 0;
    row.gamesPlayed += delta.gamesPlayed ?? 0;
    row.homeWins += delta.home ?? 0;
    row.homeLosses += delta.home ?? 0;
    row.awayWins += delta.away ?? 0;
    row.awayLosses += delta.away ?? 0;
    row.conferenceWins += delta.conference ?? 0;
    row.conferenceLosses += delta.conference ?? 0;
    row.divisionWins += delta.division ?? 0;
    row.divisionLosses += delta.division ?? 0;
    row.pointsFor += delta.pointsFor ?? 0;
    row.pointsAgainst += delta.pointsAgainst ?? 0;
  };
  const headToHead = (
    franchiseId: string,
    opponentId: string,
  ): {
    wins: number;
    losses: number;
  } => {
    const row = byId.get(franchiseId);
    const record = row?.headToHead.find((h) => h.franchiseId === opponentId);
    return { wins: record?.wins ?? 0, losses: record?.losses ?? 0 };
  };
  for (const summary of blockSummaries) {
    const home = summary.homeFranchiseId;
    const away = summary.awayFranchiseId;
    const homeWon = didWin(summary, home);
    const winner = homeWon ? home : away;
    const loser = homeWon ? away : home;
    const sameConference = conferenceOf.get(home) === conferenceOf.get(away);
    const sameDivision = divisionOf.get(home) === divisionOf.get(away);
    const homePoints = summary.homeScore;
    const awayPoints = summary.awayScore;
    adjust(winner, {
      wins: -1,
      gamesPlayed: -1,
      home: winner === home ? -1 : 0,
      away: winner === away ? -1 : 0,
      conference: sameConference ? -1 : 0,
      division: sameDivision ? -1 : 0,
      pointsFor: -(homeWon ? homePoints : awayPoints),
      pointsAgainst: -(homeWon ? awayPoints : homePoints),
    });
    adjust(loser, {
      losses: -1,
      gamesPlayed: -1,
      home: loser === home ? -1 : 0,
      away: loser === away ? -1 : 0,
      conference: sameConference ? -1 : 0,
      division: sameDivision ? -1 : 0,
      pointsFor: -(homeWon ? awayPoints : homePoints),
      pointsAgainst: -(homeWon ? homePoints : awayPoints),
    });
    const hhWinner = headToHead(winner, loser);
    const winnerRow = byId.get(winner);
    const winnerHh = winnerRow?.headToHead.find((h) => h.franchiseId === loser);
    if (winnerHh) winnerHh.wins = hhWinner.wins - 1;
    const hhLoser = headToHead(loser, winner);
    const loserRow = byId.get(loser);
    const loserHh = loserRow?.headToHead.find((h) => h.franchiseId === winner);
    if (loserHh) loserHh.losses = hhLoser.losses - 1;
  }
  return {
    ...standings,
    rows: standings.rows.map((row) => byId.get(row.franchiseId) ?? row),
  };
}
export function deriveNotablePerformances(
  blockSummaries: readonly SeasonGameSummary[],
  humanFranchiseId: string,
): SeasonNotablePerformance[] {
  const lines: Array<{
    playerVersionId: string;
    franchiseId: string;
    gameId: string;
    points: number;
    rebounds: number;
    assists: number;
    humanTeam: boolean;
  }> = [];
  for (const summary of blockSummaries) {
    for (const [franchiseId, players] of [
      [summary.homeFranchiseId, summary.homePlayers],
      [summary.awayFranchiseId, summary.awayPlayers],
    ] as const) {
      for (const line of players) {
        lines.push({
          playerVersionId: line.playerVersionId,
          franchiseId,
          gameId: summary.gameId,
          points: line.points,
          rebounds: line.offensiveRebounds + line.defensiveRebounds,
          assists: line.assists,
          humanTeam: franchiseId === humanFranchiseId,
        });
      }
    }
  }
  const sort = (entries: typeof lines) =>
    [...entries].sort(
      (a, b) =>
        b.points - a.points ||
        b.rebounds - a.rebounds ||
        b.assists - a.assists ||
        a.playerVersionId.localeCompare(b.playerVersionId),
    );
  const human = sort(lines.filter((line) => line.humanTeam)).slice(0, 5);
  const league = sort(lines.filter((line) => !line.humanTeam)).slice(0, 5);
  return [...human, ...league].map((line) => ({
    playerVersionId: line.playerVersionId,
    franchiseId: line.franchiseId,
    gameId: line.gameId,
    points: line.points,
    rebounds: line.rebounds,
    assists: line.assists,
    humanTeam: line.humanTeam,
  }));
}
export function deriveVersionSpotlights(
  blockSummaries: readonly SeasonGameSummary[],
  rosters: readonly SeasonRosterEntry[],
): SeasonVersionSpotlight[] {
  const byPerson = new Map<string, string[]>();
  for (const entry of rosters) {
    const list = byPerson.get(entry.playerId) ?? [];
    list.push(entry.playerVersionId);
    byPerson.set(entry.playerId, list);
  }
  const totals = new Map<
    string,
    {
      games: number;
      points: number;
      rebounds: number;
      assists: number;
      franchiseId: string;
    }
  >();
  for (const summary of blockSummaries) {
    for (const [franchiseId, players] of [
      [summary.homeFranchiseId, summary.homePlayers],
      [summary.awayFranchiseId, summary.awayPlayers],
    ] as const) {
      for (const line of players) {
        const current = totals.get(line.playerVersionId) ?? {
          games: 0,
          points: 0,
          rebounds: 0,
          assists: 0,
          franchiseId,
        };
        current.games += 1;
        current.points += line.points;
        current.rebounds += line.offensiveRebounds + line.defensiveRebounds;
        current.assists += line.assists;
        totals.set(line.playerVersionId, current);
      }
    }
  }
  const spotlights: SeasonVersionSpotlight[] = [];
  for (const versions of byPerson.values()) {
    if (versions.length < 2) continue;
    for (let i = 0; i < versions.length; i += 1) {
      for (let j = i + 1; j < versions.length; j += 1) {
        const a = versions[i];
        const b = versions[j];
        if (a === undefined || b === undefined) continue;
        const ta = totals.get(a);
        const tb = totals.get(b);
        if (!ta || !tb) continue;
        let headToHeadGames = 0;
        let headToHeadWinsA = 0;
        let headToHeadWinsB = 0;
        for (const summary of blockSummaries) {
          const meeting =
            (summary.homeFranchiseId === ta.franchiseId &&
              summary.awayFranchiseId === tb.franchiseId) ||
            (summary.homeFranchiseId === tb.franchiseId &&
              summary.awayFranchiseId === ta.franchiseId);
          if (!meeting) continue;
          headToHeadGames += 1;
          if (didWin(summary, ta.franchiseId)) headToHeadWinsA += 1;
          else headToHeadWinsB += 1;
        }
        spotlights.push({
          versionA: a,
          versionB: b,
          sameTeam: ta.franchiseId === tb.franchiseId,
          gamesPlayedA: ta.games,
          gamesPlayedB: tb.games,
          pointsA: ta.points,
          pointsB: tb.points,
          reboundsA: ta.rebounds,
          reboundsB: tb.rebounds,
          assistsA: ta.assists,
          assistsB: tb.assists,
          headToHeadGames,
          headToHeadWinsA,
          headToHeadWinsB,
        });
      }
    }
  }
  spotlights.sort(
    (a, b) =>
      b.pointsA + b.pointsB - (a.pointsA + a.pointsB) || a.versionA.localeCompare(b.versionA),
  );
  return spotlights.slice(0, 5);
}
export function deriveBlockRecap(input: {
  runId: string;
  blockIndex: number;
  completedRounds: number;
  standings: SeasonStandings;
  league: SeasonLeague;
  blockSummaries: readonly SeasonGameSummary[];
  allSummaries: readonly SeasonGameSummary[];
  rosters: readonly SeasonRosterEntry[];
  games: readonly SeasonGame[];
  humanFranchiseId: string;
  run: SeasonRun;
}): SeasonBlockRecap {
  const {
    runId,
    blockIndex,
    completedRounds,
    standings,
    league,
    blockSummaries,
    allSummaries,
    rosters,
    games,
    humanFranchiseId,
    run,
  } = input;
  const before = rebaseStandingsBefore(standings, league, blockSummaries);
  const rankOf = (rows: SeasonStandingsRow[], franchiseId: string, conference: string): number => {
    const sorted = [...rows]
      .filter((row) => conferenceOfLeague(league, row.franchiseId) === conference)
      .sort(
        (a, b) =>
          b.wins - a.wins ||
          pointDifferential(b) - pointDifferential(a) ||
          a.franchiseId.localeCompare(b.franchiseId),
      );
    const index = sorted.findIndex((row) => row.franchiseId === franchiseId);
    return index === -1 ? 1 : index + 1;
  };
  const movement = (franchiseId: string): SeasonRecordMovement => {
    const after = standings.rows.find((row) => row.franchiseId === franchiseId);
    const beforeRow = before.rows.find((row) => row.franchiseId === franchiseId);
    const conference = conferenceOfLeague(league, franchiseId);
    return {
      franchiseId,
      winsBefore: beforeRow?.wins ?? 0,
      lossesBefore: beforeRow?.losses ?? 0,
      winsAfter: after?.wins ?? 0,
      lossesAfter: after?.losses ?? 0,
      positionBefore: rankOf(before.rows, franchiseId, conference),
      positionAfter: rankOf(standings.rows, franchiseId, conference),
    };
  };
  const streaks: SeasonStreak[] = [];
  const streaksByFranchise = franchiseStreaks(
    allSummaries,
    league.teams.map((team) => team.franchiseId),
  );
  for (const team of league.teams) {
    const streak = streaksByFranchise.get(team.franchiseId) ?? null;
    if (streak && streak.length >= 2) {
      streaks.push({ franchiseId: team.franchiseId, kind: streak.kind, length: streak.length });
    }
  }
  streaks.sort((a, b) => b.length - a.length || a.franchiseId.localeCompare(b.franchiseId));
  const nextBlockIndex = blockIndex + 1;
  const upcomingHumanGames: SeasonUpcomingHumanGame[] =
    nextBlockIndex <= 8 ? humanUpcomingGamesFromGames(games, humanFranchiseId, nextBlockIndex) : [];
  return {
    schemaVersion: 1,
    recapVersion: SEASON_RECAP_VERSION,
    runId,
    blockIndex,
    completedRounds,
    humanRecord: movement(humanFranchiseId),
    standingsMovement: league.teams.map((team) => movement(team.franchiseId)),
    notablePerformances: deriveNotablePerformances(blockSummaries, humanFranchiseId),
    streaks: streaks.slice(0, 10),
    versionSpotlights: deriveVersionSpotlights(blockSummaries, rosters),
    upcomingHumanGames: upcomingHumanGames.slice(0, 10),
    injuryEvidence: deriveBlockInjuryEvidence({
      blockSummaries,
      health: run.health,
      games,
      blockIndex,
      humanFranchiseId,
    }),
    objectiveEvidence: null,
    tradeEvidence: {
      tradesAccepted: run.transactions.filter(
        (entry) => entry.type === 'trade' && entry.blockIndex === blockIndex,
      ).length,
      influenceDelta: run.influence.ledger
        .filter(
          (entry) => entry.franchiseId === humanFranchiseId && entry.blockIndex === blockIndex,
        )
        .reduce((sum, entry) => sum + entry.appliedDelta, 0),
    },
    freeAgencyEvidence: blockFreeAgencyEvidenceOf({
      blockIndex,
      humanFranchiseId,
      freeAgency: run.freeAgency,
    }),
    influenceBalance: { humanBalance: humanBalanceAtBlockEnd(run, humanFranchiseId, blockIndex) },
  };
}
export function blockFreeAgencyEvidenceOf(input: {
  blockIndex: number;
  humanFranchiseId: string | null;
  freeAgency: SeasonFreeAgencyState | undefined;
}): SeasonBlockRecap['freeAgencyEvidence'] {
  const freeAgency = input.freeAgency;
  if (freeAgency === undefined) {
    return {
      windowIndex: null,
      signings: [],
      influenceDelta: 0,
      seasonSignings: 0,
      seasonSpend: 0,
    };
  }
  const resolvedWindow = freeAgency.windows.find(
    (window) => window.blockIndex === input.blockIndex && window.status === 'resolved',
  );
  const humanDelta =
    input.humanFranchiseId === null ? 0 : (freeAgency.seasonSpend[input.humanFranchiseId] ?? 0);
  return {
    windowIndex: resolvedWindow?.windowIndex ?? null,
    signings: (resolvedWindow?.signings ?? []).map((signing) => ({
      franchiseId: signing.franchiseId,
      playerVersionId: signing.playerVersionId,
      band: signing.band,
      influenceCost: signing.influenceCost,
    })),
    influenceDelta: -humanDelta,
    seasonSignings:
      input.humanFranchiseId === null ? 0 : (freeAgency.signingCounts[input.humanFranchiseId] ?? 0),
    seasonSpend: humanDelta,
  };
}
export function humanBalanceAtBlockEnd(
  run: SeasonRun,
  humanFranchiseId: string,
  blockIndex: number,
): number {
  const current = run.influence.balances[humanFranchiseId] ?? 0;
  const laterDelta = run.influence.ledger
    .filter(
      (entry) =>
        entry.franchiseId === humanFranchiseId &&
        entry.blockIndex !== null &&
        entry.blockIndex > blockIndex,
    )
    .reduce((sum, entry) => sum + entry.appliedDelta, 0);
  return current - laterDelta;
}
export function deriveBlockInjuryEvidence(input: {
  blockSummaries: readonly SeasonGameSummary[];
  health: SeasonRun['health'];
  games: readonly SeasonGame[];
  blockIndex: number;
  humanFranchiseId: string;
}): SeasonBlockInjuryEvidence {
  const { blockSummaries, health, games, blockIndex, humanFranchiseId } = input;
  const { fromRound, toRound } = blockRoundRange(blockIndex);
  const roundOfGame = new Map(games.map((game) => [game.gameId, game.round]));
  const bySeverity: SeasonBlockInjuryEvidence['bySeverity'] = {
    minor: 0,
    moderate: 0,
    major: 0,
    'season-ending': 0,
  };
  let sameGameReturns = 0;
  let seasonEnding = 0;
  const humanTeamInjuries: SeasonBlockInjuryEvidence['humanTeamInjuries'] = [];
  for (const summary of blockSummaries) {
    const humanSide =
      summary.homeFranchiseId === humanFranchiseId
        ? 'home'
        : summary.awayFranchiseId === humanFranchiseId
          ? 'away'
          : null;
    for (const event of summary.injuryEvents) {
      bySeverity[event.severity] += 1;
      if (event.returned) sameGameReturns += 1;
      if (event.severity === 'season-ending') seasonEnding += 1;
      if (humanSide !== null && event.side === humanSide && humanTeamInjuries.length < 40) {
        humanTeamInjuries.push(event);
      }
    }
  }
  const returnedThisBlock = health.injuries.filter(
    (record) =>
      record.actualReturnRound !== null &&
      record.actualReturnRound >= fromRound &&
      record.actualReturnRound <= toRound,
  ).length;
  const activeAtBlockEnd = health.injuries.filter((record) => {
    if (record.missedGamesRemaining <= 0) return false;
    const occurrenceRound = roundOfGame.get(record.gameId) ?? 0;
    return occurrenceRound <= toRound;
  }).length;
  return {
    injuries: blockSummaries.reduce((sum, summary) => sum + summary.injuryEvents.length, 0),
    bySeverity,
    sameGameReturns,
    seasonEnding,
    returnedThisBlock,
    activeAtBlockEnd,
    humanTeamInjuries,
  };
}
function conferenceOfLeague(league: SeasonLeague, franchiseId: string): string {
  return league.teams.find((team) => team.franchiseId === franchiseId)?.conference ?? 'east';
}
export function humanUpcomingGamesFromGames(
  games: readonly SeasonGame[],
  humanFranchiseId: string,
  blockIndex: number,
): SeasonUpcomingHumanGame[] {
  return humanUpcomingGames(games, humanFranchiseId, blockIndex);
}
export const CAMPAIGN_IDENTITY_LABELS: Record<string, string> = {
  'win-now': 'Win now',
  'player-development': 'Player development',
  'team-identity': 'Team identity',
};
export const CAMPAIGN_FOCUS_LABELS: Record<string, string> = {
  defense: 'Defense',
  shooting: 'Shooting',
  'ball-movement': 'Ball movement',
  depth: 'Depth',
};
export const CAMPAIGN_FAMILY_LABELS: Record<string, string> = {
  results: 'Results',
  marquee: 'Marquee',
  style: 'Style',
  'player-role': 'Player role',
  'roster-response': 'Roster response',
};
export const CAMPAIGN_OUTCOME_LABELS: Record<SeasonCampaignEvaluation['outcome'], string> = {
  missed: 'Missed',
  completed: 'Completed',
  breakthrough: 'Breakthrough',
};
export const CAMPAIGN_REWARD_LABELS: Record<SeasonCampaignReward['type'], string> = {
  influence: 'Influence',
  'trade-board-information': 'Trade board information',
  'trade-inquiry-credit': 'Trade inquiry credit',
  'follow-up-unlock': 'Follow-up unlock',
};
export function formatCampaignCondition(condition: SeasonCampaignCondition): string {
  const op =
    condition.comparisonOperator === 'gte'
      ? '≥'
      : condition.comparisonOperator === 'lte'
        ? '≤'
        : condition.comparisonOperator === 'gt'
          ? '>'
          : condition.comparisonOperator === 'lt'
            ? '<'
            : '=';
  switch (condition.kind) {
    case 'block-wins':
      return `Win ${op}${String(condition.threshold)} of this block`;
    case 'winning-block':
      return `Post a winning block (${op}${String(condition.threshold)})`;
    case 'top-six':
      return `Finish top six in conference`;
    case 'play-in':
      return `Reach Play-In position`;
    case 'win-over-higher':
      return `Beat a higher-ranked team ${op}${String(condition.threshold)}`;
    case 'beat-conference-leader':
      return `Beat the conference leader`;
    case 'sweep-opponent':
      return `Sweep ${condition.opponentFranchiseId ?? 'opponent'} ${op}${String(condition.threshold)}`;
    case 'defensive-efficiency':
      return `Allow ${op}${String(condition.threshold)} pts / game (defensive efficiency)`;
    case 'three-point-volume':
      return `Make ${op}${String(condition.threshold)} threes this block`;
    case 'assists':
      return `Record ${op}${String(condition.threshold)} assists this block`;
    case 'turnover-control':
      return `Commit ${op}${String(condition.threshold)} turnovers`;
    case 'rebound-margin':
      return `Rebound margin ${op}${String(condition.threshold)}`;
    case 'bench-contribution':
      return `Bench scores ${op}${String(condition.threshold)} pts`;
    case 'player-minutes':
      return `${condition.playerVersionId.slice(0, 8)}… logs ${op}${String(condition.threshold)} minutes`;
    case 'player-starts':
      return `${condition.playerVersionId.slice(0, 8)}… starts ${op}${String(condition.threshold)} games`;
    case 'player-availability':
      return `${condition.playerVersionId.slice(0, 8)}… available ${op}${String(condition.threshold)} games`;
    case 'player-points':
      return `${condition.playerVersionId.slice(0, 8)}… scores ${op}${String(condition.threshold)} pts`;
    case 'player-assists':
      return `${condition.playerVersionId.slice(0, 8)}… ${op}${String(condition.threshold)} assists`;
    case 'player-rebounds':
      return `${condition.playerVersionId.slice(0, 8)}… ${op}${String(condition.threshold)} rebounds`;
    case 'roster-new-player-minutes':
      return `New arrival plays ${op}${String(condition.threshold)} minutes`;
    case 'roster-new-player-starts':
      return `New arrival starts ${op}${String(condition.threshold)} games`;
    case 'roster-replace-unavailable':
      return `Replace unavailable rotation member`;
    case 'roster-depth-coverage':
      return `Cover depth weakness ${op}${String(condition.threshold)}`;
    default: {
      const anyCond = condition as unknown as {
        kind: string;
        threshold: number;
      };
      return `${anyCond.kind} ${op}${String(anyCond.threshold)}`;
    }
  }
}
export function formatCampaignReward(reward: SeasonCampaignReward): string {
  const label = CAMPAIGN_REWARD_LABELS[reward.type] ?? reward.type;
  return `+${String(reward.amount)} ${label} · ${reward.rewardId}`;
}
export function campaignRewardSummary(
  evaluations: readonly SeasonCampaignEvaluation[],
  appliedRewardIds: readonly string[],
): string {
  const totalApplied = appliedRewardIds.length;
  const byOutcome = evaluations.reduce<Record<string, number>>(
    (acc, ev) => {
      acc[ev.outcome] = (acc[ev.outcome] ?? 0) + 1;
      return acc;
    },
    {},
  );
  return `${String(totalApplied)} rewards applied · missed ${String(byOutcome['missed'] ?? 0)} · completed ${String(byOutcome['completed'] ?? 0)} · breakthrough ${String(byOutcome['breakthrough'] ?? 0)}`;
}
export interface CampaignCardViewModel {
  opportunity: SeasonCampaignOpportunity;
  isSelected: boolean;
  targetLabel: string;
  breakthroughLabel: string | null;
  completedRewardLabel: string;
  breakthroughRewardLabel: string | null;
  feasibilityFacts: Record<string, unknown>;
}
export interface CampaignTimelineViewModel {
  startingIdentity: SeasonCampaignState['startingIdentity'];
  startingFocus: SeasonCampaignState['startingFocus'];
  priorEvaluation: SeasonCampaignEvaluation | null;
  branchEntries: Array<{
    branchId: string;
    state: string;
  }>;
  currentOffers: CampaignCardViewModel[];
  isIdentityRequired: boolean;
  isEvolutionRequired: boolean;
  isBlock8NoOpportunity: boolean;
  currentBlockIndex: number | null;
  rewardEntitlements: SeasonCampaignState['rewardEntitlements'];
  appliedRewardIds: SeasonCampaignState['appliedRewardIds'];
}
export function campaignTimelineViewModel(
  run: SeasonRun | null,
  nextBlockIndex: number | null,
): CampaignTimelineViewModel | null {
  if (run === null) return null;
  const campaign = (run.campaign ?? {
    schemaVersion: 1,
    campaignVersion: 'season-campaign-v1',
    startingIdentity: null,
    startingFocus: null,
    offers: {},
    selections: {},
    evaluations: [],
    branchState: {},
    evolutionOffers: null,
    evolutionSelection: null,
    rewardEntitlements: {
      influenceEarned: 0,
      inquiryCredits: 0,
      informationBenefits: 0,
      followUpUnlocks: [],
    },
    appliedRewardIds: [],
  });
  const evaluations = campaign.evaluations ?? [];
  const priorEvaluation = evaluations.length > 0 ? evaluations[evaluations.length - 1]! : null;
  const branchEntries = Object.entries(campaign.branchState ?? {}).map(([branchId, state]) => ({
    branchId,
    state,
  }));
  const completedBlocks = Math.ceil(run.cursor.completedRounds / 10);
  const targetBlock = nextBlockIndex ?? completedBlocks;
  const isIdentityRequired = campaign.startingIdentity === null;
  const isEvolutionRequired =
    completedBlocks === 5 &&
    campaign.evolutionOffers !== null &&
    campaign.evolutionSelection === null;
  const isBlock8NoOpportunity = targetBlock === 8;
  const offersForBlock =
    targetBlock !== null && targetBlock >= 0 && targetBlock < 8
      ? (campaign.offers[targetBlock] ?? [])
      : [];
  const selections = campaign.selections ?? {};
  const currentOffers: CampaignCardViewModel[] = offersForBlock.map((opp) => {
    const isSelected = selections[targetBlock]?.opportunityId === opp.opportunityId;
    return {
      opportunity: opp,
      isSelected,
      targetLabel: formatCampaignCondition(opp.target),
      breakthroughLabel: opp.breakthrough ? formatCampaignCondition(opp.breakthrough) : null,
      completedRewardLabel: formatCampaignReward(opp.completedReward),
      breakthroughRewardLabel: opp.breakthroughReward
        ? formatCampaignReward(opp.breakthroughReward)
        : null,
      feasibilityFacts: opp.feasibilityFacts,
    };
  });
  return {
    startingIdentity: campaign.startingIdentity,
    startingFocus: campaign.startingFocus,
    priorEvaluation,
    branchEntries,
    currentOffers,
    isIdentityRequired,
    isEvolutionRequired,
    isBlock8NoOpportunity,
    currentBlockIndex: targetBlock,
    rewardEntitlements: campaign.rewardEntitlements,
    appliedRewardIds: campaign.appliedRewardIds,
  };
}
export const TRADE_NEED_LABELS: Record<string, string> = {
  'ball-handling': 'Ball-handling',
  shooting: 'Shooting',
  'perimeter-defense': 'Perimeter defense',
  'interior-defense': 'Interior defense',
  rebounding: 'Rebounding',
  availability: 'Availability',
  'rotation-talent': 'Rotation talent',
  depth: 'Depth',
};
export const TRADE_PRIORITY_LABELS: Record<string, string> = {
  talent: 'Talent',
  fit: 'Fit',
  availability: 'Availability',
  depth: 'Depth',
  influence: 'Influence',
};
export const COMPETITOR_INTEREST_LABELS: Record<string, string> = {
  low: 'Low',
  possible: 'Possible',
  strong: 'Strong',
  'preferred-fit': 'Preferred fit',
};
export const TRADE_RESPONSE_CAUSE_LABELS: Record<string, string> = {
  acceptable: 'acceptable',
  'close-needs-more-value': 'close needs more value',
  'wrong-roster-fit': 'wrong roster fit',
  'unacceptable-injury-risk': 'unacceptable injury/availability risk',
  'protected-player': 'protected player',
  'illegal-roster': 'illegal roster/rotation',
  'negotiations-closed': 'negotiations closed',
  'close needs more value': 'close needs more value',
  'wrong roster fit': 'wrong roster fit',
  'unacceptable injury risk': 'unacceptable injury/availability risk',
};
export function formatTradeNeeds(needs: readonly string[]): string {
  return needs.map((n) => TRADE_NEED_LABELS[n] ?? n).join(' / ');
}
export function formatTradePriority(priority: string): string {
  return TRADE_PRIORITY_LABELS[priority] ?? priority;
}
export function competitorInterestLabel(interest: string): string {
  return COMPETITOR_INTEREST_LABELS[interest] ?? interest;
}
export function responseCauseLabel(cause: string | null): string {
  if (cause === null) return '—';
  return TRADE_RESPONSE_CAUSE_LABELS[cause] ?? cause;
}
export function inquiryCounterLabel(
  allowance: number,
  used: number,
  purchasedUsed: boolean,
  earnedUsed: boolean,
): string {
  const base = 3;
  const extra = allowance - base;
  const purchased = purchasedUsed ? 1 : 0;
  const earned = earnedUsed ? 1 : 0;
  return `${String(used)}/${String(allowance)} used · 3 base + ${String(extra)} extra (purchased ${String(purchased)}/1 · earned ${String(earned)}/1)`;
}
export interface PackageConsequenceFacts {
  fromRosterSize: number;
  toRosterSize: number;
  fromAfter: number;
  toAfter: number;
  legal: boolean;
  outgoingAvailable: Array<{
    playerVersionId: string;
    available: boolean;
  }>;
  incomingAvailable: Array<{
    playerVersionId: string;
    available: boolean;
  }>;
  roleCoverage: string;
  chemistryRemoved: number;
  chemistryNew: number;
  influenceNote: string;
}
export function packageConsequenceFacts(input: {
  fromRosterSize: number;
  toRosterSize: number;
  outgoingIds: readonly string[];
  incomingIds: readonly string[];
  outgoingAvailable: readonly boolean[];
  incomingAvailable: readonly boolean[];
  influenceAmount: number;
  influenceFromSender: string | null;
  humanFranchiseId: string;
  toFranchiseId: string;
}): PackageConsequenceFacts {
  const fromAfter = input.fromRosterSize - input.outgoingIds.length + input.incomingIds.length;
  const toAfter = input.toRosterSize - input.incomingIds.length + input.outgoingIds.length;
  const legal =
    fromAfter >= SEASON_ROSTER_MIN_SIZE &&
    fromAfter <= SEASON_ROSTER_MAX_SIZE &&
    toAfter >= SEASON_ROSTER_MIN_SIZE &&
    toAfter <= SEASON_ROSTER_MAX_SIZE;
  const outgoingAvailable = input.outgoingIds.map((id, idx) => ({
    playerVersionId: id,
    available: input.outgoingAvailable[idx] ?? true,
  }));
  const incomingAvailable = input.incomingIds.map((id, idx) => ({
    playerVersionId: id,
    available: input.incomingAvailable[idx] ?? true,
  }));
  const anyUnavailable = [...outgoingAvailable, ...incomingAvailable].some((p) => !p.available);
  const roleCoverage = anyUnavailable
    ? 'Availability flag: one or more players currently out — rotation will use contingency'
    : 'Role coverage: rotation will repair by slotting incoming to outgoing minutes; both teams retain a legal ten';
  const chemistryRemoved = input.outgoingIds.length * 9;
  const chemistryNew = input.incomingIds.length * 9;
  const influenceNote =
    input.influenceAmount === 0
      ? 'No Influence attached'
      : `${String(input.influenceAmount)} Influence from ${input.influenceFromSender === input.humanFranchiseId ? 'you' : input.influenceFromSender === input.toFranchiseId ? 'them' : input.influenceFromSender} · never alone, 1–2 max, capped at 5% per point (10% total)`;
  return {
    fromRosterSize: input.fromRosterSize,
    toRosterSize: input.toRosterSize,
    fromAfter,
    toAfter,
    legal,
    outgoingAvailable,
    incomingAvailable,
    roleCoverage,
    chemistryRemoved,
    chemistryNew,
    influenceNote,
  };
}
export function chemistryFootnote(removedPairs: number, newPairs: number): string {
  return `Chemistry: 45 active pairs per team (1,350 per league) · resets ${String(removedPairs)} existing pairings and starts ${String(newPairs)} new at neutral`;
}
export function valueTrendToneLabel(trend: SeasonTradeValueTrend['trend']): string {
  switch (trend) {
    case 'rising':
      return 'Rising';
    case 'falling':
      return 'Falling';
    case 'stable':
      return 'Stable';
  }
}
export function rehabPresentationFacts(balance: number): {
  floor: number;
  cap: number;
  cost: number;
  successRate: string;
  successNote: string;
  failureNote: string;
  recurrenceNote: string;
} {
  return {
    floor: SEASON_INFLUENCE_FLOOR,
    cap: SEASON_INFLUENCE_CAP,
    cost: 2,
    successRate: '60%',
    successNote: 'Success reduces remaining absence by one team game',
    failureNote: 'Failure leaves the estimate unchanged',
    recurrenceNote:
      'After actual return, +60 bp rehab recurrence premium for 10 games (100 bp total with base 40 bp during window)',
  };
}
