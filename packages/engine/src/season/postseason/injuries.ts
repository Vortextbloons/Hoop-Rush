import {
  SEASON_ENDING_MISSED_GAMES_SENTINEL,
  SEASON_SEED_NAMESPACES,
  franchiseIdSchema,
  seasonNamespaceSeed,
  type SeasonEffectsState,
  type SeasonHealthState,
  type SeasonInjuryRecord,
  type SeasonInjurySeverity,
  type SeasonInjuryType,
  type SeasonRun,
} from '@hoop-rush/data-contracts';
import { HALFTIME_SECOND, REGULATION_TOTAL_SECONDS } from '../../sim/clock.ts';
import {
  SEASON_INJURY_MAJOR_BP,
  SEASON_INJURY_MINOR_BP,
  SEASON_INJURY_MODERATE_BP,
  SEASON_INJURY_RECOVERY_RANGES,
  SEASON_INJURY_REHAB_SUCCESS_BP,
  SEASON_INJURY_SAME_GAME_RETURN_BP,
  clockFromTipoffSeconds,
  seasonInjuryIdOf,
  seasonInjuryRiskBasisPoints,
  seasonPlayerAvailable,
  type SeasonInjuryRollInput,
  type SeasonInjuryRollResult,
} from '../injuries.ts';
import { drawHexInt } from '../season-seeds.ts';
import { SeasonPostseasonInvariantError } from './errors.ts';
const POSTSEASON_INJURY_TYPES: readonly SeasonInjuryType[] = [
  'lower-body',
  'soft-tissue',
  'upper-body',
  'illness',
];
function postseasonInjurySeed(rootSeed: string, ...keys: string[]): string {
  return seasonNamespaceSeed(rootSeed, SEASON_SEED_NAMESPACES.postseasonInjuries, ...keys);
}
function drawU32(seed: string): number {
  return drawHexInt(seed) >>> 0;
}
function drawBp(seed: string, thresholdBp: number): boolean {
  return drawU32(seed) % 10000 < thresholdBp;
}
function uniformInt(seed: string, min: number, max: number): number {
  return min + (drawU32(seed) % (max - min + 1));
}
export function rollPostseasonInjuryForPlayer(
  input: SeasonInjuryRollInput,
): SeasonInjuryRollResult {
  const riskBasisPoints = seasonInjuryRiskBasisPoints(input);
  const occurrenceSeed = postseasonInjurySeed(
    input.rootSeed,
    input.gameId,
    input.playerVersionId,
    'occurrence',
  );
  if (!drawBp(occurrenceSeed, riskBasisPoints)) {
    return {
      riskBasisPoints,
      occurred: false,
      removalClock: null,
      returnClock: null,
      injury: null,
    };
  }
  const severitySeed = postseasonInjurySeed(
    input.rootSeed,
    input.gameId,
    input.playerVersionId,
    'severity',
  );
  const severityRoll = drawU32(severitySeed) % 10000;
  const severity: SeasonInjurySeverity =
    severityRoll < SEASON_INJURY_MINOR_BP
      ? 'minor'
      : severityRoll < SEASON_INJURY_MODERATE_BP
        ? 'moderate'
        : severityRoll < SEASON_INJURY_MAJOR_BP
          ? 'major'
          : 'season-ending';
  const typeSeed = postseasonInjurySeed(
    input.rootSeed,
    input.gameId,
    input.playerVersionId,
    'type',
  );
  const type =
    POSTSEASON_INJURY_TYPES[uniformInt(typeSeed, 0, POSTSEASON_INJURY_TYPES.length - 1)] ??
    'lower-body';
  const clockSeed = postseasonInjurySeed(
    input.rootSeed,
    input.gameId,
    input.playerVersionId,
    'clock',
  );
  const exposureSeconds = uniformInt(
    clockSeed,
    0,
    Math.min(Math.max(0, input.targetMinutes) * 60, REGULATION_TOTAL_SECONDS),
  );
  const removalClock = clockFromTipoffSeconds(exposureSeconds);
  const occurredBeforeHalftime = exposureSeconds < HALFTIME_SECOND;
  const sameGameReturnSeed = postseasonInjurySeed(
    input.rootSeed,
    input.gameId,
    input.playerVersionId,
    'same-game-return',
  );
  const sameGameReturn =
    severity === 'minor' &&
    occurredBeforeHalftime &&
    drawBp(sameGameReturnSeed, SEASON_INJURY_SAME_GAME_RETURN_BP);
  const returnSeed = postseasonInjurySeed(
    input.rootSeed,
    input.gameId,
    input.playerVersionId,
    'return',
  );
  let returnClock: {
    period: number;
    seconds: number;
  } | null = null;
  let missedGamesTotal = 0;
  if (sameGameReturn) {
    returnClock = clockFromTipoffSeconds(
      uniformInt(returnSeed, HALFTIME_SECOND, REGULATION_TOTAL_SECONDS),
    );
  } else if (severity === 'season-ending') {
    missedGamesTotal = SEASON_ENDING_MISSED_GAMES_SENTINEL;
  } else {
    const range = SEASON_INJURY_RECOVERY_RANGES[severity];
    missedGamesTotal = uniformInt(returnSeed, range[0], range[1]);
  }
  const seedPath = [
    SEASON_SEED_NAMESPACES.postseasonInjuries,
    input.gameId,
    input.playerVersionId,
    'occurrence',
  ];
  const injury: SeasonInjuryRecord = {
    injuryId: seasonInjuryIdOf(seedPath),
    playerVersionId: input.playerVersionId,
    franchiseId: franchiseIdSchema.parse(input.franchiseId),
    gameId: input.gameId,
    type,
    severity,
    occurredBeforeHalftime,
    sameGameReturn,
    sameGameReturned: null,
    missedGamesTotal,
    missedGamesRemaining: missedGamesTotal,
    actualReturnRound: null,
    seasonEnding: severity === 'season-ending',
    rehabModifier: 0,
    recurrenceWindowRoundsRemaining: 0,
    seedPath,
  };
  return { riskBasisPoints, occurred: true, removalClock, returnClock, injury };
}
export function rollPostseasonRehabOutcome(
  rootSeed: string,
  injuryId: string,
): 'success' | 'failure' {
  const seed = postseasonInjurySeed(rootSeed, injuryId, 'rehab');
  return drawBp(seed, SEASON_INJURY_REHAB_SUCCESS_BP) ? 'success' : 'failure';
}
export function postseasonGameHealthSeam(input: {
  run: SeasonRun;
  health: SeasonHealthState;
  gameId: string;
  round: number;
  homeFranchiseId: string;
  awayFranchiseId: string;
  targetMinutesByPlayer: ReadonlyMap<string, number>;
  durabilityByPlayer?: ReadonlyMap<string, number>;
  effects?: SeasonEffectsState;
}): {
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
  const rosterByFranchise = new Map(
    input.run.rosters.map((roster) => [roster.franchiseId, roster]),
  );
  const fatigueOf = new Map<string, number>();
  const loadOf = new Map<string, number>();
  for (const player of input.effects?.playerStates ?? []) {
    fatigueOf.set(player.playerVersionId, player.fatigueBasisPoints);
    loadOf.set(player.playerVersionId, player.recentLoadBasisPoints);
  }
  const recurrenceOf = new Map<string, number>();
  for (const record of input.health.injuries) {
    const current = recurrenceOf.get(record.playerVersionId) ?? 0;
    if (record.recurrenceWindowRoundsRemaining > current) {
      recurrenceOf.set(record.playerVersionId, record.recurrenceWindowRoundsRemaining);
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
    const franchiseKey = franchiseIdSchema.parse(franchiseId);
    const roster = rosterByFranchise.get(franchiseKey);
    if (roster === undefined) {
      throw new SeasonPostseasonInvariantError(
        `game ${input.gameId} references roster ${franchiseId}`,
      );
    }
    for (const player of roster.players) {
      const available = seasonPlayerAvailable(input.health, player.playerVersionId);
      pregame.set(player.playerVersionId, available);
      const targetMinutes = input.targetMinutesByPlayer.get(player.playerVersionId) ?? 0;
      if (targetMinutes <= 0 || !available) continue;
      const roll = rollPostseasonInjuryForPlayer({
        rootSeed: input.run.rootSeed,
        gameId: input.gameId,
        playerVersionId: player.playerVersionId,
        franchiseId,
        durabilityRating: input.durabilityByPlayer?.get(player.playerVersionId) ?? 45,
        fatigueBasisPoints: fatigueOf.get(player.playerVersionId) ?? 0,
        recentLoadBasisPoints: loadOf.get(player.playerVersionId) ?? 0,
        targetMinutes,
        recurrenceWindowRoundsRemaining: recurrenceOf.get(player.playerVersionId) ?? 0,
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
