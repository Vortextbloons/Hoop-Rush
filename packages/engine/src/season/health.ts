import {
  SEASON_GAME_SUMMARY_VERSION,
  commandIdSchema,
  franchiseIdSchema,
  seasonGameIdSchema,
  type Position,
  type SeasonChallengeDeal,
  type SeasonEffectsState,
  type SeasonGameSummary,
  type SeasonHealthState,
  type SeasonInjuryRecord,
  type SeasonObjectiveId,
  type SeasonPendingBlockCandidate,
  type SeasonRetainedGameDetail,
  type SeasonRun,
  type SeasonTeamBox,
} from '@hoop-rush/data-contracts';
import { foldSeasonPlayerAggregates, foldSeasonTeamAggregates } from './aggregates.ts';
import { rollSeasonInjuryForPlayer, seasonPlayerAvailable } from './injuries.ts';
import { chooseInitialUnit, type PlannerRotationContext } from './rotation-planner.ts';
import { reduceSeasonStandings } from './standings.ts';
export type { SeasonInvalidRosterInterruption } from '@hoop-rush/data-contracts';
export type HealthRunView = Pick<
  SeasonRun,
  'runId' | 'rootSeed' | 'league' | 'rosters' | 'rotations' | 'versions'
>;
function targetSecondsOf(
  rotation: SeasonRun['rotations'][number],
  playerVersionId: string,
): number {
  const entry = rotation.targetMinutes.find((row) => row.playerVersionId === playerVersionId);
  return (entry?.minutes ?? 0) * 60;
}
export function seasonFranchiseLegalFiveFacts(
  run: HealthRunView,
  franchiseId: string,
  health: SeasonHealthState,
  positions?: ReadonlyMap<string, readonly Position[]>,
): {
  legal: boolean;
  unavailablePlayerVersionIds: string[];
} {
  const roster = run.rosters.find((entry) => entry.franchiseId === franchiseId);
  const rotation = run.rotations.find((entry) => entry.franchiseId === franchiseId);
  if (roster === undefined || rotation === undefined) {
    throw new Error(`season health: no roster or rotation for ${franchiseId}`);
  }
  const rosterIds = roster.players.map((player) => player.playerVersionId);
  const unavailablePlayerVersionIds = rosterIds.filter(
    (playerVersionId) => !seasonPlayerAvailable(health, playerVersionId),
  );
  const unavailable = new Set(unavailablePlayerVersionIds);
  let legal: boolean;
  if (positions !== undefined) {
    const members = new Map<string, readonly Position[]>();
    const targets = new Map<string, number>();
    for (const playerVersionId of rosterIds) {
      const playable = positions.get(playerVersionId);
      if (playable === undefined) {
        throw new Error(`season health: no positions for ${playerVersionId}`);
      }
      members.set(playerVersionId, playable);
      targets.set(playerVersionId, targetSecondsOf(rotation, playerVersionId));
    }
    const context: PlannerRotationContext = { rotation, members, targets };
    legal = chooseInitialUnit(context, unavailable) !== null;
  } else {
    const startersAvailable = rotation.starters.every(
      (playerVersionId) => !unavailable.has(playerVersionId),
    );
    legal = startersAvailable || rosterIds.length - unavailable.size >= 5;
  }
  return { legal, unavailablePlayerVersionIds };
}
export function seasonPregameAvailabilityOf(
  health: SeasonHealthState,
  players: readonly {
    playerVersionId: string;
  }[],
): ReadonlyMap<string, boolean> {
  const map = new Map<string, boolean>();
  for (const player of players) {
    map.set(player.playerVersionId, seasonPlayerAvailable(health, player.playerVersionId));
  }
  return map;
}
export function seasonGameHealthSeam(
  run: HealthRunView,
  health: SeasonHealthState,
  input: {
    rootSeed: string;
    gameId: string;
    round: number;
    homeFranchiseId: string;
    awayFranchiseId: string;
    targetMinutesByPlayer: ReadonlyMap<string, number>;
    durabilityByPlayer?: ReadonlyMap<string, number>;
    effects?: SeasonEffectsState;
  },
): {
  pregame: ReadonlyMap<string, boolean>;
  removals: readonly {
    playerVersionId: string;
    clock: {
      period: number;
      seconds: number;
    };
    reason: 'injury';
  }[];
  returns: readonly {
    playerVersionId: string;
    clock: {
      period: number;
      seconds: number;
    };
    reason: 'injury-return';
  }[];
  newInjuries: readonly SeasonInjuryRecord[];
} {
  const rosterByFranchise = new Map(run.rosters.map((roster) => [roster.franchiseId, roster]));
  const fatigueOf = new Map<string, number>();
  const loadOf = new Map<string, number>();
  for (const player of input.effects?.playerStates ?? []) {
    fatigueOf.set(player.playerVersionId, player.fatigueBasisPoints);
    loadOf.set(player.playerVersionId, player.recentLoadBasisPoints);
  }
  const recurrenceOf = new Map<string, number>();
  const rehabPremiumOf = new Map<string, number>();
  for (const record of health.injuries) {
    const current = recurrenceOf.get(record.playerVersionId) ?? 0;
    if (record.recurrenceWindowRoundsRemaining > current) {
      recurrenceOf.set(record.playerVersionId, record.recurrenceWindowRoundsRemaining);
    }
    if (
      record.rehabRecurrencePremiumApplied &&
      (record.rehabRecurrencePremiumBasisPoints ?? 0) > 0 &&
      record.recurrenceWindowRoundsRemaining > 0
    ) {
      const curPremium = rehabPremiumOf.get(record.playerVersionId) ?? 0;
      const premium = record.rehabRecurrencePremiumBasisPoints ?? 60;
      if (premium > curPremium) rehabPremiumOf.set(record.playerVersionId, premium);
    }
  }
  const pregame = new Map<string, boolean>();
  const removals: {
    playerVersionId: string;
    clock: {
      period: number;
      seconds: number;
    };
    reason: 'injury';
  }[] = [];
  const returns: {
    playerVersionId: string;
    clock: {
      period: number;
      seconds: number;
    };
    reason: 'injury-return';
  }[] = [];
  const newInjuries: SeasonInjuryRecord[] = [];
  for (const franchiseId of [input.homeFranchiseId, input.awayFranchiseId]) {
    const roster = rosterByFranchise.get(franchiseIdSchema.parse(franchiseId));
    if (roster === undefined) {
      throw new Error(`season health: game ${input.gameId} references roster ${franchiseId}`);
    }
    for (const player of roster.players) {
      const available = seasonPlayerAvailable(health, player.playerVersionId);
      pregame.set(player.playerVersionId, available);
      const targetMinutes = input.targetMinutesByPlayer.get(player.playerVersionId) ?? 0;
      if (targetMinutes <= 0 || !available) continue;
      const roll = rollSeasonInjuryForPlayer({
        rootSeed: input.rootSeed,
        gameId: input.gameId,
        playerVersionId: player.playerVersionId,
        franchiseId,
        durabilityRating: input.durabilityByPlayer?.get(player.playerVersionId) ?? 45,
        fatigueBasisPoints: fatigueOf.get(player.playerVersionId) ?? 0,
        recentLoadBasisPoints: loadOf.get(player.playerVersionId) ?? 0,
        targetMinutes,
        recurrenceWindowRoundsRemaining: recurrenceOf.get(player.playerVersionId) ?? 0,
        rehabPremiumBasisPoints: rehabPremiumOf.get(player.playerVersionId) ?? 0,
      });
      if (!roll.occurred || roll.injury === null) continue;
      newInjuries.push(roll.injury);
      if (roll.removalClock !== null) {
        removals.push({
          playerVersionId: player.playerVersionId,
          clock: { period: roll.removalClock.period, seconds: roll.removalClock.seconds },
          reason: 'injury',
        });
      }
      if (roll.returnClock !== null && roll.injury.sameGameReturn) {
        returns.push({
          playerVersionId: player.playerVersionId,
          clock: { period: roll.returnClock.period, seconds: roll.returnClock.seconds },
          reason: 'injury-return',
        });
      }
    }
  }
  return { pregame, removals, returns, newInjuries };
}
function partialGamesOf(summaries: readonly SeasonGameSummary[]): SeasonRun['games'] {
  return summaries.map((summary) => ({
    gameId: summary.gameId,
    round: summary.round,
    homeFranchiseId: summary.homeFranchiseId,
    awayFranchiseId: summary.awayFranchiseId,
    status: summary.status,
    homeScore: summary.status === 'final' ? summary.homeScore : null,
    awayScore: summary.status === 'final' ? summary.awayScore : null,
    forfeitLoserFranchiseId: summary.forfeitLoserFranchiseId,
  }));
}
export function assembleSeasonPendingBlock(input: {
  run: HealthRunView;
  commandId: string;
  blockIndex: number;
  expectedRevision: number;
  expectedStateRevision: number;
  expectedStateDigest: string;
  objectiveId: SeasonObjectiveId | null;
  challengeDeal?: SeasonChallengeDeal | null;
  challengeIds?: readonly string[] | null;
  campaignOpportunityId?: string | null;
  nextGameId: string;
  summaries: readonly SeasonGameSummary[];
  retainedDetails: readonly SeasonRetainedGameDetail[];
  effects: SeasonEffectsState;
  health: SeasonHealthState;
  rotationDigest: string;
}): SeasonPendingBlockCandidate {
  const run = input.run;
  const games = partialGamesOf(input.summaries);
  const challengeIds =
    input.challengeIds !== undefined &&
    input.challengeIds !== null &&
    input.challengeIds.length === 3
      ? ([...input.challengeIds] as unknown as SeasonPendingBlockCandidate['challengeIds'])
      : undefined;
  return {
    schemaVersion: 1,
    blockVersion: run.versions.blockVersion,
    runId: run.runId,
    commandId: commandIdSchema.parse(input.commandId),
    blockIndex: input.blockIndex,
    expectedRevision: input.expectedRevision,
    expectedStateRevision: input.expectedStateRevision,
    expectedStateDigest: input.expectedStateDigest,
    objectiveId: input.objectiveId,
    challengeDeal: input.challengeDeal ?? null,
    ...(challengeIds !== undefined ? { challengeIds } : {}),
    campaignOpportunityId:
      (
        input as unknown as {
          campaignOpportunityId?: string | null;
        }
      ).campaignOpportunityId ?? null,
    nextGameId: seasonGameIdSchema.parse(input.nextGameId),
    summaries: [...input.summaries],
    retainedDetails: [...input.retainedDetails],
    effects: input.effects,
    health: input.health,
    standings: reduceSeasonStandings(run.league, games),
    teamAggregates: foldSeasonTeamAggregates(input.summaries),
    playerAggregates: foldSeasonPlayerAggregates(input.summaries),
    rotationDigest: input.rotationDigest,
  };
}
function zeroTeamBox(franchiseId: string): SeasonTeamBox {
  return {
    franchiseId: franchiseIdSchema.parse(franchiseId),
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
}
export function seasonForfeitSummaryForGame(
  run: SeasonRun,
  gameId: string,
  humanFranchiseId: string,
): SeasonGameSummary {
  const game = run.games.find((entry) => entry.gameId === gameId);
  if (game === undefined) {
    throw new Error(`season forfeit: game ${gameId} is not in the run schedule`);
  }
  const humanIsHome = game.homeFranchiseId === humanFranchiseId;
  return {
    schemaVersion: 1,
    summaryVersion: SEASON_GAME_SUMMARY_VERSION,
    gameId: game.gameId,
    round: game.round,
    homeFranchiseId: game.homeFranchiseId,
    awayFranchiseId: game.awayFranchiseId,
    status: 'forfeit',
    overtimePeriods: 0,
    homeScore: humanIsHome ? 0 : 2,
    awayScore: humanIsHome ? 2 : 0,
    forfeitLoserFranchiseId: franchiseIdSchema.parse(humanFranchiseId),
    homeBox: zeroTeamBox(game.homeFranchiseId),
    awayBox: zeroTeamBox(game.awayFranchiseId),
    homePlayers: [],
    awayPlayers: [],
    injuryEvents: [],
  };
}
export function advancePendingAfterForfeit(
  pending: SeasonPendingBlockCandidate,
  forfeitedGameId: string,
): SeasonPendingBlockCandidate {
  const gameNumber = Number.parseInt(forfeitedGameId.slice(1), 10);
  if (!Number.isInteger(gameNumber) || gameNumber < 1) {
    throw new Error(`season forfeit: malformed game id ${forfeitedGameId}`);
  }
  const blockEndNumber = pending.blockIndex >= 8 ? 1230 : (pending.blockIndex + 1) * 150;
  const nextNumber = gameNumber + 1;
  if (nextNumber > blockEndNumber) {
    throw new Error(
      `season forfeit: ${forfeitedGameId} is the last game of block ${String(pending.blockIndex)}; the block is complete and has no next game`,
    );
  }
  return {
    ...pending,
    summaries: [...pending.summaries],
    retainedDetails: [...pending.retainedDetails],
    nextGameId: seasonGameIdSchema.parse(`s${String(nextNumber).padStart(6, '0')}`),
  };
}
