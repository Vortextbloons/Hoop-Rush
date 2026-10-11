import type {
  CommandId,
  FranchiseId,
  Id,
  SeasonCandidateCheckpoint,
  SeasonChallengeDeal,
  SeasonEffectsState,
  SeasonGameSummary,
  SeasonHomeCourtProfile,
  SeasonObjectiveId,
  SeasonPendingBlockCandidate,
  SeasonRotation,
  SeasonRun,
  SeasonSchedule,
  SeasonTeamAggregate,
  SeasonPlayerAggregate,
  SeasonWorkerProgressMessage,
  SeasonWorkerStartRequest,
} from '@hoop-rush/data-contracts';
import {
  SEASON_WORKER_WIRE_SCHEMA_VERSION,
  seasonWorkerStartRequestSchema,
} from '@hoop-rush/data-contracts';
import { seasonCheckpointDigest } from '@hoop-rush/engine';
import type { SeasonRunRepository, SeasonRunSnapshot } from '@hoop-rush/persistence';

export interface SeasonArtifactUrls {
  catalogUrl: string;
  catalogHash: string;
  profileUrl: string;
  profileHash: string;
  modelUrl?: string;
  modelHash?: string;
}

export type SeasonWorkerProgress = SeasonWorkerProgressMessage;

export type SeasonRunnerEvent =
  | {
      type: 'started';
      requestId: string;
      blockIndex: number;
    }
  | {
      type: 'progress';
      requestId: string;
      blockIndex: number;
      gamesCompleted: number;
      gamesTotal: number;
      latestGameId: SeasonWorkerProgress['latestGameId'];
      latestResult: SeasonWorkerProgress['latestResult'];
      isHumanGame: SeasonWorkerProgress['isHumanGame'];
      humanRecordInBlock: SeasonWorkerProgress['humanRecordInBlock'];
      humanResults: SeasonWorkerProgress['humanResults'];
      leaguePulse: SeasonWorkerProgress['leaguePulse'];
    }
  | {
      type: 'complete';
      requestId: string;
      checkpoint: SeasonCandidateCheckpoint;
      snapshot: SeasonRunSnapshot;
    }
  | {
      type: 'interrupted';
      requestId: string;
      runId: string;
      blockIndex: number;
      pending: SeasonPendingBlockCandidate;
      interruption: import('@hoop-rush/data-contracts').SeasonInvalidRosterInterruption;
    }
  | {
      type: 'cancelled';
      requestId: string;
      blockIndex: number;
    }
  | {
      type: 'error';
      requestId: string;
      blockIndex: number;
      code: 'invariant-failure' | 'cancelled' | 'internal';
      message: string;
      seed: string | null;
      gameId: string | null;
    };

export interface SeasonBlockStartInput {
  run: SeasonRun;
  effects: SeasonEffectsState;
  rotations: SeasonRotation[];
  blockIndex: number;
  expectedRevision: number;
  rotationDigest: string;
  commandId: CommandId;
  humanFranchiseId: FranchiseId | null;
  objectiveId: SeasonObjectiveId | null;
  challengeDeal?: SeasonChallengeDeal | null;
  campaignOpportunityId?: string | null;
  homeCourt: SeasonHomeCourtProfile;
  catalogUrl: string;
  catalogHash: string;
  profileUrl: string;
  profileHash: string;
}

export interface SeasonBlockResumeInput {
  runId: Id;
  blockIndex: number;
  expectedRevision: number;
  rotationDigest: string;
  commandId: CommandId;
  rotations: SeasonRotation[];
  humanFranchiseId: FranchiseId | null;
  homeCourt: SeasonHomeCourtProfile;
  catalogUrl: string;
  catalogHash: string;
  profileUrl: string;
  profileHash: string;
}

export interface SeasonBlockRunner {
  startBlock(input: SeasonBlockStartInput): string;
  resumeBlock(input: SeasonBlockResumeInput): string;
  cancel(requestId: string): void;
  terminate(): void;
  prewarm(): void;
  subscribe(listener: (event: SeasonRunnerEvent) => void): () => void;
}

export interface SeasonBlockTransport {
  postMessage(message: unknown): void;
  onMessage(listener: (data: unknown) => void): void;
  onError(listener: (message: string) => void): void;
  terminate(): void;
}

export interface SeasonBlockRunnerDeps {
  repository?: SeasonRunRepository;
  schedule?: SeasonSchedule;
  workerUrl?: string;
  artifacts?: () => Promise<SeasonArtifactUrls>;
  transportFactory?: () => SeasonBlockTransport;
}

