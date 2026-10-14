import type {
  HavocCuratedRatingBand,
  HavocMultiplayerParticipantId,
  Seed,
} from '@hoop-rush/data-contracts';
import { HAVOC_CURATED_RECIPE, havocMultiplayerCuratedBandsSeed } from '@hoop-rush/data-contracts';
import { swapAt, type Rng } from '../../../sim/rng.ts';

export interface HavocMultiplayerCuratedAssignments {
  readonly p1: readonly HavocCuratedRatingBand[];
  readonly p2: readonly HavocCuratedRatingBand[];
}

/**
 * Curated rating tiers are shuffled independently for each participant from a
 * named seed and then fixed for the whole draft. Index 0 covers the first round
 * (PG), index 4 the fifth (C).
 */
export function havocMultiplayerCuratedAssignments(
  rootSeed: Seed,
  rngFactory: (seed: Seed) => Rng,
): HavocMultiplayerCuratedAssignments {
  const shuffle = (participantId: HavocMultiplayerParticipantId): HavocCuratedRatingBand[] => {
    const rng = rngFactory(havocMultiplayerCuratedBandsSeed(rootSeed, participantId));
    const bands = [...HAVOC_CURATED_RECIPE];
    for (let index = bands.length - 1; index > 0; index -= 1) {
      const swapIndex = rng.nextInt(0, index);
      swapAt(bands, index, swapIndex);
    }
    return bands;
  };
  return { p1: shuffle('p1'), p2: shuffle('p2') };
}
