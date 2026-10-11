import {
  SEASON_SEED_NAMESPACES,
  type SeasonEffectsState,
  type SeasonHealthState,
  type SeasonRun,
} from '@hoop-rush/data-contracts';
import { seasonGameHealthSeamWithRoll, type SeasonGameHealthSeamResult } from '../health.ts';
import {
  rollInjuryWithSeedNamespace,
  rollRehabOutcomeWithSeedNamespace,
  type SeasonInjuryRollInput,
  type SeasonInjuryRollResult,
} from '../injuries.ts';
import { SeasonPostseasonInvariantError } from './errors.ts';
export function rollPostseasonInjuryForPlayer(
  input: SeasonInjuryRollInput,
): SeasonInjuryRollResult {
  return rollInjuryWithSeedNamespace(SEASON_SEED_NAMESPACES.postseasonInjuries, input, 0);
}
export function rollPostseasonRehabOutcome(
  rootSeed: string,
  injuryId: string,
): 'success' | 'failure' {
  return rollRehabOutcomeWithSeedNamespace(
    SEASON_SEED_NAMESPACES.postseasonInjuries,
    rootSeed,
    injuryId,
  );
}
export function postseasonGameHealthSeam(input: {
  run: SeasonRun;
  health: SeasonHealthState;
  gameId: string;
  homeFranchiseId: string;
  awayFranchiseId: string;
  targetMinutesByPlayer: ReadonlyMap<string, number>;
  durabilityByPlayer?: ReadonlyMap<string, number>;
  effects?: SeasonEffectsState;
}): SeasonGameHealthSeamResult {
  return seasonGameHealthSeamWithRoll({
    run: input.run,
    health: input.health,
    rootSeed: input.run.rootSeed,
    gameId: input.gameId,
    homeFranchiseId: input.homeFranchiseId,
    awayFranchiseId: input.awayFranchiseId,
    targetMinutesByPlayer: input.targetMinutesByPlayer,
    durabilityByPlayer: input.durabilityByPlayer,
    effects: input.effects,
    rollInjury: rollPostseasonInjuryForPlayer,
    missingRosterError: (franchiseId) =>
      new SeasonPostseasonInvariantError(`game ${input.gameId} references roster ${franchiseId}`),
  });
}
