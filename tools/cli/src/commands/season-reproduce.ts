import {
  seasonCommandLogDigest,
  seasonCommandResultDigest,
  seasonRunReplayExportSchema,
  seasonAwardsDigest,
  seasonTradeGradeLogDigest,
  humanFranchiseIdOf,
  type SeasonEffectsState,
  type SeasonFreeAgencyIndex,
  type SeasonGameSummary,
  type SeasonPendingBlockCandidate,
  type SeasonRosterTargets,
  type SeasonRun,
  type SeasonRunReplayExport,
  type SeasonSubmitBlockCommand,
} from '@hoop-rush/data-contracts';
import {
  createSeasonEffectsState,
  defaultSeasonPostseasonGameResolver,
  deriveSeasonAwards,
  deriveSeasonPostBlockState,
  deriveSeasonTradeGrades,
  expandSeasonRunRosters,
  generateSeasonSchedule,
  handleSeasonRunCommand,
  handleSubmitSeasonBlockCommand,
  rosterPlayerIdsOf,
  type SeasonBlockSimulationInput,
} from '@hoop-rush/engine';
import { makeReport, type CliReport } from '../report.ts';
import { seasonRunReproduceReportSchema } from '../report-schemas.ts';
import {
  DEFAULT_MANIFEST,
  loadSeasonDraftCatalog,
  loadSeasonFreeAgencyIndex,
  loadSeasonRosterTargets,
  readJsonFile,
} from './season-data.ts';
import { loadPackagedData, PackagedData } from './data-loader.ts';
import { auditSeasonFreeAgencyFacts } from './season-free-agency-audit.ts';
import { sha256Hex } from '../io.ts';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export const SEASON_RUN_REPRODUCE_OPTIONS: Record<string, boolean> = {
  input: true,
  manifest: true,
  profile: true,
  format: true,
};

export interface SeasonRunReplayDivergence {
  ordinal: number | null;
  commandId: string;
  kind:
    | 'chain-fact'
    | 'rejected-command'
    | 'state-digest'
    | 'result-digest'
    | 'game-result'
    | 'award-result'
    | 'trade-grade-result'
    | 'champion'
    | 'free-agency';
  detail: string;
}

interface ReplayRunnerState {
  run: SeasonRun;
  effects: SeasonEffectsState;
  summaries: SeasonGameSummary[];
  acceptedCommandIds: string[];
  pending: SeasonPendingBlockCandidate | null;
}

export function replaySeasonRunExport(
  exportArtifact: SeasonRunReplayExport,
  deps: {
    catalog: import('@hoop-rush/data-contracts').SeasonDraftCatalog;
    profile: import('@hoop-rush/data-contracts').EraSimulationProfile;
    verifyAssetHashes: (expected: SeasonRunReplayExport['assetHashes']) => string[];

    freeAgencyIndex?: SeasonFreeAgencyIndex;

    freeAgencyTargets?: SeasonRosterTargets;
  },
): { divergence: SeasonRunReplayDivergence | null; divergences: string[] } {
  const exportArtifactParsed = seasonRunReplayExportSchema.parse(exportArtifact);
  const failures = deps.verifyAssetHashes(exportArtifactParsed.assetHashes);
  if (failures.length > 0) {
    return {
      divergence: {
        ordinal: null,
        commandId: '',
        kind: 'chain-fact',
        detail: failures[0] ?? 'asset hash mismatch',
      },
      divergences: failures,
    };
  }
  const chainFailures = chainFactsOf(exportArtifactParsed);
  if (chainFailures.length > 0) {
    const first = chainFailures[0] as string;
    const ordinal = ordinalOfFirstChainFailure(chainFailures);
    return {
      divergence: {
        ordinal,
        commandId:
          ordinal === null
            ? ''
            : (exportArtifactParsed.commandLog.entries[ordinal]?.command.commandId ?? ''),
        kind: 'chain-fact',
        detail: first,
      },
      divergences: chainFailures,
    };
  }
  if (exportArtifactParsed.initialRun === undefined) {
    return { divergence: null, divergences: [] };
  }
  return replayFromInitialRun(exportArtifactParsed, deps);
}

