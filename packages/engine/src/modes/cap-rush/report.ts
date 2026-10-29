import type {
  CapRushLockedInputs,
  CapRushMvpEntry,
  CapRushPlayerSeasonLine,
  CapRushPostseason,
  CapRushPostseasonReport,
  CapRushReport,
  CapRushSeasonAggregate,
  CapRushStoredGame,
  HavocParticipantLine,
  HavocTeamResult,
  LeaguePlayerTotals,
  LeagueRecord,
  PlayerBoxScore,
} from '@hoop-rush/data-contracts';
import {
  CAP_RUSH_CAP_LINE_DOLLARS,
  CAP_RUSH_GAME_COUNT,
  CAP_RUSH_REPORT_VERSION,
  CAP_RUSH_SCHEMA_VERSION,
  CAP_RUSH_USER_TEAM_ID,
  POSITIONS,
  capRushReportSchema,
  playerIdSchema,
} from '@hoop-rush/data-contracts';
import {
  accumulateLeagueAppearance,
  emptyLeaguePlayerTotals,
} from '../../challenge/league-value.ts';

const CONSISTENCY_PENALTY = 0.08;

function userTeamResult(game: CapRushStoredGame): HavocTeamResult {
  return game.summary.humanHome ? game.result.home : game.result.away;
}

function opponentTeamResult(game: CapRushStoredGame): HavocTeamResult {
  return game.summary.humanHome ? game.result.away : game.result.home;
}

interface SlotTotals {
  gamesPlayed: number;
  minutes: number;
  points: number;
  rebounds: number;
  assists: number;
  steals: number;
  blocks: number;
  turnovers: number;
  fouls: number;
  fieldGoalsMade: number;
  fieldGoalsAttempted: number;
  threesMade: number;
  threesAttempted: number;
  freeThrowsMade: number;
  freeThrowsAttempted: number;
  adjustments: number;
}

function emptySlotTotals(): SlotTotals {
  return {
    gamesPlayed: 0,
    minutes: 0,
    points: 0,
    rebounds: 0,
    assists: 0,
    steals: 0,
    blocks: 0,
    turnovers: 0,
    fouls: 0,
    fieldGoalsMade: 0,
    fieldGoalsAttempted: 0,
    threesMade: 0,
    threesAttempted: 0,
    freeThrowsMade: 0,
    freeThrowsAttempted: 0,
    adjustments: 0,
  };
}

function accumulateLine(totals: SlotTotals, line: HavocParticipantLine): void {
  totals.minutes += line.minutes;
  totals.points += line.points;
  totals.rebounds += line.rebounds.total;
  totals.assists += line.assists;
  totals.steals += line.steals;
  totals.blocks += line.blocks;
  totals.turnovers += line.turnovers;
  totals.fouls += line.fouls;
  totals.fieldGoalsMade += line.fieldGoals.made;
  totals.fieldGoalsAttempted += line.fieldGoals.attempted;
  totals.threesMade += line.threes.made;
  totals.threesAttempted += line.threes.attempted;
  totals.freeThrowsMade += line.freeThrows.made;
  totals.freeThrowsAttempted += line.freeThrows.attempted;
  totals.adjustments += line.adjustments;
}

