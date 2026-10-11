import type {
  HavocCatalog,
  HavocCatalogSource,
  HavocCreateDraftCommand,
  SeasonDraftCatalog,
} from '@hoop-rush/data-contracts';
import { HAVOC_SCHEMA_VERSION, contentHashSchema, seedFromString } from '@hoop-rush/data-contracts';
import { buildHavocVersionSet, buildSeasonDraftCatalog } from '@hoop-rush/test-fixtures';
import { createRng } from '../../sim/rng.ts';
import { AdaptHavocCatalog } from './catalog.ts';
import type { HavocCommandEnvironment } from './draft-commands.ts';
import { createHavocCommandEnvironment } from './draft-commands.ts';
import { HAVOC_MUTATION_DEFINITIONS } from './mutations.ts';

export const HAVOC_TEST_RUN_SEED = seedFromString('havoc-test-run');
export const HAVOC_TEST_RUN_ID = 'havoc-test-run';

export function buildHavocCatalogSource(catalog: SeasonDraftCatalog): HavocCatalogSource {
  return {
    catalogVersion: catalog.catalogVersion,
    catalogHash: contentHashSchema.parse('ab'.repeat(32)),
    dataVersion: catalog.dataVersion,
    ratingsVersion: catalog.ratingsVersion,
    playerVersionIdVersion: catalog.playerVersionIdVersion,
    positionNormalizationVersion: catalog.positionNormalizationVersion,
  };
}

export interface HavocCatalogFixture {
  readonly catalog: SeasonDraftCatalog;
  readonly source: HavocCatalogSource;
  readonly adapted: HavocCatalog;
}

export function buildHavocCatalogFixture(): HavocCatalogFixture {
  const catalog = buildSeasonDraftCatalog();
  const source = buildHavocCatalogSource(catalog);
  return { catalog, source, adapted: AdaptHavocCatalog(catalog, source) };
}

export function buildHavocEnvironmentFixture(adapted: HavocCatalog): HavocCommandEnvironment {
  return createHavocCommandEnvironment(adapted, {
    rngFactory: createRng,
    definitions: HAVOC_MUTATION_DEFINITIONS,
  });
}

export function buildHavocCreateCommandFixture(
  fixture: HavocCatalogFixture,
  overrides: Partial<HavocCreateDraftCommand> = {},
): HavocCreateDraftCommand {
  return {
    schemaVersion: HAVOC_SCHEMA_VERSION,
    commandId: 'cmd-create',
    runId: HAVOC_TEST_RUN_ID,
    command: 'create-havoc-draft',
    runSeed: HAVOC_TEST_RUN_SEED,
    versionSet: buildHavocVersionSet(),
    catalog: fixture.source,
    ...overrides,
  };
}