function chainFactsOf(exportArtifact: SeasonRunReplayExport): string[] {
  const failures: string[] = [];
  const entries = exportArtifact.commandLog.entries;
  const expectedDigest = seasonCommandLogDigest(entries);
  if (expectedDigest !== exportArtifact.almanac.commandLogDigest) {
    failures.push(
      `command log digest ${expectedDigest} does not match the almanac digest ${exportArtifact.almanac.commandLogDigest}`,
    );
  }
  let head = seasonCommandLogDigest([]);
  for (let ordinal = 0; ordinal < entries.length; ordinal += 1) {
    const entry = entries[ordinal];
    if (entry === undefined) continue;
    if (entry.ordinal !== ordinal) {
      failures.push(
        `ordinal gap at position ${String(ordinal)} (recorded ${String(entry.ordinal)})`,
      );
      break;
    }
    if (entry.runId !== exportArtifact.runId) {
      failures.push(
        `entry ${String(ordinal)} targets run ${entry.runId} instead of ${exportArtifact.runId}`,
      );
      break;
    }
    if (entry.command.runId !== exportArtifact.runId) {
      failures.push(`entry ${String(ordinal)} command targets run ${entry.command.runId}`);
      break;
    }
    if (entry.preStateRevision > entry.postStateRevision) {
      failures.push(
        `entry ${String(ordinal)} post-state revision ${String(entry.postStateRevision)} regresses below pre-state ${String(entry.preStateRevision)}`,
      );
      break;
    }
    if (entry.previousLogDigest !== head) {
      failures.push(
        `entry ${String(ordinal)} hash chain head ${entry.previousLogDigest} does not match the recomputed ${head}`,
      );
      break;
    }
    head = seasonCommandLogDigest(entries.slice(0, ordinal + 1));
  }
  return failures;
}

function ordinalOfFirstChainFailure(failures: readonly string[]): number | null {
  const first = failures[0];
  if (first === undefined) return null;
  const match = /entry (\d+)/.exec(first);
  return match === null ? null : Number(match[1]);
}

function runnerStateOf(
  exportArtifact: SeasonRunReplayExport,
  deps: {
    catalog: import('@hoop-rush/data-contracts').SeasonDraftCatalog;
    profile: import('@hoop-rush/data-contracts').EraSimulationProfile;
  },
): ReplayRunnerState {
  const initialRun = exportArtifact.initialRun;
  if (initialRun === undefined) {
    throw new Error('replay requires the export initial run');
  }
  const effects =
    exportArtifact.initialEffects ??
    createSeasonEffectsState(
      (() => {
        const expanded = expandSeasonRunRosters(initialRun, deps.catalog);
        const staminaInputs: import('@hoop-rush/data-contracts').SeasonStaminaInput[] = [];
        for (const player of expanded.values()) {
          if (player.stamina === undefined) {
            throw new Error(`expanded player ${player.playerVersionId} has no stamina profile`);
          }
          staminaInputs.push(player.stamina);
        }
        return staminaInputs;
      })(),
    );
  return {
    run: initialRun,
    effects,
    summaries: [],
    acceptedCommandIds: [],
    pending: null,
  };
}

function scheduleOf(state: ReplayRunnerState) {
  return generateSeasonSchedule({
    league: state.run.league,
    seed: state.run.schedule.generationSeed,
  });
}

