import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  SEASON_EMPTY_COMMAND_LOG_DIGEST,
  buildSeasonRunReplayExport,
  humanFranchiseIdOf,
  seasonCommandLogDigest,
  seasonCommandLogEntrySchema,
  seasonCommandLogSchema,
  seasonCommandResultDigest,
  type SeasonAlmanac,
  type SeasonCommandLog,
  type SeasonCommandLogEntry,
  type SeasonRunReplayExport,
  type SeasonRunReplayExportInput,
} from '@hoop-rush/data-contracts';
import {
  createSeasonEffectsState,
  expandSeasonRunRosters,
  handleSeasonRunCommand,
  openSeasonTradeWindow,
  seasonObjectiveChoicesForBlock,
} from '@hoop-rush/engine';
import { REPO_ROOT } from './cli-test-helpers.ts';
import { loadSeasonRunFixture } from './commands/season-block.ts';
import { loadSeasonDraftCatalog } from './commands/season-data.ts';
import { loadPackagedData, PackagedData } from './commands/data-loader.ts';

/**
 * Shared reproduce-test support (M2.6, replay-export-v1): builds a REAL
 * full-run replay export over the committed fixture — a trade window opens
 * (block 2), the first open offer is accepted, a block-0 objective is
 * selected, and a second offer is declined — with every command driven
 * through the authoritative engine dispatch and recorded as command-log
 * entries. The export carries the post-window run and effects as its
 * initial state, mirroring the persistence flow (the window folds into the
 * block-2 checkpoint commit; the first logged command's pre-state sits
 * after it).
 */

const SEASON_RUN = join(REPO_ROOT, 'tools/cli/src/fixtures/season-run.json');
const MANIFEST = join(REPO_ROOT, 'apps/web/static/data/manifest.json');
const DIGEST_32 = '0'.repeat(32);

export function loadManifestHashes(): SeasonRunReplayExportInput['assetHashes'] {
  const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8')) as {
    season?: {
      league?: { contentHash?: string };
      schedule?: { contentHash?: string };
      draftCatalog?: { contentHash?: string };
    };
    eraSimulationProfiles?: Array<{ eraId?: string; contentHash?: string }>;
  };
  const eraProfile =
    manifest.eraSimulationProfiles?.find((entry) => entry.eraId === '1990s')?.contentHash ?? '';
  return {
    league: manifest.season?.league?.contentHash ?? '',
    schedule: manifest.season?.schedule?.contentHash ?? '',
    draftCatalog: manifest.season?.draftCatalog?.contentHash ?? '',
    eraProfile,
  };
}

/** The packaged replay deps (catalog + era profile) of the direct calls. */
export function replayDeps(): {
  catalog: ReturnType<typeof loadSeasonDraftCatalog>;
  profile: ReturnType<PackagedData['eraProfile']>;
  verifyAssetHashes: () => string[];
} {
  const catalog = loadSeasonDraftCatalog(MANIFEST);
  const packaged = loadPackagedData(MANIFEST);
  const profile = new PackagedData(packaged.manifest, packaged.dir).eraProfile('1990s');
  return { catalog, profile, verifyAssetHashes: () => [] };
}

/** Re-chains a command log with the frozen hash-chain rule. */
export function chainLog(entries: readonly SeasonCommandLogEntry[]): SeasonCommandLog {
  const chained: SeasonCommandLogEntry[] = [];
  for (const entry of entries) {
    chained.push({
      ...entry,
      previousLogDigest: seasonCommandLogDigest(chained),
    });
  }
  return seasonCommandLogSchema.parse({
    schemaVersion: 1,
    commandLogVersion: 'command-log-v1',
    runId: entries[0]?.runId ?? '',
    entries: chained,
  });
}

export interface ReplayedRun {
  exportInput: SeasonRunReplayExportInput;
  exportArtifact: SeasonRunReplayExport;
}

/**
 * Builds a real three-command replay export (see the module docstring).
 * The same builder backs the direct replay tests and the CLI end-to-end
 * tests, so both exercise identical recorded facts.
 */
