import { resolve } from 'node:path';
import {
  humanFranchiseIdOf,
  SEASON_BLOCK_COUNT,
  SEASON_BLOCK_VERSION,
  SEASON_RUN_SCHEMA_VERSION,
  seasonCandidateCheckpointSchema,
  seasonRunSchema,
  seasonScheduleSchema,
  type EraSimulationProfile,
  type SeasonCandidateCheckpoint,
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
  createSeasonEffectsState,
  deriveSeasonPostBlockState,
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

/**
 * M2.3 `season block` commands (spec/2.0/02 ten-game blocks, spec/2.0/07).
 * All commands run the authoritative engine pipeline over a committed run
 * fixture (or a generated league) and the packaged catalog, schedule, and
 * era profile; the injectable `deps` seam lets tests substitute doubles.
 *
 * M2.5 (contract §9/§20): the pipeline input gains the pre-block `health`
 * state and the locked `objectiveId`; the runner threads the post-block
 * health/influence/transactions facts and the run state chain
 * (`checkpointState`/`stateRevision`/`stateDigest`) through the engine's
 * `deriveSeasonPostBlockState`. The fixture-driven commands simulate with an
 * empty health state and a null objective (they assert structure, not
 * economy facts); the M2.5 calibration cohorts (`season-m25-core.ts`) drive
 * health, windows, and objectives forward the same way.
 *
 * The committed schema-6 fixture stays frozen until the lead regenerates it
 * under schema 7 (M2.5 fields); until then `createSeasonBlockRunner` fails
 * the schema parse by design.
 */

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

/** The committed M2.1 run fixture (regenerated under schema v4 by M2.3). */
export const DEFAULT_RUN_FIXTURE = resolve(
  new URL('../fixtures/', import.meta.url).pathname
    .replace(/^\/([A-Za-z]:)/, '$1')
    .replace(/%20/g, ' '),
  'season-run.json',
);

export const DEFAULT_SCHEDULE = resolve(DEFAULT_SEASON_DIR, 'schedule.json');

/** Everything the block commands need to run the engine pipeline. */
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
  /** M2.4: the authoritative effects state (post-block of the last run). */
  effects: SeasonEffectsState;
  /** M2.5: the run-scoped health state (post-block of the last run). */
  health: SeasonHealthState;
  /** M2.5: the locked objective for the next block (null unless selected). */
  objectiveId: SeasonObjectiveId | null;
  /** M2.5: post-block run state chain facts (deriveSeasonPostBlockState). */
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

/** Builds the runner state from a run fixture and the packaged artifacts. */
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
    checkpointState: run.checkpointState,
    stateRevision: run.stateRevision,
    stateDigest: run.stateDigest,
  };
}

/**
 * The schema-v6 run's initial M2.4 effects state: every expanded player must
 * carry the build-time stamina profile (the catalog derives it), so the
 * league-wide zero state is constructed from exactly 300 inputs.
 */
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

/** The 0-based block the run cursor expects next. */
export function runnerNextBlockIndex(state: SeasonBlockRunnerState): number {
  const next = seasonNextBlockIndex(state.run.cursor.completedRounds);
  if (next === null) {
    throw new Error(
      `season run ${state.run.runId} is complete (cursor ${String(state.run.cursor.completedRounds)})`,
    );
  }
  return next;
}

/** Builds the SubmitSeasonBlock command for the next expected block. */
export function runnerBlockCommand(
  state: SeasonBlockRunnerState,
  blockIndex: number,
): SeasonSubmitBlockCommand {
  return {
    schemaVersion: SEASON_RUN_SCHEMA_VERSION,
    blockVersion: SEASON_BLOCK_VERSION,
    command: 'submit-season-block',
    commandId: `season-block-${String(blockIndex)}-${String(state.acceptedCommandIds.length)}`,
    runId: state.run.runId,
    expectedRevision: state.acceptedCommandIds.length,
    blockIndex,
    rotationDigest: seasonRotationSetDigest(state.run.rotations),
    // M2.5: the locked objective (null for fixture-driven runs) and the
    // asserted run state chain facts.
    objectiveId: state.objectiveId,
    expectedStateRevision: state.stateRevision,
    expectedStateDigest: state.stateDigest,
  };
}

/** The pipeline input shape for the run's current cursor. */
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
    // M2.5: the pre-block health state and the locked block objective.
    health: state.health,
    objectiveId: state.objectiveId,
  };
}

/**
 * Runs one block through the authoritative command handler and advances the
 * runner state exactly like the persistence acceptance path: summaries
 * append, the command id is recorded, the run cursor/standings advance, and
 * (M2.5) the post-block health/influence/transactions facts and the run
 * state chain (checkpointState/stateRevision/stateDigest) fold into the
 * runner through the engine's `deriveSeasonPostBlockState`.
 */
export function runBlockThroughHandler(
  state: SeasonBlockRunnerState,
  blockIndex: number,
): SeasonCandidateCheckpoint {
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
  state.summaries = [...state.summaries, ...checkpoint.gameSummaries];
  state.acceptedCommandIds = [...state.acceptedCommandIds, command.commandId];
  state.effects = checkpoint.effects;
  // M2.5: the candidate freezes the authoritative post-block health state;
  // the engine derives the state chain facts from the run + candidate.
  state.health = checkpoint.health;
  const stateFacts = deriveSeasonPostBlockState({
    run: state.run,
    candidate: checkpoint,
    commandId: command.commandId,
    rotationDigest: command.rotationDigest,
  });
  state.checkpointState = stateFacts.checkpointState;
  state.stateRevision = stateFacts.stateRevision;
  state.stateDigest = stateFacts.stateDigest;
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
  return checkpoint;
}

/** Simulates every block up to (not including) `targetBlockIndex` (resume). */
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
    objectiveId: checkpoint.objective.objectiveId,
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
    `objective ${checkpoint.objective.objectiveId ?? 'none'} · state revision ${String(checkpoint.stateRevision)} · state digest ${checkpoint.stateDigest}`,
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
  // Resume from the last accepted checkpoint facts: replay earlier blocks
  // deterministically, then audit the stored candidate against the fresh
  // state (aggregates, standings, recap, and digest are all reconciled).
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
  const blockDigests: Array<{ blockIndex: number; digest: string; durationMs: number }> = [];
  const auditFailures: string[] = [];
  const started = performance.now();
  // M2.5: the state-chain audit (contract §17 replay/audit extension): every
  // block's expectedStateRevision/expectedStateDigest must equal the previous
  // block's post-block facts, so stateDigest continuity is verified across
  // the whole season.
  let stateChainContinuity = true;
  let previousPostState: { stateRevision: number; stateDigest: string } | null = null;
  // The fixture-driven full-season path never drives the economy, so no
  // trade window opens here (the M2.5 calibration cohorts open them).
  const tradeWindowsOpened = 0;
  for (let blockIndex = 0; blockIndex < SEASON_BLOCK_COUNT; blockIndex += 1) {
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
    // The candidate's own stateRevision/stateDigest are commit-side
    // placeholders (zeros) by design — the authoritative post-block facts
    // are the runner state's, derived by `runBlockThroughHandler`.
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
