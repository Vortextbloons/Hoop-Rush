import type {
  CapRushCatalog,
  CapRushCatalogSource,
  CapRushSourcePlayer,
  Position,
  SeasonDraftCatalog,
} from '@hoop-rush/data-contracts';
import {
  CAP_RUSH_MAX_OVERALL,
  CAP_RUSH_MIN_OVERALL,
  POSITIONS,
  capRushCatalogSchema,
  capRushCatalogSourceSchema,
  capRushSourcePlayerSchema,
} from '@hoop-rush/data-contracts';
import { compareStrings } from '../../domain/math.ts';
import { capRushSalaryDollars } from './salary.ts';
import type { CapRushSlotSalaryOption } from './feasibility.ts';

export interface CapRushCatalogIndex {
  readonly catalog: CapRushCatalog;
  readonly byPlayerId: ReadonlyMap<string, readonly CapRushSourcePlayer[]>;
  readonly byVersionId: ReadonlyMap<string, CapRushSourcePlayer>;
  readonly bySlot: ReadonlyMap<Position, readonly CapRushSourcePlayer[]>;
  readonly playerIds: readonly string[];
  readonly salaryOptionsBySlot: ReadonlyMap<Position, readonly CapRushSlotSalaryOption[]>;
}

function adaptSourcePlayer(
  candidate: SeasonDraftCatalog['candidates'][number],
): CapRushSourcePlayer | null {
  const overall = candidate.summaryRatings.overallRating;
  if (
    !Number.isInteger(overall) ||
    overall < CAP_RUSH_MIN_OVERALL ||
    overall > CAP_RUSH_MAX_OVERALL
  ) {
    return null;
  }
  if (candidate.anchors === undefined) {
    throw new Error(
      `cap rush catalog candidate ${candidate.playerVersionId} is not fully modeled (missing anchors)`,
    );
  }
  return capRushSourcePlayerSchema.parse({
    playerId: candidate.playerId,
    playerVersionId: candidate.playerVersionId,
    displayName: candidate.displayName,
    franchiseId: candidate.franchiseId,
    eraId: candidate.eraId,
    seasonKey: candidate.seasonKey,
    positions: candidate.positions.playable,
    originalOverall: overall,
    profile: {
      ratings: candidate.detailedRatings,
      tendencies: candidate.tendencies,
      anchors: candidate.anchors,
      ...(candidate.reconstructedThreePoint === undefined
        ? {}
        : { reconstructedThreePoint: candidate.reconstructedThreePoint }),
    },
    physical: {
      heightInches: candidate.heightInches,
      weightLbs: candidate.weightLbs,
    },
    ...(candidate.playoffPerformance === undefined
      ? {}
      : { playoffPerformance: candidate.playoffPerformance }),
  });
}

export function assertCapRushCatalogSourceMatches(
  source: CapRushCatalogSource,
  expected: CapRushCatalogSource,
): void {
  const parsed = capRushCatalogSourceSchema.parse(source);
  const wanted = capRushCatalogSourceSchema.parse(expected);
  if (
    parsed.catalogVersion !== wanted.catalogVersion ||
    parsed.catalogHash !== wanted.catalogHash ||
    parsed.dataVersion !== wanted.dataVersion ||
    parsed.ratingsVersion !== wanted.ratingsVersion ||
    parsed.playerVersionIdVersion !== wanted.playerVersionIdVersion ||
    parsed.positionNormalizationVersion !== wanted.positionNormalizationVersion
  ) {
    throw new Error(
      `cap rush catalog source mismatch: packaged ${parsed.catalogVersion}/${parsed.catalogHash} does not match expected ${wanted.catalogVersion}/${wanted.catalogHash}`,
    );
  }
}

