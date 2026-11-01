import type {
  CapRushPayrollStatus,
  CapRushSourcePlayer,
  HavocEffectiveProfile,
  HavocMutationPackage,
  HavocSourcePlayer,
  Position,
} from '@hoop-rush/data-contracts';
import { havocEffectiveProfileSchema } from '@hoop-rush/data-contracts';
import { applyHavocMutationPackage } from '../havoc/transform.ts';
import { capRushEffectiveRatings } from './salary.ts';

export function capRushHavocSourceOf(player: CapRushSourcePlayer): HavocSourcePlayer {
  return {
    playerId: player.playerId,
    playerVersionId: player.playerVersionId,
    displayName: player.displayName,
    franchiseId: player.franchiseId,
    eraId: player.eraId,
    seasonKey: player.seasonKey,
    positions: player.positions,
    originalOverall: player.originalOverall,
    overallSource: 'catalog',
    profile: player.profile,
    physical: player.physical,
  };
}

export function capRushEffectiveProfileOf(input: {
  readonly player: CapRushSourcePlayer;
  readonly slot: Position;
  readonly payrollStatus: CapRushPayrollStatus;
  readonly mutationPackage: HavocMutationPackage;
}): HavocEffectiveProfile {
  const mutated = applyHavocMutationPackage(
    capRushHavocSourceOf(input.player),
    input.mutationPackage,
    { slot: input.slot },
  );
  return havocEffectiveProfileSchema.parse({
    ...mutated,
    ratings: capRushEffectiveRatings(mutated.ratings, input.payrollStatus),
  });
}
