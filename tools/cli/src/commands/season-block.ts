import { resolve } from 'node:path';
import {
  humanFranchiseIdOf,
  SEASON_BLOCK_COUNT,
  SEASON_BLOCK_VERSION,
  SEASON_COURT_INNOVATION_VERSION,
  SEASON_RUN_SCHEMA_VERSION,
  commandIdSchema,
  seasonCandidateCheckpointSchema,
  seasonRunSchema,
  seasonScheduleSchema,
  type EraSimulationProfile,
  type SeasonCandidateCheckpoint,
  type SeasonChallengeDeal,
  type SeasonCheckpointState,
  type SeasonDraftCatalog,
  type SeasonGamePlayerInput,
  type SeasonGameSummary,
  type SeasonHealthState,
  type SeasonObjectiveId,
  type SeasonRun,
  type SeasonSchedule,
  type SeasonSubmitBlockCommand,
} from '@hoop-rush/data-contracts';
import {
  SeasonBlockValidationError,
  auditSeasonBlock,
  buildEvolutionDataSource,
  createSeasonEffectsState,
  dealSeasonBlockChallenges,
  deriveSeasonPostBlockState,
  evolutionSelectionGate,
  expandSeasonRunRosters,
  handleSubmitSeasonBlockCommand,
  rosterPlayerIdsOf,
  seasonCheckpointDigest,
  seasonNextBlockIndex,
  seasonRotationSetDigest,
  type SeasonBlockSimulationInput,
} from '@hoop-rush/engine';
import type { SeasonEffectsState, SeasonStaminaInput } from '@hoop-rush/data-contracts';
import { makeReport, type CliReport } from '../report.ts';
import {
  seasonBlockAuditReportSchema,
  seasonBlockSimulateReportSchema,
  seasonFullSimulateReportSchema,
} from '../report-schemas.ts';
import { loadPackagedData, PackagedData } from './data-loader.ts';
import {
  DEFAULT_MANIFEST,
  DEFAULT_SEASON_DIR,
  loadSeasonDraftCatalog,
  readJsonFile,
} from './season-data.ts';
export const SEASON_BLOCK_SIMULATE_OPTIONS: Record<string, boolean> = {
  input: true,
  block: true,
  manifest: true,
  profile: true,
  format: true,
};
export const SEASON_BLOCK_AUDIT_OPTIONS: Record<string, boolean> = {
  input: true,
  run: true,
  manifest: true,
  profile: true,
  format: true,
};
export const SEASON_FULL_SIMULATE_OPTIONS: Record<string, boolean> = {
  input: true,
  manifest: true,
  profile: true,
  format: true,
};
export const DEFAULT_RUN_FIXTURE = resolve(
  new URL('../fixtures/', import.meta.url).pathname
    .replace(/^\/([A-Za-z]:)/, '$1')
    .replace(/%20/g, ' '),
  'season-run.json',
);
export const DEFAULT_SCHEDULE = resolve(DEFAULT_SEASON_DIR, 'schedule.json');
export interface SeasonBlockRunnerState {
  run: SeasonRun;
  catalog: SeasonDraftCatalog;
  schedule: SeasonSchedule;
  expanded: Map<string, SeasonGamePlayerInput>;
  profile: EraSimulationProfile;
  humanFranchiseId: string | null;
  rosterPlayerIds: Map<string, string>;
  summaries: SeasonGameSummary[];
  acceptedCommandIds: string[];
  effects: SeasonEffectsState;
  health: SeasonHealthState;
  objectiveId: SeasonObjectiveId | null;
  challengeDeal?: SeasonChallengeDeal | null;
  checkpointState: SeasonCheckpointState | null;
  stateRevision: number;
  stateDigest: string;
}
export function loadSeasonRunFixture(path: string): SeasonRun {
  const parsed = seasonRunSchema.safeParse(readJsonFile(path));
  if (!parsed.success) {
    throw new Error(
      `season run ${path} fails the schema: ${parsed.error.issues[0]?.message ?? 'unknown'}`,
    );
  }
  return parsed.data;
}
export function createSeasonBlockRunner(
  options: {
    runPath?: string | null;
    manifestPath?: string | null;
    profileEra?: string | null;
  } = {},
): SeasonBlockRunnerState {
  const runPath = options.runPath ?? DEFAULT_RUN_FIXTURE;
  const run = loadSeasonRunFixture(resolve(runPath));
  const manifestPath = options.manifestPath ?? DEFAULT_MANIFEST;
  const catalog = loadSeasonDraftCatalog(manifestPath);
  const schedule = seasonScheduleSchema.parse(readJsonFile(DEFAULT_SCHEDULE));
  const packaged = loadPackagedData(manifestPath);
  const profile = new PackagedData(packaged.manifest, packaged.dir).eraProfile(
    options.profileEra ?? '1990s',
  );
  const humanFranchiseId = humanFranchiseIdOf(run.league);
  const expanded = expandSeasonRunRosters(run, catalog);
  return {
    run,
    catalog,
    schedule,
    expanded,
    profile,
    humanFranchiseId,
    rosterPlayerIds: rosterPlayerIdsOf(run),
    summaries: [],
    acceptedCommandIds: [],
    effects: initialEffectsState(expanded),
    health: run.health,
    objectiveId: null,
    challengeDeal:
      (
        run as unknown as {
          challenges?: { deals?: Record<string, SeasonChallengeDeal | undefined> } | null;
        }
      ).challenges?.deals?.['0'] ?? null,
    checkpointState: run.checkpointState,
    stateRevision: run.stateRevision,
    stateDigest: run.stateDigest,
  };
}
export function initialEffectsState(
  expanded: ReadonlyMap<string, SeasonGamePlayerInput>,
): SeasonEffectsState {
  const staminaInputs: SeasonStaminaInput[] = [];
  for (const player of expanded.values()) {
    if (player.stamina === undefined) {
      throw new Error(`expanded player ${player.playerVersionId} has no stamina profile`);
    }
    staminaInputs.push(player.stamina);
  }
  return createSeasonEffectsState(staminaInputs);
}
export function runnerNextBlockIndex(state: SeasonBlockRunnerState): number {
  const next = seasonNextBlockIndex(state.run.cursor.completedRounds);
  if (next === null) {
    throw new Error(
      `season run ${state.run.runId} is complete (cursor ${String(state.run.cursor.completedRounds)})`,
    );
  }
  return next;
}
export function ensureChallengeDeal(state: SeasonBlockRunnerState, blockIndex: number): void {
  if (blockIndex < 0 || blockIndex > 7 || state.humanFranchiseId === null) {
    state.challengeDeal = null;
    return;
  }
  const existing = (
    state.run as unknown as {
      challenges?: { deals?: Record<string, SeasonChallengeDeal | undefined> } | null;
    }
  ).challenges?.deals?.[String(blockIndex)];
  if (existing !== undefined) {
    state.challengeDeal = existing;
    return;
  }
  const deal = dealSeasonBlockChallenges(state.run.rootSeed, blockIndex, {
    league: state.run.league,
    schedule: state.schedule,
    standings: state.run.standings,
    humanFranchiseId: state.humanFranchiseId,
  });
  state.challengeDeal = deal;
  if (deal !== null) {
    const challenges = (
      state.run as unknown as {
        challenges?: {
          schemaVersion: 1;
          challengeVersion: string;
          catalog: unknown[];
          deals: Record<string, unknown>;
          evaluations: unknown[];
        } | null;
      }
    ).challenges;
    if (challenges !== undefined && challenges !== null) {
      state.run = {
        ...state.run,
        challenges: {
          ...challenges,
          deals: { ...challenges.deals, [blockIndex]: deal },
        },
      } as SeasonRun;
    }
  }
}
export function runnerBlockCommand(
  state: SeasonBlockRunnerState,
  blockIndex: number,
): SeasonSubmitBlockCommand {
  const challengeDeal = state.challengeDeal ?? null;
  return {
    schemaVersion: SEASON_RUN_SCHEMA_VERSION,
    blockVersion: SEASON_BLOCK_VERSION,
    command: 'submit-season-block',
    commandId: commandIdSchema.parse(
      `season-block-${String(blockIndex)}-${String(state.acceptedCommandIds.length)}`,
    ),
    runId: state.run.runId,
    expectedRevision: state.acceptedCommandIds.length,
    blockIndex,
    rotationDigest: seasonRotationSetDigest(state.run.rotations),
    objectiveId: state.objectiveId,
    ...(challengeDeal !== null ? { challengeIds: [...challengeDeal.challengeIds] } : {}),
    expectedStateRevision: state.stateRevision,
    expectedStateDigest: state.stateDigest,
  };
}
export function runnerPipelineInput(
  state: SeasonBlockRunnerState,
  command: SeasonSubmitBlockCommand,
): SeasonBlockSimulationInput {
  return {
    command,
    run: state.run,
    expanded: state.expanded,
    schedule: state.schedule,
    catalog: state.catalog,
    profile: state.profile,
    humanFranchiseId: state.humanFranchiseId,
    rosterPlayerIds: state.rosterPlayerIds,
    priorSummaries: state.summaries,
    effects: state.effects,
    health: state.health,
    objectiveId: state.objectiveId,
    challengeDeal: state.challengeDeal ?? null,
  };
}
export function ensureEvolutionSelection(state: SeasonBlockRunnerState, blockIndex: number): void {
  if (blockIndex < 3 || state.humanFranchiseId === null) return;
  const gate = evolutionSelectionGate({
    blockIndex,
    run: state.run,
    humanFranchiseId: state.humanFranchiseId,
  });
  if (gate === null) return;
  const humanFid = state.humanFranchiseId;
  const current = (
    state.run as unknown as {
      evolution?: {
        selections?: Record<string, unknown>;
      } | null;
    }
  ).evolution;
  const selections = { ...(current?.selections ?? {}) };
  if (selections[humanFid] !== undefined) return;
  selections[humanFid] = {
    franchiseId: humanFid,
    innovationId: 'deep-four',
    version: SEASON_COURT_INNOVATION_VERSION,
    selectedByCommandId: `evo-auto-${String(blockIndex)}`,
    aiSelected: false,
    inputDigest: null,
  };
  state.run = {
    ...state.run,
    evolution: { ...(current ?? {}), selections },
  } as SeasonRun;
}
export function runBlockThroughHandler(
  state: SeasonBlockRunnerState,
  blockIndex: number,
): SeasonCandidateCheckpoint {
  ensureEvolutionSelection(state, blockIndex);
  ensureChallengeDeal(state, blockIndex);
  const command = runnerBlockCommand(state, blockIndex);
  const input = runnerPipelineInput(state, command);
  const result = handleSubmitSeasonBlockCommand({
    ...input,
    acceptedCommandIds: state.acceptedCommandIds,
  });
  if (result.status === 'rejected') {
    throw new SeasonBlockValidationError(result.rejection);
  }
  const checkpoint = result.checkpoint;
  const priorSummaries = state.summaries;
  state.summaries = [...state.summaries, ...checkpoint.gameSummaries];
  state.acceptedCommandIds = [...state.acceptedCommandIds, command.commandId];
  state.effects = checkpoint.effects;
  state.health = checkpoint.health;
  const stateFacts = deriveSeasonPostBlockState({
    run: state.run,
    candidate: checkpoint,
    commandId: command.commandId,
    rotationDigest: command.rotationDigest,
    humanFranchiseId: state.humanFranchiseId,
    evolutionData: buildEvolutionDataSource({
      run: state.run,
      candidate: checkpoint,
      priorSummaries,
      schedule: state.schedule,
    }),
  });
  state.checkpointState = stateFacts.checkpointState;
  state.stateRevision = stateFacts.stateRevision;
  state.stateDigest = stateFacts.stateDigest;
  const runChallenges = (
    state.run as unknown as {
      challenges?: import('@hoop-rush/data-contracts').SeasonChallengeState | null;
    }
  ).challenges;
  const nextChallenges =
    runChallenges !== undefined &&
    runChallenges !== null &&
    checkpoint.challenges !== undefined &&
    !runChallenges.evaluations.some(
      (entry) => entry.blockIndex === checkpoint.challenges?.blockIndex,
    )
      ? {
          ...runChallenges,
          evaluations: [...runChallenges.evaluations, checkpoint.challenges].sort(
            (a, b) => a.blockIndex - b.blockIndex,
          ),
        }
      : runChallenges;
  state.run = {
    ...state.run,
    evolution: stateFacts.evolution,
    cursor: { schemaVersion: 1, completedRounds: checkpoint.completedRounds },
    standings: checkpoint.standings,
    health: checkpoint.health,
    influence: checkpoint.influence,
    transactions: checkpoint.transactions,
    checkpointState: stateFacts.checkpointState,
    stateRevision: stateFacts.stateRevision,
    stateDigest: stateFacts.stateDigest,
    ...(nextChallenges !== undefined ? { challenges: nextChallenges } : {}),
  } as unknown as typeof state.run;
  return checkpoint;
}
export function rollForwardTo(state: SeasonBlockRunnerState, targetBlockIndex: number): void {
  for (;;) {
    const next = runnerNextBlockIndex(state);
    if (next >= targetBlockIndex) return;
    runBlockThroughHandler(state, next);
  }
}
function validateBlockOption(block: string | null, state: SeasonBlockRunnerState): number {
  if (block === null) return runnerNextBlockIndex(state);
  const blockIndex = Number.parseInt(block, 10);
  if (!Number.isInteger(blockIndex) || blockIndex < 0 || blockIndex >= SEASON_BLOCK_COUNT) {
    throw new Error(`--block must be an integer from 0..8 (got "${block}")`);
  }
  return blockIndex;
}
export function seasonBlockSimulate(args: {
  input: string | null;
  block: string | null;
  manifest: string | null;
  profile: string | null;
}): CliReport {
  const state = createSeasonBlockRunner({
    runPath: args.input,
    manifestPath: args.manifest,
    profileEra: args.profile,
  });
  const blockIndex = validateBlockOption(args.block, state);
  rollForwardTo(state, blockIndex);
  ensureChallengeDeal(state, blockIndex);
  const command = runnerBlockCommand(state, blockIndex);
  const input = runnerPipelineInput(state, command);
  const started = performance.now();
  const checkpoint = runBlockThroughHandler(state, blockIndex);
  const durationMs = performance.now() - started;
  const auditFailures = auditSeasonBlock(checkpoint, input);
  const payload = seasonBlockSimulateReportSchema.parse({
    schemaVersion: 1,
    command: 'season block simulate',
    runId: state.run.runId,
    blockIndex: checkpoint.blockIndex,
    expectedRevision: checkpoint.revision,
    rotationDigest: checkpoint.rotationDigest,
    completedRounds: checkpoint.completedRounds,
    summaryCount: checkpoint.gameSummaries.length,
    retainedDetailCount: checkpoint.retainedDetails.length,
    objectiveId: checkpoint.objective?.objectiveId ?? null,
    stateRevision: checkpoint.stateRevision,
    stateDigest: checkpoint.stateDigest,
    digest: checkpoint.digest,
    durationMs,
    auditFailures,
    rejection: null,
    pass: auditFailures.length === 0,
  });
  const details = [
    `run ${state.run.runId} · block ${String(checkpoint.blockIndex)} · revision ${String(checkpoint.revision)} · rounds ${String(checkpoint.completedRounds)}`,
    `summaries ${String(checkpoint.gameSummaries.length)} · retained details ${String(checkpoint.retainedDetails.length)}`,
    `objective ${checkpoint.objective?.objectiveId ?? checkpoint.challengeIds?.join('+') ?? 'none'} · state revision ${String(checkpoint.stateRevision)} · state digest ${checkpoint.stateDigest}`,
    `digest ${checkpoint.digest} in ${durationMs.toFixed(0)}ms`,
    `audit failures: ${String(auditFailures.length)}`,
  ];
  details.push(...auditFailures.slice(0, 10));
  return makeReport(
    'season block simulate',
    { run: state.run.runId, block: blockIndex },
    { details, failures: auditFailures, payload },
  );
}
export function seasonBlockAudit(args: {
  input: string | null;
  run: string | null;
  manifest: string | null;
  profile: string | null;
}): CliReport {
  const inputPath = args.input;
  if (inputPath === null) {
    throw new Error('season block audit requires --input <checkpoint.json>');
  }
  const parsed = seasonCandidateCheckpointSchema.safeParse(readJsonFile(inputPath));
  if (!parsed.success) {
    return makeReport(
      'season block audit',
      { input: inputPath },
      {
        failures: [
          `candidate fails the checkpoint schema: ${parsed.error.issues[0]?.message ?? 'unknown'}`,
        ],
        exitCode: 2,
      },
    );
  }
  const candidate = parsed.data;
  const state = createSeasonBlockRunner({
    runPath: args.run,
    manifestPath: args.manifest,
    profileEra: args.profile,
  });
  rollForwardTo(state, candidate.blockIndex);
  const command = runnerBlockCommand(state, candidate.blockIndex);
  const input = runnerPipelineInput(state, command);
  const auditFailures = auditSeasonBlock(candidate, input);
  const recomputed = seasonCheckpointDigestOf(candidate);
  const payload = seasonBlockAuditReportSchema.parse({
    schemaVersion: 1,
    command: 'season block audit',
    runId: state.run.runId,
    blockIndex: candidate.blockIndex,
    digest: candidate.digest,
    recomputedDigest: recomputed,
    auditFailures,
    pass: auditFailures.length === 0 && recomputed === candidate.digest,
  });
  const details = [
    `run ${state.run.runId} · block ${String(candidate.blockIndex)} · rounds ${String(candidate.completedRounds)}`,
    `digest ${candidate.digest} · recomputed ${recomputed}`,
    `audit failures: ${String(auditFailures.length)}`,
  ];
  details.push(...auditFailures.slice(0, 10));
  return makeReport(
    'season block audit',
    { input: inputPath },
    { details, failures: auditFailures, payload },
  );
}
function seasonCheckpointDigestOf(candidate: SeasonCandidateCheckpoint): string {
  return seasonCheckpointDigest(candidate);
}
export function seasonFullSimulate(args: {
  input: string | null;
  manifest: string | null;
  profile: string | null;
}): CliReport {
  const state = createSeasonBlockRunner({
    runPath: args.input,
    manifestPath: args.manifest,
    profileEra: args.profile,
  });
  const blockDigests: Array<{
    blockIndex: number;
    digest: string;
    durationMs: number;
  }> = [];
  const auditFailures: string[] = [];
  const started = performance.now();
  let stateChainContinuity = true;
  let previousPostState: {
    stateRevision: number;
    stateDigest: string;
  } | null = null;
  const tradeWindowsOpened = 0;
  for (let blockIndex = 0; blockIndex < SEASON_BLOCK_COUNT; blockIndex += 1) {
    ensureChallengeDeal(state, blockIndex);
    const command = runnerBlockCommand(state, blockIndex);
    const input = runnerPipelineInput(state, command);
    const blockStarted = performance.now();
    const checkpoint = runBlockThroughHandler(state, blockIndex);
    if (
      previousPostState !== null &&
      (checkpoint.expectedStateRevision !== previousPostState.stateRevision ||
        checkpoint.expectedStateDigest !== previousPostState.stateDigest)
    ) {
      stateChainContinuity = false;
      auditFailures.push(
        `block ${String(blockIndex)} expected state facts do not match the previous post-block facts (expected r${String(checkpoint.expectedStateRevision)}/d${checkpoint.expectedStateDigest}, previous r${String(previousPostState.stateRevision)}/d${previousPostState.stateDigest})`,
      );
    }
    previousPostState = {
      stateRevision: state.stateRevision,
      stateDigest: state.stateDigest,
    };
    auditFailures.push(...auditSeasonBlock(checkpoint, input));
    blockDigests.push({
      blockIndex,
      digest: checkpoint.digest,
      durationMs: performance.now() - blockStarted,
    });
  }
  const totalDurationMs = performance.now() - started;
  const finalDigest = blockDigests[blockDigests.length - 1]?.digest ?? '';
  const finalCheckpoint = state.checkpointState;
  const payload = seasonFullSimulateReportSchema.parse({
    schemaVersion: 1,
    command: 'season full simulate',
    runId: state.run.runId,
    blockDigests,
    finalDigest,
    totalDurationMs,
    summaries: state.summaries.length,
    stateRevision: state.stateRevision,
    stateDigest: state.stateDigest,
    stateChainContinuity,
    finalInjuryCount: state.health.injuries.length,
    finalTransactionCount: state.run.transactions.length,
    tradeWindowsOpened,
    auditFailures,
    pass: auditFailures.length === 0 && stateChainContinuity,
  });
  const details = [
    `run ${state.run.runId} · ${String(blockDigests.length)} blocks · ${String(state.summaries.length)} summaries in ${totalDurationMs.toFixed(0)}ms`,
    ...blockDigests.map(
      (entry) =>
        `block ${String(entry.blockIndex)} ${entry.digest} (${entry.durationMs.toFixed(0)}ms)`,
    ),
    `final digest ${finalDigest}`,
    `state chain r${String(state.stateRevision)} / ${state.stateDigest} · continuity ${stateChainContinuity ? 'ok' : 'BROKEN'}`,
    `final health injuries ${String(state.health.injuries.length)} · transactions ${String(state.run.transactions.length)}${finalCheckpoint === null ? '' : ` · checkpoint block ${String(finalCheckpoint.blockIndex)}`}`,
    `audit failures: ${String(auditFailures.length)}`,
  ];
  details.push(...auditFailures.slice(0, 10));
  return makeReport(
    'season full simulate',
    { run: state.run.runId },
    { details, failures: auditFailures, payload },
  );
}
