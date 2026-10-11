import { it } from 'vitest';
import type {
  DraftDuelCard,
  DraftDuelCatalogEntry,
  DraftDuelParticipantId,
  PlayerId,
  Position,
  Seed,
} from '@hoop-rush/data-contracts';
import {
  draftDuelCatalogEntrySchema,
  playerIdSchema,
  seedFromString,
  seedSchema,
} from '@hoop-rush/data-contracts';
import { seasonDigestHex } from '@hoop-rush/data-contracts';
import { buildSimulationPlayer } from '@hoop-rush/test-fixtures';
import { buildDraftDuelCatalog } from './catalog.ts';
import {
  applyDraftDuelPick,
  createDraftDuelDraft,
  draftDuelCurrentPicker,
  draftDuelLegalPicks,
  isDraftDuelComplete,
} from './draft.ts';

function buildCatalogFromSpecs(
  specs: readonly PlayerSpec[],
): ReturnType<typeof buildDraftDuelCatalog> {
  const entries: DraftDuelCatalogEntry[] = [];
  for (const spec of specs) {
    const playerId = playerIdSchema.parse(spec.id);
    const versions = spec.versions && spec.versions.length > 0 ? spec.versions : [{}];
    versions.forEach((version, index) => {
      const positions = version.positions ?? spec.positions;
      const band = version.band ?? spec.band;
      const material = `${spec.id}:v${String(index)}`;
      const displayName = `Player ${spec.id} v${String(index + 1)}`;
      entries.push(
        draftDuelCatalogEntrySchema.parse({
          card: {
            cardId: `card-${seasonDigestHex(`${material}:card`).slice(0, 32)}`,
            playerId,
            playerVersionId: `pv-${seasonDigestHex(material).slice(0, 32)}`,
            displayName,
            seasonKey: '1990-91',
            franchiseId: 'lakers',
            eraId: '1990s',
            positions,
            overall: 70,
            bandIndex: band,
          },
          simulation: buildSimulationPlayer({ playerId, displayName, positions }),
        }),
      );
    });
  }
  return buildDraftDuelCatalog({
    catalogVersion: 'test-catalog-v1',
    catalogHash: 'b'.repeat(64) as never,
    dataVersion: 'data-v1',
    ratingsVersion: 'ratings-v1',
    playerVersionIdVersion: 'pv-v1',
    positionNormalizationVersion: 'position-v1',
    entries,
  });
}

interface VersionSpec {
  positions?: Position[];
  band?: number;
}
interface PlayerSpec {
  id: string;
  positions: Position[];
  band: number;
  versions?: VersionSpec[];
}

function manySpecs(
  count: number,
  positions: Position[],
  idPrefix: string,
  bandOffset: number,
): PlayerSpec[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `${idPrefix}-${String(index)}`,
    positions,
    band: (bandOffset + index) % 10,
  }));
}

function scarceCenterSpecs(): PlayerSpec[] {
  return [
    ...manySpecs(10, ['PG'], 'sc-g', 0),
    ...manySpecs(10, ['SF'], 'sc-f', 0),
    ...manySpecs(2, ['PG', 'SG'], 'sc-gx', 5),
    { id: 'sc-c0', positions: ['C'], band: 0 },
    { id: 'sc-c1', positions: ['C'], band: 4 },
    { id: 'sc-c2', positions: ['C'], band: 7 },
    { id: 'sc-cx', positions: ['PG', 'C'], band: 2 },
  ];
}

function threeCenterSpecs(): PlayerSpec[] {
  return [
    ...manySpecs(14, ['PG'], 'tc-g', 0),
    ...manySpecs(14, ['SF'], 'tc-f', 0),
    { id: 'tc-c0', positions: ['C'], band: 1 },
    { id: 'tc-c1', positions: ['C'], band: 5 },
    { id: 'tc-c2', positions: ['C'], band: 8 },
  ];
}

const GROUP_PROFILES: Position[][] = [
  ['PG'],
  ['SG'],
  ['SF'],
  ['PF'],
  ['C'],
  ['PG', 'SG'],
  ['SF', 'PF'],
  ['PF', 'C'],
  ['SG', 'SF'],
  ['PG', 'C'],
];
function standardSpecs(): PlayerSpec[] {
  const specs: PlayerSpec[] = [];
  for (let band = 0; band < 10; band += 1) {
    for (let index = 0; index < 5; index += 1) {
      const profile = GROUP_PROFILES[(band * 5 + index) % GROUP_PROFILES.length] ?? ['PG'];
      const versionCount = (index % 3) + 1;
      specs.push({
        id: `p-${String(band)}-${String(index)}`,
        positions: profile,
        band,
        versions: Array.from({ length: versionCount }, () => ({})),
      });
    }
  }
  return specs;
}

it('debug failing combos', () => {
  const catalogs: Array<[string, ReturnType<typeof buildCatalogFromSpecs>]> = [
    ['standard', buildCatalogFromSpecs(standardSpecs())],
    ['scarce', buildCatalogFromSpecs(scarceCenterSpecs())],
    ['three', buildCatalogFromSpecs(threeCenterSpecs())],
  ];
  const seeds: Seed[] = [
    seedSchema.parse(seedFromString('draft-duel-seed-a')),
    seedSchema.parse(seedFromString('draft-duel-seed-b')),
  ];
  for (const [name, catalog] of catalogs) {
    for (const seed of seeds) {
      for (const fairness of ['fair', 'unfair'] as const) {
        try {
          let state = createDraftDuelDraft({ rootSeed: seed, fairness, catalog });
          while (!isDraftDuelComplete(state)) {
            const available = draftDuelLegalPicks(state, catalog).filter(
              (option) => option.available,
            );
            const first = available[0];
            if (!first) throw new Error(`no legal picks at ${String(state.pickOrdinal)}`);
            state = applyDraftDuelPick(state, catalog, {
              participantId: draftDuelCurrentPicker(state),
              playerId: first.card.playerId,
              playerVersionId: first.card.playerVersionId,
            });
          }
        } catch (error) {
          console.log(
            `FAIL ${name} ${String(seed)} ${fairness}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
    }
  }
  void (null as unknown as PlayerId);
  void (null as unknown as DraftDuelCard);
  void (null as unknown as DraftDuelParticipantId);
});
