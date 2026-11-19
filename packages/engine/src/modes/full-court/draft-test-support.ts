import type {
  CapRushCatalogSource,
  FullCourtCreateDraftCommand,
  FullCourtDraftState,
  SeasonDraftCatalog,
} from '@hoop-rush/data-contracts';
import {
  commandIdSchema,
  fullCourtCreateDraftCommandSchema,
  idSchema,
  seedSchema,
} from '@hoop-rush/data-contracts';
import {
  buildCapRushTestCatalog,
  capRushTestCatalogSource,
  type CapRushTestCatalogOptions,
} from '@hoop-rush/test-fixtures';
import type { FullCourtCatalogIndex } from './draft-catalog.ts';
import { fullCourtDraftIndexOf } from './draft-catalog.ts';
import { createFullCourtDraftState } from './draft-commands.ts';

export interface FullCourtTestSetup {
  readonly catalog: SeasonDraftCatalog;
  readonly source: CapRushCatalogSource;
  readonly index: FullCourtCatalogIndex;
  readonly createCommand: FullCourtCreateDraftCommand;
  readonly state: FullCourtDraftState;
}

export function fullCourtTestSetup(options: CapRushTestCatalogOptions = {}): FullCourtTestSetup {
  const catalog = buildCapRushTestCatalog(options);
  const source = capRushTestCatalogSource(catalog);
  const index = fullCourtDraftIndexOf(catalog, source);
  const createCommand = fullCourtCreateDraftCommandSchema.parse({
    command: 'create-full-court-draft',
    commandId: commandIdSchema.parse('cmd-create'),
    runId: idSchema.parse('run-full-court'),
    runSeed: seedSchema.parse('abc123def4567890'),
    variant: 'standard',
    catalog: source,
  });
  return {
    catalog,
    source,
    index,
    createCommand,
    state: createFullCourtDraftState(createCommand, index),
  };
}
