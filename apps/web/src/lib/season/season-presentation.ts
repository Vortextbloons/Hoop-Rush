import {
  SEASON_CHALLENGE_CATALOG,
  SEASON_INFLUENCE_CAP,
  SEASON_RECAP_VERSION,
  SEASON_ROSTER_MAX_SIZE,
  SEASON_ROSTER_MIN_SIZE,
  SEASON_ROUND_COUNT,
  blockRoundRange,
  seasonUpcomingHumanGameSchema,
  type FranchiseId,
  type SeasonGameId,
  type HoopRushManifest,
  type SeasonBlockChallengeEvidence,
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
  type SeasonTradeGrade,
  type SeasonTradeValueTrend,
  type SeasonUpcomingHumanGame,
  type SeasonVersionSpotlight,
} from '@hoop-rush/data-contracts';
import { humanUpcomingGames } from './season-lock-preview';
import {
  TRADE_BAND_1V1,
  TRADE_BAND_DEFAULT,
  blockFreeAgencyEvidenceOf as engineFreeAgencyEvidenceOf,
  blockTradeEvidenceOf as engineTradeEvidenceOf,
  foldSeasonAggregates as foldEngineSeasonAggregates,
  humanInfluenceBalanceAtBlockEnd as engineHumanBalanceAtBlockEnd,
} from '@hoop-rush/engine';
export const UNKNOWN_PLAYER_DISPLAY_NAME = 'Unknown player';
export function displayPlayerName(name: string | null | undefined): string {
  const trimmed = name?.trim();
  return trimmed !== undefined && trimmed !== '' ? trimmed : UNKNOWN_PLAYER_DISPLAY_NAME;
}
export function formatInfluenceBalance(
  balance: number,
  cap: number = SEASON_INFLUENCE_CAP,
): string {
  return `◆ ${String(balance)} / ${String(cap)}`;
}
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
  fourPointersMade: number;
  fourPointersAttempted: number;
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
      displayName: displayPlayerName(names.get(line.playerVersionId)),
      position: playable.get(line.playerVersionId)?.[0] ?? '—',
      seconds: line.seconds,
      points: line.points,
      fieldGoalsMade: line.fieldGoalsMade,
      fieldGoalsAttempted: line.fieldGoalsAttempted,
      threePointersMade: line.threePointersMade,
      threePointersAttempted: line.threePointersAttempted,
      fourPointersMade: line.fourPointersMade ?? 0,
      fourPointersAttempted: line.fourPointersAttempted ?? 0,
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
  const result = foldEngineSeasonAggregates(summaries);
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
    franchiseId: FranchiseId,
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
    franchiseId: FranchiseId,
    opponentId: FranchiseId,
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
    franchiseId: FranchiseId;
    gameId: SeasonGameId;
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
  const conferenceByFranchise = new Map(
    league.teams.map((team) => [team.franchiseId, team.conference]),
  );
  const sortedByConference = new Map<string, SeasonStandingsRow[]>();
  const sortedBeforeByConference = new Map<string, SeasonStandingsRow[]>();
  for (const row of standings.rows) {
    const conference = conferenceByFranchise.get(row.franchiseId) ?? 'east';
    const list = sortedByConference.get(conference);
    if (list) list.push(row);
    else sortedByConference.set(conference, [row]);
  }
  for (const list of sortedByConference.values())
    list.sort(
      (a, b) =>
        b.wins - a.wins ||
        pointDifferential(b) - pointDifferential(a) ||
        a.franchiseId.localeCompare(b.franchiseId),
    );
  for (const row of before.rows) {
    const conference = conferenceByFranchise.get(row.franchiseId) ?? 'east';
    const list = sortedBeforeByConference.get(conference);
    if (list) list.push(row);
    else sortedBeforeByConference.set(conference, [row]);
  }
  for (const list of sortedBeforeByConference.values())
    list.sort(
      (a, b) =>
        b.wins - a.wins ||
        pointDifferential(b) - pointDifferential(a) ||
        a.franchiseId.localeCompare(b.franchiseId),
    );
  const rankOf = (rows: SeasonStandingsRow[], franchiseId: string, conference: string): number => {
    const cached =
      rows === standings.rows
        ? sortedByConference.get(conference)
        : rows === before.rows
          ? sortedBeforeByConference.get(conference)
          : null;
    const sorted =
      cached ??
      [...rows]
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
  const movement = (franchiseId: FranchiseId): SeasonRecordMovement => {
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
  const parsedHumanForRecap = humanFranchiseId as FranchiseId;
  const upcomingHumanGames: SeasonUpcomingHumanGame[] =
    nextBlockIndex <= 8 ? humanUpcomingGamesFromGames(games, humanFranchiseId, nextBlockIndex) : [];
  return {
    schemaVersion: 1,
    recapVersion: SEASON_RECAP_VERSION,
    runId,
    blockIndex,
    completedRounds,
    humanRecord: movement(parsedHumanForRecap),
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
    challengeEvidence: challengeEvidenceOfRun(run, blockIndex),
    tradeEvidence: engineTradeEvidenceOf({
      blockIndex,
      humanFranchiseId,
      transactions: run.transactions,
      influence: run.influence,
    }),
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
  return engineFreeAgencyEvidenceOf(input);
}
export function humanBalanceAtBlockEnd(
  run: SeasonRun,
  humanFranchiseId: string,
  blockIndex: number,
): number {
  return engineHumanBalanceAtBlockEnd(run.influence, humanFranchiseId, blockIndex);
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
  const roundOfGame = new Map<string, number>(games.map((game) => [game.gameId, game.round]));
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
  return humanUpcomingGames(games, humanFranchiseId, blockIndex).map((game) =>
    seasonUpcomingHumanGameSchema.parse(game),
  );
}
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
export function formatCampaignCondition(
  condition: SeasonCampaignCondition,
  playerName: (playerVersionId: string) => string = () => 'Unknown player',
): string {
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
      return `Sweep ${condition.opponentFranchiseId} ${op}${String(condition.threshold)}`;
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
      return `${playerName(condition.playerVersionId)} logs ${op}${String(condition.threshold)} minutes`;
    case 'player-starts':
      return `${playerName(condition.playerVersionId)} starts ${op}${String(condition.threshold)} games`;
    case 'player-availability':
      return `${playerName(condition.playerVersionId)} available ${op}${String(condition.threshold)} games`;
    case 'player-points':
      return `${playerName(condition.playerVersionId)} scores ${op}${String(condition.threshold)} pts`;
    case 'player-assists':
      return `${playerName(condition.playerVersionId)} · ${op}${String(condition.threshold)} assists`;
    case 'player-rebounds':
      return `${playerName(condition.playerVersionId)} · ${op}${String(condition.threshold)} rebounds`;
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
  const label = CAMPAIGN_REWARD_LABELS[reward.type];
  return `+${String(reward.amount)} ${label}`;
}
export function campaignRewardSummary(
  evaluations: readonly SeasonCampaignEvaluation[],
  appliedRewardIds: readonly string[],
): string {
  const totalApplied = appliedRewardIds.length;
  const byOutcome = evaluations.reduce<Record<string, number>>((acc, ev) => {
    acc[ev.outcome] = (acc[ev.outcome] ?? 0) + 1;
    return acc;
  }, {});
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
  priorEvaluation: SeasonCampaignEvaluation | null;
  branchEntries: Array<{
    branchId: string;
    state: string;
  }>;
  currentOffers: CampaignCardViewModel[];
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
  const campaign = run.campaign ?? {
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
  };
  const evaluations = campaign.evaluations;
  const priorEvaluation = evaluations.at(-1) ?? null;
  const branchEntries = Object.entries(campaign.branchState).map(([branchId, state]) => ({
    branchId,
    state,
  }));
  const completedBlocks = Math.ceil(run.cursor.completedRounds / 10);
  const targetBlock = nextBlockIndex ?? completedBlocks;
  const isBlock8NoOpportunity = targetBlock === 8;
  const offersForBlock =
    targetBlock >= 0 && targetBlock < 8 ? (campaign.offers[targetBlock] ?? []) : [];
  const selections = campaign.selections;
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
    priorEvaluation,
    branchEntries,
    currentOffers,
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
export function tradeTalksLabel(allowance: number, used: number): string {
  const remaining = Math.max(0, allowance - used);
  if (remaining <= 0) return 'No talks left — +1 for 1◆ or wait.';
  if (remaining === 1) return '1 talk left';
  return `${String(remaining)} talks left`;
}
export interface TradeFitContext {
  outgoingCount?: number;
  incomingCount?: number;
  toFranchiseName?: string | null;
  attemptNumber?: number;
}
function tradeBandOf(fit?: TradeFitContext): { lower: number; upper: number } {
  const is1v1 = fit?.outgoingCount === 1 && fit.incomingCount === 1;
  return is1v1 ? TRADE_BAND_1V1 : TRADE_BAND_DEFAULT;
}
function tradeRatioOf(raw: string): number | null {
  const match = /\bratio\s+(\d{2,6})\b/i.exec(raw);
  if (match?.[1] === undefined) return null;
  const ratio = Number.parseInt(match[1], 10);
  return Number.isFinite(ratio) ? ratio : null;
}
function tradeOverAskMessage(
  team: string,
  ratio: number | null,
  overBy: number | null,
  repeat: boolean,
): string {
  const again = repeat ? 'Still no from' : null;
  if (ratio === null || overBy === null) {
    return again !== null
      ? `${again} ${team} — the mix still isn't right for their roster. Shuffle the pieces and try again.`
      : `${team} passed — the mix isn't right for their roster. Shuffle the pieces and try again.`;
  }
  const pct = Math.round(ratio / 10) - 100;
  if (overBy <= 50) {
    return again !== null
      ? `${again} ${team} — it's close, but the value isn't quite there. Tweak the package or the Influence and go again.`
      : `${team} nearly said yes — the value just isn't quite there. Tweak the package or the Influence and go again.`;
  }
  if (overBy <= 150) {
    return again !== null
      ? `${again} ${team} — you're asking for about ${String(pct)}% more than you're sending. Balance the value and try again.`
      : `${team} turned it down — you're asking for about ${String(pct)}% more than you're sending. Balance the value and try again.`;
  }
  return again !== null
    ? `${again} ${team} — that ask is about ${String(pct)}% richer than your offer. Come back closer to even.`
    : `${team} waved that one off — the ask is about ${String(pct)}% richer than your offer. Come back closer to even.`;
}
function tradeOverpayMessage(ratio: number | null, repeat: boolean): string {
  const short = ratio === null ? null : 100 - Math.round(ratio / 10);
  const gap =
    short === null || short <= 0
      ? "more than's coming back"
      : `about ${String(short)}% more than's coming back`;
  return repeat
    ? `Your staff is still blocking it — you'd be sending out ${gap}. Ask for more, or trim your side.`
    : `Your staff pumped the brakes — you'd be sending out ${gap}. Ask for more, or trim your side.`;
}
export function humanizeTradeRejection(
  error: string | null | undefined,
  names?: {
    playerNameOf?: (playerVersionId: string) => string;
    franchiseNameOf?: (franchiseId: string) => string;
    tradeFit?: TradeFitContext;
  },
): string | null {
  if (error === null || error === undefined) return null;
  const raw = error.trim();
  if (raw.length === 0) return null;
  const lower = raw.toLowerCase();
  const resolveNames = (text: string): string => {
    let out = text;
    out = out.replace(/pv-[a-z0-9_-]{4,64}/gi, (match) => {
      try {
        const name = names?.playerNameOf?.(match);
        if (name !== undefined && name !== match) return name;
      } catch {}
      return 'that player';
    });
    out = out.replace(/\b(prop|inq|off)-[0-9a-f]{8,64}\b/gi, 'this deal');
    out = out.replace(/\bfingerprint\s+[a-z0-9|,._-]{1,128}\b/gi, 'this deal');
    out = out.replace(/\b(at\s+)?revision\s+[0-9a-f-]{1,64}\b/gi, '');
    out = out.replace(/\bexchange\s*#?\d+\b/gi, '');
    out = out.replace(/\s{2,}/g, ' ').trim();
    return out;
  };
  if (
    lower.includes('duplicate') ||
    lower.includes('fingerprint') ||
    lower.includes('already sent')
  ) {
    return 'Already sent this exact deal.';
  }
  if (lower.includes('protected')) {
    return 'Off limits.';
  }
  if (lower.includes('close-needs-more-value') || lower.includes('close needs more value')) {
    return 'They want more value.';
  }
  if (lower.includes('insufficient-talent') || lower.includes('insufficient talent')) {
    const repeat = (names?.tradeFit?.attemptNumber ?? 0) >= 2;
    return tradeOverpayMessage(tradeRatioOf(raw), repeat);
  }
  if (
    lower.includes('wrong-roster-fit') ||
    lower.includes('wrong roster fit') ||
    lower.includes('wrong-fit') ||
    lower.includes('wrong fit')
  ) {
    const fit = names?.tradeFit;
    const team = fit?.toFranchiseName?.trim() ? fit.toFranchiseName.trim() : 'They';
    const repeat = (fit?.attemptNumber ?? 0) >= 2;
    const ratio = tradeRatioOf(raw);
    if (ratio === null) return tradeOverAskMessage(team, null, null, repeat);
    const band = tradeBandOf(fit);
    if (ratio < band.lower) return tradeOverpayMessage(ratio, repeat);
    return tradeOverAskMessage(team, ratio, ratio - band.upper, repeat);
  }
  if (
    lower.includes('unacceptable-injury-risk') ||
    lower.includes('unacceptable injury') ||
    lower.includes('availability-risk') ||
    lower.includes('availability risk')
  ) {
    return 'Availability risk — they’re wary of injuries.';
  }
  if (lower.includes('illegal-roster') || lower.includes('illegal roster')) {
    return 'That would leave a roster illegal.';
  }
  if (lower.includes('roster-illegal') || lower.includes('roster illegal')) {
    return 'That would leave a roster illegal.';
  }
  if (lower.includes('resulting roster 10-15') || lower.includes('must stay 10')) {
    return 'That would leave a roster illegal.';
  }
  if (lower.includes('negotiations-closed') || lower.includes('negotiations closed')) {
    return 'Talks are closed for this window.';
  }
  if (lower.includes('inquiry-cap') || lower.includes('inquiry cap')) {
    return 'No talks left.';
  }
  if (lower.includes('exchange-limit') || lower.includes('exchange limit')) {
    return 'No more offers in this talk.';
  }
  if (lower.includes('cash-cap') || lower.includes('cash cap')) {
    return 'Influence limit reached for this window.';
  }
  if (lower.includes('insufficient-balance') || lower.includes('cannot cover')) {
    return 'Not enough Influence.';
  }
  if (lower.includes('ownership-conflict') || lower.includes('ownership conflict')) {
    return 'Ownership conflict.';
  }
  if (lower.includes('window-not-open') || lower.includes('window not open')) {
    return 'That window isn’t open.';
  }
  if (
    lower.includes('active-negotiation') ||
    lower.includes('active negotiation') ||
    lower.includes('finish the active')
  ) {
    return 'Finish the current talk first.';
  }
  if (
    lower.includes('stale-state') ||
    lower.includes('stale state') ||
    lower.includes('moved on')
  ) {
    return 'The run moved on — refresh and try again.';
  }
  const cleaned = resolveNames(raw);
  if (cleaned !== raw) return cleaned;
  return raw.replace(/\s{2,}/g, ' ').trim();
}
export type TradeWorkspaceStep = 'team' | 'deal' | 'negotiation';
export interface TradePackageDraft {
  partner: string | null;
  outgoing: string[];
  incoming: string[];
  influence: { amount: number; from: string | null };
  validation: { ok: boolean; reason: string | null };
}
export interface PackageConsequenceFacts {
  fromRosterSize: number;
  toRosterSize: number;
  fromAfter: number;
  toAfter: number;
  backfillFrom: number;
  backfillTo: number;
  fromAfterFilled: number;
  toAfterFilled: number;
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
  const backfillFrom = Math.max(0, SEASON_ROSTER_MIN_SIZE - fromAfter);
  const backfillTo = Math.max(0, SEASON_ROSTER_MIN_SIZE - toAfter);
  const fromAfterFilled = fromAfter + backfillFrom;
  const toAfterFilled = toAfter + backfillTo;
  const legal =
    fromAfterFilled >= SEASON_ROSTER_MIN_SIZE &&
    fromAfterFilled <= SEASON_ROSTER_MAX_SIZE &&
    toAfterFilled >= SEASON_ROSTER_MIN_SIZE &&
    toAfterFilled <= SEASON_ROSTER_MAX_SIZE;
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
  const influencePct = input.influenceAmount === 0 ? 0 : Math.min(input.influenceAmount * 8, 16);
  const influenceNote =
    input.influenceAmount === 0
      ? 'No Influence attached'
      : input.influenceFromSender === input.humanFranchiseId
        ? `+${String(input.influenceAmount)} Influence from you (+${String(influencePct)}% value, 3/window cap)`
        : `${String(input.influenceAmount)} Influence from them (−${String(influencePct)}% value, helps when asking more)`;
  return {
    fromRosterSize: input.fromRosterSize,
    toRosterSize: input.toRosterSize,
    fromAfter,
    toAfter,
    backfillFrom,
    backfillTo,
    fromAfterFilled,
    toAfterFilled,
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
  void removedPairs;
  void newPairs;
  return 'New teammates start neutral.';
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
export function rehabPresentationFacts(): {
  cost: number;
  successRate: string;
  successNote: string;
  failureNote: string;
} {
  return {
    cost: 2,
    successRate: '60%',
    successNote: 'Success brings the player back sooner',
    failureNote: 'It can also set the return back',
  };
}
export interface CampaignOpportunityCard {
  opportunityId: string;
  blockIndex: number;
  targetLabel: string;
  conditionLabel: string;
  rewardLabel: string;
  breakthroughLabel: string | null;
  selected: boolean;
}
export interface CampaignHistoryEntry {
  blockIndex: number;
  outcomeLabel: string;
  explanation: string;
}
export function campaignOpportunityCardsOf(
  run: SeasonRun | null,
  nextBlockIndex: number | null,
  playerName: (playerVersionId: string) => string = () => 'Unknown player',
): {
  blockIndex: number | null;
  cards: CampaignOpportunityCard[];
  isFinalBlock: boolean;
} | null {
  if (run === null) return null;
  const campaign = run.campaign;
  if (campaign === undefined) return null;
  const completedBlocks = Math.ceil(run.cursor.completedRounds / 10);
  const targetBlock = nextBlockIndex ?? completedBlocks;
  if (targetBlock >= 8) return { blockIndex: targetBlock, cards: [], isFinalBlock: true };
  if (targetBlock < 0) return { blockIndex: targetBlock, cards: [], isFinalBlock: false };
  const offers = campaign.offers[targetBlock] ?? [];
  const selection = campaign.selections[targetBlock]?.opportunityId ?? null;
  return {
    blockIndex: targetBlock,
    isFinalBlock: false,
    cards: offers.map((opp) => ({
      opportunityId: opp.opportunityId,
      blockIndex: opp.blockIndex,
      targetLabel: formatCampaignCondition(opp.target, playerName),
      conditionLabel: formatCampaignCondition(opp.target, playerName),
      rewardLabel: formatCampaignReward(opp.completedReward),
      breakthroughLabel: opp.breakthroughReward
        ? formatCampaignReward(opp.breakthroughReward)
        : null,
      selected: selection === opp.opportunityId,
    })),
  };
}
export function campaignHistoryOf(run: SeasonRun | null): CampaignHistoryEntry[] {
  if (run === null || run.campaign === undefined) return [];
  return run.campaign.evaluations.map((ev) => ({
    blockIndex: ev.blockIndex,
    outcomeLabel: CAMPAIGN_OUTCOME_LABELS[ev.outcome],
    explanation: ev.explanation,
  }));
}
export function recordRankOutLabel(input: {
  wins: number;
  losses: number;
  rank: number | null;
  conference: 'east' | 'west' | null;
  outCount: number;
}): string {
  const record = recordLabel(input.wins, input.losses);
  const rankPart =
    input.rank !== null && input.conference !== null
      ? ` · ${ordinal(input.rank)} ${input.conference === 'east' ? 'East' : 'West'}`
      : '';
  const outPart = input.outCount > 0 ? ` · ${String(input.outCount)} OUT` : '';
  return `${record}${rankPart}${outPart}`;
}
export function blockOneLiner(input: {
  blockIndex: number;
  fromRound: number;
  toRound: number;
  wins: number;
  losses: number;
}): string {
  return `Block ${String(input.blockIndex + 1)} of 9 · Rds ${String(input.fromRound)}–${String(input.toRound)} · ${recordLabel(input.wins, input.losses)} so far`;
}
export function challengeEvidenceOfRun(
  run: SeasonRun,
  blockIndex: number,
): SeasonBlockChallengeEvidence[] | undefined {
  const challenges = (
    run as unknown as {
      challenges?: {
        evaluations?: Array<{
          blockIndex: number;
          results: Array<{
            challengeId: SeasonBlockChallengeEvidence['challengeId'];
            success: boolean;
            facts: SeasonBlockChallengeEvidence['evaluationFacts'];
          }>;
        }>;
      };
    }
  ).challenges;
  const evaluation = challenges?.evaluations?.find((entry) => entry.blockIndex === blockIndex);
  if (evaluation === undefined) return undefined;
  return [...evaluation.results]
    .sort((a, b) => (a.challengeId < b.challengeId ? -1 : 1))
    .map((result) => ({
      challengeId: result.challengeId,
      success: result.success,
      reward:
        SEASON_CHALLENGE_CATALOG.find((entry) => entry.challengeId === result.challengeId)
          ?.reward ?? 1,
      evaluationFacts: result.facts,
    }));
}
export type RecapChallengeView =
  | { kind: 'challenges'; evidence: SeasonBlockChallengeEvidence[] }
  | { kind: 'legacy-objective'; objectiveId: string; success: boolean };
export function recapChallengeView(recap: SeasonBlockRecap): RecapChallengeView | null {
  const evidence = recap.challengeEvidence ?? [];
  if (evidence.length > 0) return { kind: 'challenges', evidence };
  const legacy = recap.objectiveEvidence ?? null;
  if (legacy !== null)
    return { kind: 'legacy-objective', objectiveId: legacy.objectiveId, success: legacy.success };
  return null;
}
export const TRADE_GRADE_NEUTRAL_FALLBACK = 'Not enough post-trade games to grade.';
export type LeaguePulseEntryKind =
  'threat' | 'streak' | 'trade' | 'signing' | 'rehab' | 'innovation';
export interface LeaguePulseEntry {
  kind: LeaguePulseEntryKind;
  headline: string;
  detail: string;
  franchiseId: string | null;
  blockIndex: number | null;
}
function currentWinStreaks(
  summaries: readonly SeasonGameSummary[],
): Map<string, { kind: 'wins' | 'losses'; length: number }> {
  const byFranchise = new Map<string, { won: boolean }[]>();
  for (const summary of summaries) {
    if (summary.status !== 'final' && summary.status !== 'forfeit') continue;
    let winner: string;
    if (summary.status === 'forfeit') {
      const loser = summary.forfeitLoserFranchiseId;
      if (loser === null) continue;
      winner =
        loser === summary.homeFranchiseId ? summary.awayFranchiseId : summary.homeFranchiseId;
    } else {
      winner =
        summary.homeScore > summary.awayScore ? summary.homeFranchiseId : summary.awayFranchiseId;
    }
    for (const [fid, won] of [
      [summary.homeFranchiseId, winner === summary.homeFranchiseId],
      [summary.awayFranchiseId, winner === summary.awayFranchiseId],
    ] as const) {
      const list = byFranchise.get(fid) ?? [];
      list.push({ won });
      byFranchise.set(fid, list);
    }
  }
  const streaks = new Map<string, { kind: 'wins' | 'losses'; length: number }>();
  for (const [fid, games] of byFranchise) {
    if (games.length === 0) continue;
    const last = games[games.length - 1];
    if (last === undefined) continue;
    let length = 0;
    for (let i = games.length - 1; i >= 0; i -= 1) {
      if (games[i]?.won === last.won) length += 1;
      else break;
    }
    streaks.set(fid, { kind: last.won ? 'wins' : 'losses', length });
  }
  return streaks;
}
export function leaguePulseOf(
  run: SeasonRun | null,
  summaries: readonly SeasonGameSummary[] = [],
  franchiseName: (franchiseId: string) => string = (id) => id,
  limit = 6,
): LeaguePulseEntry[] {
  if (run === null) return [];
  const entries: LeaguePulseEntry[] = [];
  const humanId = run.league.teams.find((team) => team.control === 'human')?.franchiseId ?? null;
  const assignmentById = new Map(
    run.aiAssignments.map((assignment) => [assignment.franchiseId, assignment]),
  );
  const ranked = [...run.standings.rows].sort(
    (a, b) =>
      b.wins - a.wins ||
      b.pointsFor - b.pointsAgainst - (a.pointsFor - a.pointsAgainst) ||
      a.franchiseId.localeCompare(b.franchiseId),
  );
  for (const row of ranked) {
    if (row.franchiseId === humanId) continue;
    if (row.wins + row.losses === 0) continue;
    const assignment = assignmentById.get(row.franchiseId);
    entries.push({
      kind: 'threat',
      headline: `${franchiseName(row.franchiseId)} looms at ${recordLabel(row.wins, row.losses)}`,
      detail:
        assignment === undefined
          ? 'Above you in the standings.'
          : `${assignment.band} · ${assignment.identity}`,
      franchiseId: row.franchiseId,
      blockIndex: null,
    });
    if (entries.filter((entry) => entry.kind === 'threat').length >= 2) break;
  }
  const streaks = currentWinStreaks(summaries);
  const hot = [...streaks.entries()]
    .filter(([, streak]) => streak.kind === 'wins' && streak.length >= 3)
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
    .slice(0, 2);
  for (const [fid, streak] of hot) {
    entries.push({
      kind: 'streak',
      headline: `${franchiseName(fid)} has won ${String(streak.length)} straight`,
      detail: fid === humanId ? 'Your run — protect it.' : 'The league is noticing.',
      franchiseId: fid,
      blockIndex: null,
    });
  }
  const ledger = [...run.transactions]
    .filter((entry) => entry.type !== 'block-grant' && entry.type !== 'initial-grant')
    .sort(
      (a, b) =>
        b.appliedAtStateRevision - a.appliedAtStateRevision ||
        a.transactionId.localeCompare(b.transactionId),
    );
  for (const entry of ledger) {
    if (entries.length >= limit + 4) break;
    if (entry.type === 'trade') {
      entries.push({
        kind: 'trade',
        headline: entry.explanation,
        detail:
          entry.blockIndex === null ? 'Trade window' : `Block ${String(entry.blockIndex + 1)}`,
        franchiseId: entry.franchiseId,
        blockIndex: entry.blockIndex,
      });
    } else if (entry.type === 'free-agent-signing') {
      entries.push({
        kind: 'signing',
        headline: entry.explanation,
        detail: entry.blockIndex === null ? 'Free agency' : `Block ${String(entry.blockIndex + 1)}`,
        franchiseId: entry.franchiseId,
        blockIndex: entry.blockIndex,
      });
    } else if (entry.type === 'influence-spend' && entry.explanation.startsWith('AI ')) {
      entries.push({
        kind: 'rehab',
        headline: entry.explanation,
        detail: 'Rival gamble from the ledger.',
        franchiseId: entry.franchiseId,
        blockIndex: entry.blockIndex,
      });
    }
    if (
      entries.filter(
        (item) => item.kind === 'trade' || item.kind === 'signing' || item.kind === 'rehab',
      ).length >= 3
    ) {
      break;
    }
  }
  const evolution = (
    run as unknown as {
      evolution?: {
        selections?: Record<string, { innovationId: string; aiSelected: boolean } | undefined>;
      } | null;
    }
  ).evolution;
  if (evolution?.selections !== undefined && evolution.selections !== null) {
    for (const [fid, selection] of Object.entries(evolution.selections)) {
      if (selection?.aiSelected !== true || fid === humanId) continue;
      entries.push({
        kind: 'innovation',
        headline: `${franchiseName(fid)} backs ${selection.innovationId}`,
        detail: 'Scouted from their remaining home slate.',
        franchiseId: fid,
        blockIndex: null,
      });
      break;
    }
  }
  return entries.slice(0, limit);
}
export interface TradeGradeViewModel {
  label: string;
  windowLabel: string;
  detail: string;
  neutral: boolean;
}
export function tradeGradeViewModel(grade: SeasonTradeGrade): TradeGradeViewModel {
  const firstReason = grade.reasons[0] ?? null;
  return {
    label: grade.label,
    windowLabel: `Window ${String(grade.windowIndex + 1)}`,
    detail: grade.neutral
      ? TRADE_GRADE_NEUTRAL_FALLBACK
      : (firstReason ?? TRADE_GRADE_NEUTRAL_FALLBACK),
    neutral: grade.neutral,
  };
}
