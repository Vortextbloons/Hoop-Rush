import type {
  CapRushCatalogSource,
  CapRushCreateDraftCommand,
  CapRushDraftState,
  CapRushVersionSet,
  SeasonDraftCatalog,
} from '@hoop-rush/data-contracts';
import {
  CAP_RUSH_RULES_VERSION,
  CAP_RUSH_SALARY_CURVE_VERSION,
  CAP_RUSH_SCHEMA_VERSION,
  CAP_RUSH_SEED_DERIVATION_VERSION,
  capRushVersionSetSchema,
  commandIdSchema,
  idSchema,
  seedSchema,
} from '@hoop-rush/data-contracts';
import { ENGINE_VERSION } from '../../sim/constants.ts';
import {
  buildCapRushTestCatalog,
  capRushTestCatalogSource,
  type CapRushTestCatalogOptions,
} from '@hoop-rush/test-fixtures';
import { DEFAULT_ERA_SIM_PROFILE, buildFixtureBracket } from '@hoop-rush/test-fixtures';
import type { CapRushCatalogIndex } from './catalog.ts';
import { adaptCapRushCatalog, buildCapRushCatalogIndex } from './catalog.ts';
import { createCapRushDraftState } from './draft-commands.ts';
import type { CapRushLockSources } from './lock.ts';

export interface CapRushTestSetup {
  readonly catalog: SeasonDraftCatalog;
  readonly source: CapRushCatalogSource;
  readonly versionSet: CapRushVersionSet;
  readonly index: CapRushCatalogIndex;
  readonly lockSources: CapRushLockSources;
  readonly createCommand: CapRushCreateDraftCommand;
  readonly state: CapRushDraftState;
}

function capRushTestVersionSet(source: CapRushCatalogSource): CapRushVersionSet {
  return capRushVersionSetSchema.parse({
    schemaVersion: CAP_RUSH_SCHEMA_VERSION,
    rulesVersion: CAP_RUSH_RULES_VERSION,
    salaryCurveVersion: CAP_RUSH_SALARY_CURVE_VERSION,
    seedDerivationVersion: CAP_RUSH_SEED_DERIVATION_VERSION,
    engineVersion: ENGINE_VERSION,
    profileVersion: 'test-profile-v1',
    dataVersion: source.dataVersion,
    catalogVersion: source.catalogVersion,
    catalogHash: source.catalogHash,
    bracketHash: 'b'.repeat(64),
    profileHash: 'c'.repeat(64),
  });
}

export function capRushTestSetup(options: CapRushTestCatalogOptions = {}): CapRushTestSetup {
  const catalog = buildCapRushTestCatalog(options);
  const source = capRushTestCatalogSource(catalog);
  const index = buildCapRushCatalogIndex(adaptCapRushCatalog(catalog, source));
  const versionSet = capRushTestVersionSet(source);
  const createCommand: CapRushCreateDraftCommand = {
    command: 'create-cap-rush-draft',
    commandId: commandIdSchema.parse('cmd-create'),
    runId: idSchema.parse('run-test'),
    runSeed: seedSchema.parse('abc123def4567890'),
    variant: 'clash',
    versionSet,
    catalog: source,
  };
  return {
    catalog,
    source,
    versionSet,
    index,
    lockSources: { bracket: buildFixtureBracket(), profile: DEFAULT_ERA_SIM_PROFILE },
    createCommand,
    state: createCapRushDraftState(createCommand, index),
  };
}