export function buildReplayedRun(): ReplayedRun {
  const run = loadSeasonRunFixture(SEASON_RUN);
  const catalog = loadSeasonDraftCatalog(MANIFEST);
  const humanFranchiseId = humanFranchiseIdOf(run.league);
  if (humanFranchiseId === null) throw new Error('fixture has no human franchise');
  const expanded = expandSeasonRunRosters(run, catalog);
  const staminaInputs: import('@hoop-rush/data-contracts').SeasonStaminaInput[] = [];
  for (const player of expanded.values()) {
    if (player.stamina === undefined) {
      throw new Error(`expanded player ${player.playerVersionId} has no stamina profile`);
    }
    staminaInputs.push(player.stamina);
  }
  const initialEffects = createSeasonEffectsState(staminaInputs);
  const window = openSeasonTradeWindow({
    run,
    blockIndex: 2,
    rootSeed: run.rootSeed,
    humanFranchiseId,
    catalog,
    effects: initialEffects,
  });
  if (window === null) throw new Error('window did not open');
  const windowedRun = {
    ...run,
    trade: window.trade,
    influence: window.influence,
    transactions: window.transactions,
    rosters: window.rosters,
    ownership: window.ownership,
    rotations: window.rotations,
    health: window.health,
    stateRevision: window.stateRevision,
    stateDigest: window.stateDigest,
  };
  let effects = window.effects;

  const offers = window.trade.windows[0]?.offers ?? [];
  const firstOpen = offers.find((offer) => offer.status === 'open');
  const secondOpen = offers.find(
    (offer, index) => offer.status === 'open' && index > offers.indexOf(firstOpen as never),
  );
  if (firstOpen === undefined) throw new Error('no open offers to accept');

  const entries: SeasonCommandLogEntry[] = [];
  const objectiveId = seasonObjectiveChoicesForBlock(run.rootSeed, 0)[0];
  if (objectiveId === undefined) throw new Error('no objective offered for block 0');

  const record = (
    command: Parameters<typeof handleSeasonRunCommand>[0],
    runFor: typeof run,
    currentEffects: typeof effects,
  ): { run: typeof run; effects: typeof effects } => {
    const output = handleSeasonRunCommand(command, {
      run: runFor,
      pending: null,
      humanFranchiseId,
      catalog,
      effects: currentEffects,
    });
    if (output.result.result.status === 'rejected') {
      throw new Error(`replay fixture command rejected: ${JSON.stringify(output.result.result)}`);
    }
    const accepted = output.result.result;
    const gameIds = 'advancedGameIds' in accepted ? accepted.advancedGameIds : [];
    const summaryDigests = (output.postseasonSummaries ?? []).map(
      (summary) => summary.resultDigest,
    );
    entries.push(
      seasonCommandLogEntrySchema.parse({
        runId: run.runId,
        ordinal: entries.length,
        command,
        preStateRevision: command.expectedStateRevision,
        preStateDigest: command.expectedStateDigest,
        postStateRevision: output.run.stateRevision,
        postStateDigest: output.run.stateDigest,
        resultDigest: seasonCommandResultDigest({
          commandId: command.commandId,
          gameIds,
          summaryDigests,
        }),
        previousLogDigest: SEASON_EMPTY_COMMAND_LOG_DIGEST,
        relatedGameIds: gameIds,
        transactionIds: [],
      }),
    );
    const next = output.run as typeof run & { effects?: typeof effects };
    return { run: next, effects: next.effects ?? currentEffects };
  };

  const acceptOutput = record(
    {
      schemaVersion: 9,
      command: 'accept-trade-offer',
      commandId: 'repro-accept-1',
      runId: run.runId,
      expectedStateRevision: window.stateRevision,
      expectedStateDigest: window.stateDigest,
      windowIndex: 0,
      offerId: firstOpen.offerId,
    },
    windowedRun,
    effects,
  );
  effects = acceptOutput.effects;
  const selectOutput = record(
    {
      schemaVersion: 9,
      command: 'select-block-objective',
      commandId: 'repro-select-1',
      runId: run.runId,
      expectedStateRevision: acceptOutput.run.stateRevision,
      expectedStateDigest: acceptOutput.run.stateDigest,
      blockIndex: 0,
      objectiveId,
    },
    acceptOutput.run,
    effects,
  );
  effects = selectOutput.effects;
  let finalRun = selectOutput.run;
  if (secondOpen !== undefined) {
    finalRun = record(
      {
        schemaVersion: 9,
        command: 'decline-trade-offer',
        commandId: 'repro-decline-1',
        runId: run.runId,
        expectedStateRevision: selectOutput.run.stateRevision,
        expectedStateDigest: selectOutput.run.stateDigest,
        windowIndex: 0,
        offerId: secondOpen.offerId,
      },
      selectOutput.run,
      effects,
    ).run;
  }

  const commandLog = chainLog(entries);
  const finalStateDigest = finalRun.stateDigest;
  const almanac: SeasonAlmanac = {
    schemaVersion: 1,
    almanacVersion: 'almanac-v1',
    runId: run.runId,
    rootSeed: run.rootSeed,
    championFranchiseId: 'lakers',
    postseasonDigest: DIGEST_32,
    commandLogDigest: seasonCommandLogDigest(commandLog.entries),
    awardsDigest: DIGEST_32,
    tradeGradesDigest: DIGEST_32,
    digest: DIGEST_32,
  };
  const exportInput: SeasonRunReplayExportInput = {
    runId: run.runId,
    rootSeed: run.rootSeed,
    eraId: '1990s',
    versions: run.versions,
    assetHashes: loadManifestHashes(),
    initialRun: windowedRun,
    initialEffects: window.effects,
    commandLog,
    postseasonSummaries: [],
    almanac,
    championFranchiseId: 'lakers',
    finalStateDigest,
  };
  return { exportInput, exportArtifact: buildSeasonRunReplayExport(exportInput) };
}