function replayFromInitialRun(
  exportArtifact: SeasonRunReplayExport,
  deps: {
    catalog: import('@hoop-rush/data-contracts').SeasonDraftCatalog;
    profile: import('@hoop-rush/data-contracts').EraSimulationProfile;
    freeAgencyIndex?: SeasonFreeAgencyIndex;
    freeAgencyTargets?: SeasonRosterTargets;
  },
): { divergence: SeasonRunReplayDivergence | null; divergences: string[] } {
  const state = runnerStateOf(exportArtifact, deps);
  const divergences: string[] = [];
  const entries = exportArtifact.commandLog.entries;
  const humanFranchiseId = humanFranchiseIdOf(state.run.league);
  const schedule = scheduleOf(state);
  let replayedFreeAgencyCommands = 0;

  const divergenceOf = (
    ordinal: number,
    entry: SeasonRunReplayExport['commandLog']['entries'][number],
    kind: SeasonRunReplayDivergence['kind'],
    detail: string,
  ): SeasonRunReplayDivergence => ({
    ordinal,
    commandId: entry.command.commandId,
    kind,
    detail,
  });

  for (let ordinal = 0; ordinal < entries.length; ordinal += 1) {
    const entry = entries[ordinal];
    if (entry === undefined) break;
    const command = entry.command;
    const commandId = command.commandId;

    if (command.command === 'submit-season-block') {
      const blockResult = replayBlock(entry, state, deps, schedule, humanFranchiseId);
      if (blockResult.divergence !== null)
        return { divergence: blockResult.divergence, divergences: blockResult.divergences };
      divergences.push(...blockResult.divergences);
      continue;
    }

    const output = handleSeasonRunCommand(command, {
      run: state.run,
      pending: state.pending,
      humanFranchiseId,
      catalog: deps.catalog,
      effects: state.effects,
      profile: deps.profile,
      freeAgencyIndex: deps.freeAgencyIndex,
      freeAgencyTargets: deps.freeAgencyTargets,

      regularSeasonSummaries: state.summaries,
      postseasonGameResolver: defaultSeasonPostseasonGameResolver,
    });
    if (output.result.result.status === 'rejected') {
      const rejection = output.result.result.rejection;
      const detail =
        'reason' in rejection && typeof rejection.reason === 'string'
          ? rejection.reason
          : 'no recorded reason';
      return {
        divergence: divergenceOf(
          ordinal,
          entry,
          'rejected-command',
          `the command was rejected (${rejection.code}): ${detail}`,
        ),
        divergences: [...divergences, `ordinal ${String(ordinal)} ${commandId} rejected`],
      };
    }
    if (
      output.run.stateRevision !== entry.postStateRevision ||
      output.run.stateDigest !== entry.postStateDigest
    ) {
      return {
        divergence: divergenceOf(
          ordinal,
          entry,
          'state-digest',
          `post state r${String(output.run.stateRevision)}/${output.run.stateDigest} does not match expected r${String(entry.postStateRevision)}/${entry.postStateDigest}`,
        ),
        divergences: [
          ...divergences,
          `ordinal ${String(ordinal)} ${commandId} state digest diverged`,
        ],
      };
    }
    const summaryDigests = (output.postseasonSummaries ?? []).map(
      (summary) => summary.resultDigest,
    );
    const actualResultDigest = seasonCommandResultDigest({
      commandId,
      gameIds: entry.relatedGameIds,
      summaryDigests,
    });
    if (actualResultDigest !== entry.resultDigest) {
      const expectedGameIds = [...entry.relatedGameIds].sort();
      const actualGameIds = (output.postseasonSummaries ?? [])
        .map((summary) => summary.gameId)
        .sort();
      const kind: SeasonRunReplayDivergence['kind'] =
        expectedGameIds.join() === actualGameIds.join() ? 'result-digest' : 'game-result';
      return {
        divergence: divergenceOf(
          ordinal,
          entry,
          kind,
          `result digest ${actualResultDigest} does not match expected ${entry.resultDigest} (games ${actualGameIds.join(',')} vs ${expectedGameIds.join(',')})`,
        ),
        divergences: [...divergences, `ordinal ${String(ordinal)} ${commandId} result diverged`],
      };
    }
    const nextRun = output.run as SeasonRun & { effects?: SeasonEffectsState };
    state.run = nextRun;
    state.effects = nextRun.effects ?? state.effects;
    state.pending = output.pending;
    state.acceptedCommandIds = [...state.acceptedCommandIds, commandId];
    if (
      command.command === 'declare-free-agent-interest' ||
      command.command === 'skip-free-agent-market' ||
      command.command === 'resolve-free-agent-market'
    ) {
      replayedFreeAgencyCommands += 1;
    }
    if (output.postseasonSummaries !== undefined) {
      const gameIdMismatch = output.postseasonSummaries.some(
        (summary) => !entry.relatedGameIds.includes(summary.gameId),
      );
      if (gameIdMismatch) {
        return {
          divergence: divergenceOf(
            ordinal,
            entry,
            'game-result',
            'a regenerated postseason summary game id is not among the entry game ids',
          ),
          divergences,
        };
      }
    }
  }

  const freeAgencyFailures = freeAgencyReconciliationFailures(
    state.run,
    exportArtifact,
    replayedFreeAgencyCommands,
  );
  if (state.run.stateDigest !== exportArtifact.finalStateDigest) {
    if (freeAgencyFailures.length > 0) {
      return {
        divergence: {
          ordinal: null,
          commandId: '',
          kind: 'free-agency',
          detail: freeAgencyFailures[0] ?? 'free-agency facts diverged',
        },
        divergences: freeAgencyFailures,
      };
    }
    return {
      divergence: {
        ordinal: null,
        commandId: '',
        kind: 'state-digest',
        detail: `final state digest ${state.run.stateDigest} does not match the export ${exportArtifact.finalStateDigest}`,
      },
      divergences: [
        `final state digest ${state.run.stateDigest} does not match the export ${exportArtifact.finalStateDigest}`,
      ],
    };
  }

  if (freeAgencyFailures.length > 0) {
    return {
      divergence: {
        ordinal: null,
        commandId: '',
        kind: 'free-agency',
        detail: freeAgencyFailures[0] ?? 'free-agency facts diverged',
      },
      divergences: freeAgencyFailures,
    };
  }
  const champion = state.run.completion?.championFranchiseId ?? null;
  if (champion !== null && champion !== exportArtifact.championFranchiseId) {
    return {
      divergence: {
        ordinal: null,
        commandId: '',
        kind: 'champion',
        detail: `replayed champion ${champion} does not match the export ${exportArtifact.championFranchiseId}`,
      },
      divergences,
    };
  }

  const fullRegularSeason =
    state.summaries.filter((summary) => summary.round >= 1 && summary.round <= 82).length >= 1230;
  const recordedAwards = state.run.awards;
  if (fullRegularSeason) {
    const recomputed = deriveSeasonAwards({
      runId: exportArtifact.runId,
      rosters: state.run.rosters,
      summaries: state.summaries,
    });
    if (recordedAwards !== null && recordedAwards.digest !== seasonAwardsDigest(recomputed)) {
      return {
        divergence: {
          ordinal: null,
          commandId: '',
          kind: 'award-result',
          detail: `recorded awards digest ${recordedAwards.digest} does not recompute over the replayed facts (${seasonAwardsDigest(recomputed)})`,
        },
        divergences,
      };
    }
  }

  if (fullRegularSeason) {
    const recomputedGrades = deriveSeasonTradeGrades({
      runId: exportArtifact.runId,
      run: state.run,
      summaries: state.summaries,
      postseasonSummaries: exportArtifact.postseasonSummaries,
    });
    const recomputedDigest = seasonTradeGradeLogDigest(recomputedGrades);
    if (exportArtifact.almanac.tradeGradesDigest !== recomputedDigest) {
      return {
        divergence: {
          ordinal: null,
          commandId: '',
          kind: 'trade-grade-result',
          detail: `almanac trade-grades digest ${exportArtifact.almanac.tradeGradesDigest} does not recompute over the replayed facts (${recomputedDigest})`,
        },
        divergences,
      };
    }
  }
  return { divergence: null, divergences };
}