export function capRushPlayerSeasonLines(input: {
  readonly locked: CapRushLockedInputs;
  readonly games: readonly CapRushStoredGame[];
}): CapRushPlayerSeasonLine[] {
  const bySlot = new Map<string, SlotTotals>();
  for (const pick of input.locked.picks) bySlot.set(pick.slot, emptySlotTotals());
  const slotOfInstance = new Map<string, string>();
  for (const starter of input.locked.human.starters) {
    slotOfInstance.set(starter.instanceId, starter.slot);
  }
  for (const replacement of input.locked.human.replacements) {
    slotOfInstance.set(replacement.instanceId, replacement.slot);
  }
  for (const game of input.games) {
    const team = userTeamResult(game);
    const appeared = new Set<string>();
    for (const line of team.participants) {
      const slot = slotOfInstance.get(line.instanceId);
      if (slot === undefined) continue;
      const totals = bySlot.get(slot);
      if (totals === undefined) continue;
      accumulateLine(totals, line);
      appeared.add(slot);
    }
    for (const slot of appeared) {
      const totals = bySlot.get(slot);
      if (totals !== undefined) totals.gamesPlayed += 1;
    }
  }
  return input.locked.picks
    .slice()
    .sort((left, right) => POSITIONS.indexOf(left.slot) - POSITIONS.indexOf(right.slot))
    .map((pick) => {
      const totals = bySlot.get(pick.slot) ?? emptySlotTotals();
      return {
        slot: pick.slot,
        cardId: pick.cardId,
        playerId: pick.playerId,
        playerVersionId: pick.playerVersionId,
        displayName: pickNameOf(input.locked, pick.playerId, pick.slot),
        salaryDollars: pick.salaryDollars,
        ...totals,
      };
    });
}

function pickNameOf(locked: CapRushLockedInputs, playerId: string, slot: string): string {
  const starter = locked.human.starters.find(
    (candidate) => candidate.slot === slot && candidate.source.playerId === playerId,
  );
  return starter?.source.displayName ?? playerId;
}

export interface CapRushLeagueBaseline {
  readonly leagueBaselineTs: number;
  readonly mvp: CapRushMvpEntry | null;
  readonly hasMutationScoring: boolean;
}

/**
 * League MVP over the five signed slots plus the frozen opponents, using the
 * shared value formulas. Team-only scoring stays on the team and never enters a
 * participant total.
 */
