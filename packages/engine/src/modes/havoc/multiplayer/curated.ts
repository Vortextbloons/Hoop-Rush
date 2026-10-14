import type {
  HavocAdaptedCandidate,
  HavocCuratedRatingBand,
  HavocMultiplayerParticipantId,
  Position,
  Seed,
} from '@hoop-rush/data-contracts';
import {
  HAVOC_CURATED_RECIPE,
  havocMultiplayerCuratedBandsSeed,
  havocOverallInCuratedBand,
} from '@hoop-rush/data-contracts';
import { swapAt } from '../../../sim/rng.ts';
import type { HavocDraftEnvironment } from '../api.ts';

export interface HavocMultiplayerSeasonUnit {
  readonly seasonKey: string;
  readonly claimKey: string;
  readonly playableSlots: readonly Position[];
  readonly variants: readonly HavocAdaptedCandidate[];
}

export interface HavocMultiplayerPersonGroup {
  readonly playerId: string;
  readonly playableSlots: readonly Position[];
  readonly units: readonly HavocMultiplayerSeasonUnit[];
}

export interface HavocMultiplayerCuratedAssignments {
  readonly p1: readonly HavocCuratedRatingBand[];
  readonly p2: readonly HavocCuratedRatingBand[];
}

/**
 * Curated rating tiers are shuffled independently for each participant from a
 * named seed, then fixed for the whole draft. Index 0 fills the first round
 * (PG), index 4 the fifth (C).
 */
export function havocMultiplayerCuratedAssignments(
  rootSeed: Seed,
  environment: HavocDraftEnvironment,
): HavocMultiplayerCuratedAssignments {
  const shuffle = (participantId: HavocMultiplayerParticipantId): HavocCuratedRatingBand[] => {
    const rng = environment.rngFactory(havocMultiplayerCuratedBandsSeed(rootSeed, participantId));
    const bands = [...HAVOC_CURATED_RECIPE];
    for (let index = bands.length - 1; index > 0; index -= 1) {
      const swapIndex = rng.nextInt(0, index);
      swapAt(bands, index, swapIndex);
    }
    return bands;
  };
  return { p1: shuffle('p1'), p2: shuffle('p2') };
}

export interface HavocMultiplayerDraftRequirement {
  readonly slot: Position;
  readonly band: HavocCuratedRatingBand | null;
}

export function personFillsRequirement(
  person: HavocMultiplayerPersonGroup,
  requirement: HavocMultiplayerDraftRequirement,
): boolean {
  const band = requirement.band;
  if (band === null) return person.playableSlots.includes(requirement.slot);
  return person.units.some((unit) =>
    unit.variants.some(
      (version) =>
        version.positions.includes(requirement.slot) &&
        havocOverallInCuratedBand(version.originalOverall, band),
    ),
  );
}

/**
 * Kuhn-style matching of remaining draft requirements to distinct people.
 * Each future pick contributes one (position, tier) requirement; a person can
 * serve at most one requirement, so both teams stay completable.
 */
export function matchRequirements(
  requirements: readonly HavocMultiplayerDraftRequirement[],
  persons: readonly HavocMultiplayerPersonGroup[],
  fills: (personIndex: number, requirementIndex: number) => boolean,
  excludedPersonIndex: number,
): boolean {
  const assignment = new Map<number, number>();
  for (let requirementIndex = 0; requirementIndex < requirements.length; requirementIndex += 1) {
    if (requirements[requirementIndex] === undefined) return false;
    const visited = new Set<number>();
    const search = (currentRequirementIndex: number): boolean => {
      for (let personIndex = 0; personIndex < persons.length; personIndex += 1) {
        if (personIndex === excludedPersonIndex) continue;
        if (visited.has(personIndex)) continue;
        if (!fills(personIndex, currentRequirementIndex)) continue;
        visited.add(personIndex);
        const matched = assignment.get(personIndex);
        if (matched === undefined || search(matched)) {
          assignment.set(personIndex, currentRequirementIndex);
          return true;
        }
      }
      return false;
    };
    if (!search(requirementIndex)) return false;
  }
  return true;
}