export function freeAgencyReconciliationFailures(
  run: SeasonRun,
  exportArtifact: SeasonRunReplayExport,
  replayedFreeAgencyCommands: number,
): string[] {
  const failures: string[] = [];
  const audit = auditSeasonFreeAgencyFacts(run);
  for (const failure of audit.failures) {
    failures.push(`replayed free-agency: ${failure}`);
  }
  if (replayedFreeAgencyCommands === 0 && exportArtifact.initialRun !== undefined) {
    const recorded = exportArtifact.initialRun.freeAgency;
    if (JSON.stringify(run.freeAgency) !== JSON.stringify(recorded)) {
      failures.push(
        'replayed free-agency state differs from the export pre-state although no free-agency command was replayed',
      );
    }
  }
  return failures;
}

function replayBlock(
  entry: SeasonRunReplayExport['commandLog']['entries'][number],
  state: ReplayRunnerState,
  deps: {
    catalog: import('@hoop-rush/data-contracts').SeasonDraftCatalog;
    profile: import('@hoop-rush/data-contracts').EraSimulationProfile;
  },
  schedule: ReturnType<typeof generateSeasonSchedule>,
  humanFranchiseId: string | null,
): { divergence: SeasonRunReplayDivergence | null; divergences: string[] } {
  const command = entry.command as SeasonSubmitBlockCommand;
  const input: SeasonBlockSimulationInput = {
    command,
    run: state.run,
    expanded: expandSeasonRunRosters(state.run, deps.catalog),
    schedule,
    catalog: deps.catalog,
    profile: deps.profile,
    humanFranchiseId,
    rosterPlayerIds: rosterPlayerIdsOf(state.run),
    priorSummaries: state.summaries,
    effects: state.effects,
    health: state.run.health,
    objectiveId: command.objectiveId,
    influence: state.run.influence,
    transactions: state.run.transactions,
  };
  let result;
  try {
    result = handleSubmitSeasonBlockCommand({
      ...input,
      acceptedCommandIds: state.acceptedCommandIds,
    });
  } catch (error) {
    return {
      divergence: {
        ordinal: entry.ordinal,
        commandId: command.commandId,
        kind: 'rejected-command',
        detail: `the block pipeline rejected ${command.commandId}: ${(error as Error).message}`,
      },
      divergences: [],
    };
  }
  if (result.status === 'rejected') {
    return {
      divergence: {
        ordinal: entry.ordinal,
        commandId: command.commandId,
        kind: 'rejected-command',
        detail: `the block pipeline rejected ${command.commandId} (${result.rejection.code})`,
      },
      divergences: [],
    };
  }
  const checkpoint = result.checkpoint;
  state.summaries = [...state.summaries, ...checkpoint.gameSummaries];
  state.acceptedCommandIds = [...state.acceptedCommandIds, command.commandId];
  state.effects = checkpoint.effects;
  const stateFacts = deriveSeasonPostBlockState({
    run: state.run,
    candidate: checkpoint,
    commandId: command.commandId,
    rotationDigest: command.rotationDigest,
  });
  state.run = {
    ...state.run,
    cursor: { schemaVersion: 1, completedRounds: checkpoint.completedRounds },
    standings: checkpoint.standings,
    health: checkpoint.health,
    influence: checkpoint.influence,
    transactions: checkpoint.transactions,
    checkpointState: stateFacts.checkpointState,
    stateRevision: stateFacts.stateRevision,
    stateDigest: stateFacts.stateDigest,
  };
  if (
    stateFacts.stateRevision !== entry.postStateRevision ||
    stateFacts.stateDigest !== entry.postStateDigest
  ) {
    return {
      divergence: {
        ordinal: entry.ordinal,
        commandId: command.commandId,
        kind: 'state-digest',
        detail: `block post state r${String(stateFacts.stateRevision)}/${stateFacts.stateDigest} does not match expected r${String(entry.postStateRevision)}/${entry.postStateDigest}`,
      },
      divergences: [],
    };
  }
  return { divergence: null, divergences: [] };
}

