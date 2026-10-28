import {
  PLAYER_VERSION_ID_VERSION,
  POSITION_NORMALIZATION_VERSION,
  RATINGS_VERSION,
  SEASON_DRAFT_CATALOG_VERSION,
  SEASON_DURABILITY_VERSION,
  SEASON_STAMINA_VERSION,
  eraIdSchema,
  franchiseIdSchema,
  playerIdSchema,
  playerVersionId,
  seasonDraftCatalogSchema,
  type SeasonDraftCandidate,
  type SeasonDraftCatalog,
  type SeasonDraftCatalogPool,
} from '@hoop-rush/data-contracts';
import { buildSeasonDraftCandidate } from './season-draft.ts';

export const CAP_RUSH_TEST_OVERALLS = [
  99, 96, 95, 92, 90, 89, 86, 83, 81, 80, 79, 78, 77, 76, 75, 74, 71, 70, 68, 65, 62, 60,
] as const;

export interface CapRushTestExtraPlayer {
  readonly positions: readonly string[];
  readonly overall: number;
}

export interface CapRushTestCatalogOptions {
  readonly overalls?: readonly number[];
  readonly positions?: readonly string[];
  readonly extraPlayers?: readonly CapRushTestExtraPlayer[];
}

function withPositions(
  candidate: SeasonDraftCandidate,
  playable: readonly string[],
): SeasonDraftCandidate {
  return {
    ...candidate,
    positions: {
      primary: playable[0] as SeasonDraftCandidate['positions']['primary'],
      secondary: [],
      playable: [...playable].sort() as SeasonDraftCandidate['positions']['playable'],
      normalizationVersion: POSITION_NORMALIZATION_VERSION,
    },
  };
}

export function buildCapRushTestCatalog(
  options: CapRushTestCatalogOptions = {},
): SeasonDraftCatalog {
  const overalls = options.overalls ?? CAP_RUSH_TEST_OVERALLS;
  const positions = options.positions ?? ['PG', 'SG', 'SF', 'PF', 'C'];
  const candidates: SeasonDraftCandidate[] = [];
  const members: string[] = [];
  let index = 0;
  for (const position of positions) {
    for (const overall of overalls) {
      const candidate = buildSeasonDraftCandidate({
        franchiseId: 'lakers',
        eraId: '1990s',
        index,
      });
      const playerId = playerIdSchema.parse(`p-cap-${position.toLowerCase()}-${String(index)}`);
      const versionId = playerVersionId(playerId, 'lakers', '1990s', '1995-96');
      candidates.push({
        ...withPositions(candidate, [position]),
        playerVersionId: versionId,
        playerId,
        displayName: `${position} ${String(overall)}`,
        summaryRatings: {
          ...candidate.summaryRatings,
          overallRating: overall,
        },
      });
      members.push(versionId);
      index += 1;
    }
  }
  for (const [extraIndex, extra] of (options.extraPlayers ?? []).entries()) {
    const candidate = buildSeasonDraftCandidate({
      franchiseId: 'celtics',
      eraId: '2000s',
      index: 100 + extraIndex,
    });
    const playerId = playerIdSchema.parse(
      `p-cap-extra-${extra.positions.join('-').toLowerCase()}-${String(extraIndex)}`,
    );
    const versionId = playerVersionId(playerId, 'celtics', '2000s', '1995-96');
    candidates.push({
      ...withPositions(candidate, extra.positions),
      playerVersionId: versionId,
      playerId,
      displayName: `Extra ${extra.positions.join('/')} ${String(extra.overall)}`,
      summaryRatings: {
        ...candidate.summaryRatings,
        overallRating: extra.overall,
      },
    });
    members.push(versionId);
  }
  const pools: SeasonDraftCatalogPool[] = [
    {
      franchiseId: franchiseIdSchema.parse('lakers'),
      eraId: eraIdSchema.parse('1990s'),
      playerVersionIds: members,
    },
  ];
  return seasonDraftCatalogSchema.parse({
    schemaVersion: 1,
    catalogVersion: SEASON_DRAFT_CATALOG_VERSION,
    dataVersion: `cap-rush-test-${RATINGS_VERSION}`,
    ratingsVersion: RATINGS_VERSION,
    positionNormalizationVersion: POSITION_NORMALIZATION_VERSION,
    playerVersionIdVersion: PLAYER_VERSION_ID_VERSION,
    staminaVersion: SEASON_STAMINA_VERSION,
    durabilityVersion: SEASON_DURABILITY_VERSION,
    pools,
    candidates,
  });
}

export function capRushTestCatalogSource(catalog: SeasonDraftCatalog) {
  return {
    catalogVersion: catalog.catalogVersion,
    catalogHash: 'a'.repeat(64),
    dataVersion: catalog.dataVersion,
    ratingsVersion: catalog.ratingsVersion,
    playerVersionIdVersion: catalog.playerVersionIdVersion,
    positionNormalizationVersion: catalog.positionNormalizationVersion,
  };
}
