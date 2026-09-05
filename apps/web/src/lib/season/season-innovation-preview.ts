import {
  SEASON_COURT_INNOVATION_VERSION,
  type EraSimulationProfile,
  type SeasonDraftCatalog,
  type SeasonGameRule,
  type SeasonRun,
  type SimulationPlayer,
} from '@hoop-rush/data-contracts';
import { projectGameWithRule } from '@hoop-rush/engine';

export interface InnovationEnvironmentPreview {
  rule: SeasonGameRule;
  adapterVersion: typeof SEASON_COURT_INNOVATION_VERSION;
  pointsPer100: number;
  inputDigest: string;
  facts: Record<string, number>;
}

export function previewInnovationEnvironments(input: {
  run: SeasonRun;
  franchiseId: string;
  catalog: SeasonDraftCatalog;
  profile: EraSimulationProfile;
}): { previews: InnovationEnvironmentPreview[]; unitLabel: string } | { error: string } {
  const rotation = input.run.rotations.find((entry) => entry.franchiseId === input.franchiseId);
  if (rotation === undefined) return { error: 'No rotation is locked for the franchise.' };
  const byVersion = new Map(
    input.catalog.candidates.map((candidate) => [candidate.playerVersionId, candidate]),
  );
  const unit: SimulationPlayer[] = [];
  for (const versionId of rotation.starters) {
    const candidate = byVersion.get(versionId);
    if (candidate === undefined)
      return { error: 'The rotation names a player outside the catalog.' };
    unit.push({
      playerId: candidate.playerId,
      playerVersionId: candidate.playerVersionId,
      displayName: candidate.displayName,
      positions: [candidate.positions.primary, ...candidate.positions.secondary],
      heightInches: null,
      weightLbs: null,
      ratings: candidate.detailedRatings,
      tendencies: candidate.tendencies,
    });
  }
  if (unit.length !== 5) return { error: 'The starting five is incomplete.' };
  const rules: readonly SeasonGameRule[] = [
    'standard',
    'deep-four',
    'twenty-second-clock',
    'first-to-seven-overtime',
  ];
  const previews = rules.map((rule) => {
    const projected = projectGameWithRule({
      homeUnit: unit,
      awayUnit: unit,
      profile: input.profile,
      rule,
    });
    return {
      rule,
      adapterVersion: projected.adapterVersion,
      pointsPer100: projected.homePointsPer100,
      inputDigest: projected.inputDigest,
      facts: projected.facts,
    };
  });
  return { previews, unitLabel: 'Starting five vs itself, per 100 possessions' };
}