export function capRushLeagueMvp(input: {
  readonly locked: CapRushLockedInputs;
  readonly games: readonly CapRushStoredGame[];
  readonly league?: LeagueRecord | null | undefined;
}): CapRushLeagueBaseline {
  const totals = new Map<string, LeaguePlayerTotals>();
  const names = new Map<string, string>();
  const teamNames = new Map<string, string>();
  const slots = new Map<string, string>();

  for (const opponent of input.locked.opponents) {
    teamNames.set(opponent.team.teamId, opponent.team.displayName);
    for (const starter of opponent.team.starters) {
      names.set(`${opponent.team.teamId}:${starter.source.playerId}`, starter.source.displayName);
    }
  }
  teamNames.set(input.locked.human.teamId, input.locked.human.displayName);
  for (const starter of input.locked.human.starters) {
    names.set(
      `${input.locked.human.teamId}:${starter.source.playerId}`,
      starter.source.displayName,
    );
  }
  if (input.league !== undefined && input.league !== null) {
    for (const entry of input.league.players) {
      totals.set(`${entry.teamId}:${entry.playerId}`, { ...entry });
    }
  }

  const foldSide = (side: HavocTeamResult, won: boolean): void => {
    teamNames.set(side.teamId, side.displayName);
    for (const line of side.participants) {
      const key = `${side.teamId}:${line.sourcePlayerId}`;
      const existing = totals.get(key) ?? emptyLeaguePlayerTotals(side.teamId, line.sourcePlayerId);
      accumulateLeagueAppearance(existing, boxOfLine(line), won);
      totals.set(key, existing);
      names.set(key, line.displayName);
      if (side.teamId === input.locked.human.teamId) slots.set(key, line.slot);
    }
  };

  let hasMutationScoring = false;
  for (const game of input.games) {
    const human = userTeamResult(game);
    const opponent = opponentTeamResult(game);
    foldSide(human, game.summary.won);
    foldSide(opponent, !game.summary.won);
    if (game.result.home.adjustments !== 0 || game.result.away.adjustments !== 0) {
      hasMutationScoring = true;
    }
  }
  if (totals.size === 0) {
    return { leagueBaselineTs: 0.5, mvp: null, hasMutationScoring };
  }
  let leaguePoints = 0;
  let leagueShots = 0;
  for (const entry of totals.values()) {
    leaguePoints += entry.totalPoints;
    leagueShots += entry.totalShots;
  }
  const leagueBaselineTs = leagueShots > 0 ? leaguePoints / (2 * leagueShots) : 0.5;

  const ranked: Array<CapRushMvpEntry & { averageCombined: number }> = [];
  for (const [key, entry] of totals) {
    if (entry.games <= 0) continue;
    const meanValue = (entry.totalValueBase - leagueBaselineTs * entry.totalShots) / entry.games;
    const variance = Math.max(
      0,
      (entry.totalValueBaseSquared -
        2 * leagueBaselineTs * entry.totalValueShots +
        leagueBaselineTs * leagueBaselineTs * entry.totalShotsSquared) /
        entry.games -
        meanValue * meanValue,
    );
    const standardDeviation = Math.sqrt(variance);
    const isUserTeam = entry.teamId === CAP_RUSH_USER_TEAM_ID;
    const slot = slots.get(key);
    ranked.push({
      playerId: entry.playerId,
      displayName: names.get(key) ?? entry.playerId,
      teamId: entry.teamId,
      teamName: teamNames.get(entry.teamId) ?? entry.teamId,
      isUserTeam,
      slot: slot === undefined ? null : (slot as CapRushMvpEntry['slot']),
      appearances: entry.games,
      mvpScore: meanValue - CONSISTENCY_PENALTY * standardDeviation,
      averageGameScore: entry.totalGameScore / entry.games,
      averageEfficiency: entry.totalTrueShooting / entry.games,
      consistency: standardDeviation,
      averagePoints: entry.totalPoints / entry.games,
      averageRebounds: entry.totalRebounds / entry.games,
      averageAssists: entry.totalAssists / entry.games,
      averageSteals: entry.totalSteals / entry.games,
      averageBlocks: entry.totalBlocks / entry.games,
      averageCombined:
        (entry.totalRebounds + entry.totalAssists + entry.totalSteals + entry.totalBlocks) /
        entry.games,
    });
  }
  ranked.sort((left, right) => {
    if (right.mvpScore !== left.mvpScore) return right.mvpScore - left.mvpScore;
    if (right.averageGameScore !== left.averageGameScore) {
      return right.averageGameScore - left.averageGameScore;
    }
    if (right.averagePoints !== left.averagePoints) return right.averagePoints - left.averagePoints;
    if (right.averageCombined !== left.averageCombined) {
      return right.averageCombined - left.averageCombined;
    }
    const teamOrder = left.teamId.localeCompare(right.teamId);
    return teamOrder !== 0 ? teamOrder : left.playerId.localeCompare(right.playerId);
  });
  const winner = ranked[0];
  if (winner === undefined) {
    return { leagueBaselineTs, mvp: null, hasMutationScoring };
  }
  const { averageCombined, ...mvp } = winner;
  void averageCombined;
  return { leagueBaselineTs, mvp, hasMutationScoring };
}

function boxOfLine(line: HavocParticipantLine): PlayerBoxScore {
  return {
    playerId: playerIdSchema.parse(line.sourcePlayerId),
    minutes: line.minutes,
    points: Math.max(0, line.points),
    fieldGoals: line.fieldGoals,
    threes: line.threes,
    freeThrows: line.freeThrows,
    rebounds: {
      total: line.rebounds.total,
      offensive: line.rebounds.offensive,
      defensive: line.rebounds.defensive,
    },
    assists: line.assists,
    steals: line.steals,
    blocks: line.blocks,
    turnovers: line.turnovers,
    fouls: line.fouls,
  };
}

export function capRushWinsPerMillion(wins: number, payrollDollars: number): number | null {
  if (payrollDollars <= 0) return null;
  return wins / (payrollDollars / 1_000_000);
}