export function adaptCapRushCatalog(
  catalog: SeasonDraftCatalog,
  source: CapRushCatalogSource,
): CapRushCatalog {
  const parsedSource = capRushCatalogSourceSchema.parse(source);
  if (parsedSource.catalogVersion !== catalog.catalogVersion) {
    throw new Error(
      `cap rush catalog version mismatch: packaged ${catalog.catalogVersion} does not match ${parsedSource.catalogVersion}`,
    );
  }
  if (parsedSource.dataVersion !== catalog.dataVersion) {
    throw new Error(
      `cap rush data version mismatch: packaged ${catalog.dataVersion} does not match ${parsedSource.dataVersion}`,
    );
  }
  if (parsedSource.ratingsVersion !== catalog.ratingsVersion) {
    throw new Error(
      `cap rush ratings version mismatch: packaged ${catalog.ratingsVersion} does not match ${parsedSource.ratingsVersion}`,
    );
  }
  if (parsedSource.playerVersionIdVersion !== catalog.playerVersionIdVersion) {
    throw new Error(
      `cap rush player version id version mismatch: packaged ${catalog.playerVersionIdVersion} does not match ${parsedSource.playerVersionIdVersion}`,
    );
  }
  if (parsedSource.positionNormalizationVersion !== catalog.positionNormalizationVersion) {
    throw new Error(
      `cap rush position normalization mismatch: packaged ${catalog.positionNormalizationVersion} does not match ${parsedSource.positionNormalizationVersion}`,
    );
  }
  const seenVersions = new Set<string>();
  const candidates: CapRushSourcePlayer[] = [];
  for (const candidate of catalog.candidates) {
    if (seenVersions.has(candidate.playerVersionId)) {
      throw new Error(
        `cap rush catalog contains duplicate player version ${candidate.playerVersionId}`,
      );
    }
    seenVersions.add(candidate.playerVersionId);
    const adapted = adaptSourcePlayer(candidate);
    if (adapted !== null) candidates.push(adapted);
  }
  if (candidates.length === 0) {
    throw new Error('cap rush catalog has no candidates with an overall in 40..99');
  }
  return capRushCatalogSchema.parse({ source: parsedSource, candidates });
}

export function buildCapRushCatalogIndex(catalog: CapRushCatalog): CapRushCatalogIndex {
  const byPlayerId = new Map<string, CapRushSourcePlayer[]>();
  const byVersionId = new Map<string, CapRushSourcePlayer>();
  const bySlot = new Map<Position, CapRushSourcePlayer[]>(POSITIONS.map((slot) => [slot, []]));
  for (const player of catalog.candidates) {
    const versions = byPlayerId.get(player.playerId);
    if (versions) versions.push(player);
    else byPlayerId.set(player.playerId, [player]);
    if (byVersionId.has(player.playerVersionId)) {
      throw new Error(
        `cap rush catalog contains duplicate player version ${player.playerVersionId}`,
      );
    }
    byVersionId.set(player.playerVersionId, player);
    for (const slot of player.positions) {
      bySlot.get(slot)?.push(player);
    }
  }
  for (const versions of byPlayerId.values()) {
    versions.sort((left, right) => compareStrings(left.playerVersionId, right.playerVersionId));
  }
  for (const players of bySlot.values()) {
    players.sort((left, right) => {
      const byId = compareStrings(left.playerId, right.playerId);
      return byId === 0 ? compareStrings(left.playerVersionId, right.playerVersionId) : byId;
    });
  }
  const playerIds = [...byPlayerId.keys()].sort(compareStrings);
  const salaryOptionsBySlot = new Map<Position, CapRushSlotSalaryOption[]>();
  for (const [slot, players] of bySlot) {
    const salaries = new Map<string, number>();
    for (const player of players) {
      const salary = capRushSalaryDollars(player.originalOverall, player.seasonKey);
      salaries.set(player.playerId, Math.min(salaries.get(player.playerId) ?? Infinity, salary));
    }
    salaryOptionsBySlot.set(
      slot,
      [...salaries]
        .map(([playerId, salaryDollars]) => ({ playerId, salaryDollars }))
        .sort(
          (a, b) => a.salaryDollars - b.salaryDollars || compareStrings(a.playerId, b.playerId),
        ),
    );
  }
  return { catalog, byPlayerId, byVersionId, bySlot, playerIds, salaryOptionsBySlot };
}

export function capRushSalaryOf(player: CapRushSourcePlayer): number {
  return capRushSalaryDollars(player.originalOverall, player.seasonKey);
}

export function capRushEligibleAt(
  index: CapRushCatalogIndex,
  slot: Position,
  minOverall: number,
  maxOverall: number,
): readonly CapRushSourcePlayer[] {
  const players = index.bySlot.get(slot) ?? [];
  return players.filter(
    (player) => player.originalOverall >= minOverall && player.originalOverall <= maxOverall,
  );
}
