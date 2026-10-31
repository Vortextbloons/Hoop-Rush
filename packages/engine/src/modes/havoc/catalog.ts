import type {
  HavocAdaptedCandidate,
  HavocCatalog,
  HavocCatalogSource,
  HavocEffectiveProfile,
  HavocPlayerProfile,
  SeasonDraftCandidate,
  SeasonDraftCatalog,
} from '@hoop-rush/data-contracts';
import { havocCatalogSourceSchema, havocCatalogSchema } from '@hoop-rush/data-contracts';

export function copyHavocEffectiveProfile(profile: HavocEffectiveProfile): HavocEffectiveProfile {
  return {
    ratings: { ...profile.ratings },
    tendencies: { ...profile.tendencies },
    physical: { ...profile.physical },
    authoritativeChannels: [...profile.authoritativeChannels],
  };
}

export function copyHavocPlayerProfile(profile: HavocPlayerProfile): HavocPlayerProfile {
  return {
    ratings: { ...profile.ratings },
    tendencies: { ...profile.tendencies },
    ...(profile.anchors === undefined ? {} : { anchors: { ...profile.anchors } }),
    ...(profile.reconstructedThreePoint === undefined
      ? {}
      : {
          reconstructedThreePoint: {
            ...profile.reconstructedThreePoint,
            zoneFloors: { ...profile.reconstructedThreePoint.zoneFloors },
            evidence: {
              missingFeatures: profile.reconstructedThreePoint.evidence.missingFeatures,
              sourceFields: [...profile.reconstructedThreePoint.evidence.sourceFields],
            },
          },
        }),
  };
}

export function havocCatalogSourcesEqual(
  left: HavocCatalogSource,
  right: HavocCatalogSource,
): boolean {
  return (
    left.catalogVersion === right.catalogVersion &&
    left.catalogHash === right.catalogHash &&
    left.dataVersion === right.dataVersion &&
    left.ratingsVersion === right.ratingsVersion &&
    left.playerVersionIdVersion === right.playerVersionIdVersion &&
    left.positionNormalizationVersion === right.positionNormalizationVersion
  );
}

export function assertHavocCatalogSourceMatches(
  source: HavocCatalogSource,
  expected: HavocCatalogSource,
): void {
  if (!havocCatalogSourcesEqual(source, expected)) {
    throw new Error(
      `havoc catalog source mismatch: packaged ${source.catalogVersion}/${source.catalogHash} does not match expected ${expected.catalogVersion}/${expected.catalogHash}`,
    );
  }
}

function adaptHavocCandidate(candidate: SeasonDraftCandidate): HavocAdaptedCandidate {
  if (candidate.anchors === undefined) {
    throw new Error(
      `havoc catalog candidate ${candidate.playerVersionId} is not fully modeled (missing anchors)`,
    );
  }
  return {
    playerId: candidate.playerId,
    playerVersionId: candidate.playerVersionId,
    displayName: candidate.displayName,
    franchiseId: candidate.franchiseId,
    eraId: candidate.eraId,
    seasonKey: candidate.seasonKey,
    positions: [...candidate.positions.playable],
    originalOverall: candidate.summaryRatings.overallRating,
    overallSource: 'catalog',
    profile: {
      ratings: { ...candidate.detailedRatings },
      tendencies: { ...candidate.tendencies },
      anchors: { ...candidate.anchors },
      ...(candidate.reconstructedThreePoint === undefined
        ? {}
        : {
            reconstructedThreePoint: {
              ...candidate.reconstructedThreePoint,
              zoneFloors: { ...candidate.reconstructedThreePoint.zoneFloors },
              evidence: {
                missingFeatures: candidate.reconstructedThreePoint.evidence.missingFeatures,
                sourceFields: [...candidate.reconstructedThreePoint.evidence.sourceFields],
              },
            },
          }),
    },
    physical: {
      heightInches: candidate.heightInches,
      weightLbs: candidate.weightLbs,
    },
    claimKey: {
      playerId: candidate.playerId,
      seasonKey: candidate.seasonKey,
    },
  };
}

export function AdaptHavocCatalog(
  catalog: SeasonDraftCatalog,
  source: HavocCatalogSource,
): HavocCatalog {
  const parsedSource = havocCatalogSourceSchema.parse(source);
  if (parsedSource.catalogVersion !== catalog.catalogVersion) {
    throw new Error(
      `havoc catalog source mismatch: packaged ${catalog.catalogVersion} does not match ${parsedSource.catalogVersion}`,
    );
  }
  if (parsedSource.dataVersion !== catalog.dataVersion) {
    throw new Error(
      `havoc catalog data version mismatch: packaged ${catalog.dataVersion} does not match ${parsedSource.dataVersion}`,
    );
  }
  if (parsedSource.ratingsVersion !== catalog.ratingsVersion) {
    throw new Error(
      `havoc catalog ratings version mismatch: packaged ${catalog.ratingsVersion} does not match ${parsedSource.ratingsVersion}`,
    );
  }
  if (parsedSource.playerVersionIdVersion !== catalog.playerVersionIdVersion) {
    throw new Error(
      `havoc catalog player version id version mismatch: packaged ${catalog.playerVersionIdVersion} does not match ${parsedSource.playerVersionIdVersion}`,
    );
  }
  if (parsedSource.positionNormalizationVersion !== catalog.positionNormalizationVersion) {
    throw new Error(
      `havoc catalog position normalization mismatch: packaged ${catalog.positionNormalizationVersion} does not match ${parsedSource.positionNormalizationVersion}`,
    );
  }
  const seenVersions = new Set<string>();
  const candidates: HavocAdaptedCandidate[] = [];
  for (const candidate of catalog.candidates) {
    if (seenVersions.has(candidate.playerVersionId)) {
      throw new Error(
        `havoc catalog contains duplicate player version ${candidate.playerVersionId}`,
      );
    }
    seenVersions.add(candidate.playerVersionId);
    candidates.push(adaptHavocCandidate(candidate));
  }
  return havocCatalogSchema.parse({ source: parsedSource, candidates });
}