function postseasonReportOf(
  postseason: CapRushPostseason,
  locked: CapRushLockedInputs,
): CapRushPostseasonReport {
  if (
    postseason.standings === null ||
    postseason.championTeamId === null ||
    postseason.finalsMvp === null
  ) {
    throw new Error('cap rush report requires a completed postseason');
  }
  const champion = postseason.standings.entries.find(
    (entry) => entry.teamId === postseason.championTeamId,
  );
  if (champion === undefined) {
    throw new Error('cap rush report: the champion is missing from the standings');
  }
  const userEntry = postseason.standings.entries.find(
    (entry) => entry.teamId === locked.human.teamId,
  );
  return {
    championTeamId: champion.teamId,
    championName: champion.displayName,
    isUserChampion: champion.teamId === locked.human.teamId,
    userOutcome: postseason.userOutcome,
    seed: userEntry?.seed ?? null,
    series: postseason.series,
    standings: postseason.standings,
    finalsMvp: postseason.finalsMvp,
  };
}

export function capRushReport(input: {
  readonly locked: CapRushLockedInputs;
  readonly games: readonly CapRushStoredGame[];
  readonly aggregate: CapRushSeasonAggregate;
  readonly apronTriggers: { readonly isolations: number; readonly strikes: number };
  readonly postseason?: CapRushPostseason | null | undefined;
}): CapRushReport {
  if (input.games.length !== CAP_RUSH_GAME_COUNT) {
    throw new Error(
      `cap rush report requires ${String(CAP_RUSH_GAME_COUNT)} accepted games (got ${String(input.games.length)})`,
    );
  }
  const payrollDollars = input.locked.payrollDollars;
  const spin = input.locked.spin;
  const additionalSpins = input.locked.additionalSpins ?? [];
  const spinSpendDollars =
    (spin?.priceDollars ?? 0) +
    additionalSpins.reduce((total, receipt) => total + receipt.priceDollars, 0);
  const league = capRushLeagueMvp({
    locked: input.locked,
    games: input.games,
    league: input.postseason?.standings?.league.league ?? null,
  });
  return capRushReportSchema.parse({
    reportVersion: CAP_RUSH_REPORT_VERSION,
    schemaVersion: CAP_RUSH_SCHEMA_VERSION,
    runId: input.locked.runId,
    runSeed: input.locked.runSeed,
    variant: input.locked.variant,
    payrollStatus: input.locked.payrollStatus,
    payrollDollars,
    spinSpendDollars,
    totalSpendDollars: payrollDollars + spinSpendDollars,
    unusedCapDollars: CAP_RUSH_CAP_LINE_DOLLARS - payrollDollars - spinSpendDollars,
    winsPerMillion: capRushWinsPerMillion(input.aggregate.wins, payrollDollars),
    aggregate: input.aggregate,
    apronTriggers: {
      isolations: input.apronTriggers.isolations,
      strikes: input.apronTriggers.strikes,
    },
    targetSlot: input.locked.target.slot,
    targetInstanceId: input.locked.target.instanceId,
    spin:
      spin === null
        ? null
        : {
            purchase: spin.purchase,
            priceDollars: spin.priceDollars,
            tier: spin.tier,
            mutationId: spin.entry.mutationId,
            targetCardId: spin.target.cardId,
          },
    ...(additionalSpins.length
      ? {
          additionalSpins: additionalSpins.map((receipt) => ({
            purchase: receipt.purchase,
            priceDollars: receipt.priceDollars,
            tier: receipt.tier,
            mutationId: receipt.entry.mutationId,
            targetCardId: receipt.target.cardId,
          })),
        }
      : {}),
    players: capRushPlayerSeasonLines({ locked: input.locked, games: input.games }),
    mvp: league.mvp,
    leagueBaselineTs: league.leagueBaselineTs,
    hasMutationScoring: league.hasMutationScoring,
    games: input.games.map((game) => game.summary),
    ...(input.postseason === undefined || input.postseason === null
      ? {}
      : { postseason: postseasonReportOf(input.postseason, input.locked) }),
  });
}