export function seasonRunReproduce(args: {
  input: string | null;
  manifest: string | null;
  profile: string | null;
}): CliReport {
  const inputPath = args.input;
  if (inputPath === null) {
    throw new Error('season run reproduce requires --input <replay-export.json>');
  }
  const parsed = seasonRunReplayExportSchema.safeParse(readJsonFile(inputPath));
  if (!parsed.success) {
    return makeReport(
      'season run reproduce',
      { input: inputPath },
      {
        failures: [
          `replay export fails the schema: ${parsed.error.issues[0]?.message ?? 'unknown'}`,
        ],
        exitCode: 2,
      },
    );
  }
  const exportArtifact = parsed.data;
  const manifestPath = args.manifest ?? DEFAULT_MANIFEST;
  const catalog = loadSeasonDraftCatalog(manifestPath);
  const packaged = loadPackagedData(manifestPath);
  const profile = new PackagedData(packaged.manifest, packaged.dir).eraProfile(
    exportArtifact.eraId,
  );

  let freeAgencyIndex: import('@hoop-rush/data-contracts').SeasonFreeAgencyIndex | undefined;
  let freeAgencyTargets: import('@hoop-rush/data-contracts').SeasonRosterTargets | undefined;
  if (exportArtifact.assetHashes.freeAgencyIndex !== undefined) {
    freeAgencyIndex = loadSeasonFreeAgencyIndex(manifestPath);
  }
  if (exportArtifact.assetHashes.freeAgencyTargets !== undefined) {
    freeAgencyTargets = loadSeasonRosterTargets(manifestPath);
  }

  const verifyAssetHashes = (expected: SeasonRunReplayExport['assetHashes']): string[] => {
    const failures: string[] = [];
    const expectedOf = (
      entry: { url: string; contentHash: string } | undefined,
      key: keyof SeasonRunReplayExport['assetHashes'],
      label: string,
    ): void => {
      if (entry === undefined) {
        failures.push(`manifest has no ${label} asset to verify`);
        return;
      }
      const actual = sha256Hex(readFileSync(resolve(packaged.dir, entry.url)));
      if (actual !== expected[key]) {
        failures.push(
          `${label} content hash ${actual} does not match the export hash ${String(expected[key])}`,
        );
      }
    };
    expectedOf(packaged.manifest.season?.league, 'league', 'league');
    expectedOf(packaged.manifest.season?.schedule, 'schedule', 'schedule');
    expectedOf(packaged.manifest.season?.draftCatalog, 'draftCatalog', 'draftCatalog');
    if (expected.freeAgencyIndex !== undefined) {
      expectedOf(packaged.manifest.season?.freeAgencyIndex, 'freeAgencyIndex', 'freeAgencyIndex');
    }
    if (expected.freeAgencyTargets !== undefined) {
      expectedOf(
        packaged.manifest.season?.freeAgencyTargets,
        'freeAgencyTargets',
        'freeAgencyTargets',
      );
    }
    const eraEntry = packaged.manifest.eraSimulationProfiles.find(
      (entry) => entry.eraId === exportArtifact.eraId,
    );
    if (eraEntry === undefined) {
      failures.push(`manifest has no era profile for ${exportArtifact.eraId}`);
    } else {
      const actual = sha256Hex(readFileSync(resolve(packaged.dir, eraEntry.url)));
      if (actual !== expected.eraProfile) {
        failures.push(
          `eraProfile content hash ${actual} does not match the export hash ${expected.eraProfile}`,
        );
      }
    }
    return failures;
  };

  const { divergence, divergences } = replaySeasonRunExport(exportArtifact, {
    catalog,
    profile,
    verifyAssetHashes,
    freeAgencyIndex,
    freeAgencyTargets,
  });

  const chainVerified = divergence === null || divergence.kind !== 'chain-fact';
  const pass = divergence === null;
  const payload = seasonRunReproduceReportSchema.parse({
    schemaVersion: 1,
    command: 'season run reproduce',
    runId: exportArtifact.runId,
    rootSeed: exportArtifact.rootSeed,
    eraId: exportArtifact.eraId,
    commandCount: exportArtifact.commandLog.entries.length,
    replayedCount: pass ? exportArtifact.commandLog.entries.length : (divergence.ordinal ?? 0),
    blockCount: exportArtifact.commandLog.entries.filter(
      (entry) => entry.command.command === 'submit-season-block',
    ).length,
    expectedCommandLogDigest: seasonCommandLogDigest(exportArtifact.commandLog.entries),
    expectedFinalStateDigest: exportArtifact.finalStateDigest,
    expectedAlmanacDigest: exportArtifact.almanac.digest,
    expectedChampionFranchiseId: exportArtifact.championFranchiseId,
    verifiedChainFacts: chainVerified,
    verifiedInitialRun: exportArtifact.initialRun !== undefined,
    verifiedFinalStateDigest: pass,
    verifiedAwards: pass,
    verifiedChampion: pass,
    firstDivergence: divergence,
    divergences,
    pass,
  });

  const details = [
    `run ${exportArtifact.runId} · seed ${exportArtifact.rootSeed} · era ${exportArtifact.eraId}`,
    `${String(exportArtifact.commandLog.entries.length)} commands${exportArtifact.initialRun === undefined ? ' (chain-only verification: the export carries no initial run)' : ''}`,
    `command log digest ${payload.expectedCommandLogDigest} · almanac ${payload.expectedAlmanacDigest}`,
    `champion ${exportArtifact.championFranchiseId} · final state digest ${exportArtifact.finalStateDigest}`,
  ];
  if (divergence !== null) {
    details.push(
      `first divergence at ordinal ${String(divergence.ordinal)} (${divergence.commandId}, ${divergence.kind}): ${divergence.detail}`,
    );
  } else {
    details.push('replay reproduced the export exactly');
  }
  return makeReport(
    'season run reproduce',
    { input: inputPath },
    { details, failures: divergences, payload },
  );
}