export interface WorkerRequestState {
  blockIndex: number;
  expectedRevision: number;
  rotationDigest: string;
  commandId: string;
  rotations: SeasonRotation[];
  input: SeasonBlockStartInput;
  resumePending: SeasonPendingBlockCandidate | null;
}

export function buildWorkerRequest(
  requestId: string,
  state: WorkerRequestState,
  opts: {
    knownSummaries: SeasonGameSummary[];
    schedule: SeasonSchedule;
    artifacts: SeasonArtifactUrls;
    priorStandings?: SeasonRun['standings'];
    priorTeamAggregates?: SeasonTeamAggregate[];
    priorPlayerAggregates?: SeasonPlayerAggregate[];
  },
): SeasonWorkerStartRequest {
  const priorSummaries =
    state.resumePending !== null
      ? [...opts.knownSummaries, ...state.resumePending.summaries]
      : [...opts.knownSummaries];
  const priorEffects =
    state.resumePending !== null ? state.resumePending.effects : state.input.effects;
  const priorHealth =
    state.resumePending !== null ? state.resumePending.health : state.input.run.health;
  return seasonWorkerStartRequestSchema.parse({
    schemaVersion: SEASON_WORKER_WIRE_SCHEMA_VERSION,
    type: 'season-block-start',
    requestId,
    runId: state.input.run.runId,
    rootSeed: state.input.run.rootSeed,
    blockIndex: state.blockIndex,
    expectedRevision: state.expectedRevision,
    rotationDigest: state.rotationDigest,
    commandId: state.commandId,
    run: {
      schemaVersion: state.input.run.schemaVersion,
      runId: state.input.run.runId,
      rootSeed: state.input.run.rootSeed,
      versions: state.input.run.versions,
      league: state.input.run.league,
      rosters: state.input.run.rosters,
      rotations: state.rotations,
      cursor: state.input.run.cursor,
      evolution: state.input.run.evolution,
      sponsors: state.input.run.sponsors,
    },
    schedule: opts.schedule,
    homeCourt: state.input.homeCourt,
    catalogUrl: opts.artifacts.catalogUrl,
    catalogHash: opts.artifacts.catalogHash,
    profileUrl: opts.artifacts.profileUrl,
    profileHash: opts.artifacts.profileHash,
    priorSummaries,
    priorRetainedDetails:
      state.resumePending !== null ? [...state.resumePending.retainedDetails] : [],
    priorStandings: opts.priorStandings,
    priorTeamAggregates: opts.priorTeamAggregates,
    priorPlayerAggregates: opts.priorPlayerAggregates,
    priorEffects,
    priorHealth,
    startGameId: state.resumePending?.nextGameId ?? null,
    objectiveId: state.input.objectiveId,
    challengeDeal: state.input.challengeDeal ?? state.resumePending?.challengeDeal ?? null,
    challengeIds:
      state.input.challengeDeal?.challengeIds ?? state.resumePending?.challengeIds ?? undefined,
    campaignOpportunityId: state.input.campaignOpportunityId ?? null,
    priorInfluence: state.input.run.influence,
    priorTransactions: state.input.run.transactions,
    expectedStateRevision: state.input.run.stateRevision,
    expectedStateDigest: state.input.run.stateDigest,
    humanFranchiseId: state.input.humanFranchiseId,
  });
}

export function acceptWorkerResult(
  checkpoint: SeasonCandidateCheckpoint,
  expected: {
    runId: string;
    blockIndex: number;
    revision: number;
    rotationDigest: string;
    expectedStateRevision: number;
    expectedStateDigest: string;
  },
): string[] {
  const failures: string[] = [];
  if (seasonCheckpointDigest(checkpoint) !== checkpoint.digest) {
    failures.push('candidate digest does not verify');
  }
  if (checkpoint.runId !== expected.runId) failures.push('candidate runId mismatch');
  if (checkpoint.blockIndex !== expected.blockIndex) failures.push('candidate blockIndex mismatch');
  if (checkpoint.revision !== expected.revision) {
    failures.push('candidate revision does not match expectedRevision');
  }
  if (checkpoint.rotationDigest !== expected.rotationDigest) {
    failures.push('candidate rotationDigest mismatch');
  }
  if (checkpoint.expectedStateRevision !== expected.expectedStateRevision) {
    failures.push(
      `candidate expectedStateRevision ${String(checkpoint.expectedStateRevision)} does not match the run state ${String(expected.expectedStateRevision)}`,
    );
  }
  if (checkpoint.expectedStateDigest !== expected.expectedStateDigest) {
    failures.push('candidate expectedStateDigest does not match the run state');
  }
  return failures;
}
