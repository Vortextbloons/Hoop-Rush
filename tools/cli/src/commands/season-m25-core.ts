/**
 * M2.5 calibration core shared by `season health calibrate`, `season trade
 * calibrate`, and `season influence calibrate` (spec/2.0 M2.5, contract §17).
 * Cohorts run the engine block pipeline in process over root-seed-cloned
 * runs; worker counts and chunk order never change the facts (a worker
 * variant is deferred to stay bounded). Engine seams like
 * `seasonRunStateDigest` and `openSeasonTradeWindow` land in
 * `packages/engine/src/index.ts` at M2.5 integration; until then those
 * imports are typecheck-red by design.
 */

import {
  SEASON_BLOCK_COUNT,
  SEASON_HEALTH_VERSION,
  SEASON_OBJECTIVE_CATALOG,
  SEASON_OBJECTIVE_VERSION,
  buildInitialPostseasonState,
  seasonHealthStateSchema,
  seasonObjectiveStateSchema,
  type SeasonCandidateCheckpoint,
  type SeasonCheckpointState,
  type SeasonDraftCatalog,
  type SeasonEffectsState,
  type SeasonHealthState,
  type SeasonInfluenceState,
  type SeasonObjectiveState,
  type SeasonRun,
  type SeasonTradeState,
} from '@hoop-rush/data-contracts';
import {
  createInitialSeasonInfluenceState,
  expandSeasonRunRosters,
  openSeasonTradeWindow,
  rosterPlayerIdsOf,
  seasonObjectiveChoicesForBlock,
  seasonRunStateDigest,
  type SeasonWindowOpenResult,
} from '@hoop-rush/engine';
import {
  createSeasonBlockRunner,
  runBlockThroughHandler,
  type SeasonBlockRunnerState,
} from './season-block.ts';

export function m25EmptyHealthState(): SeasonHealthState {
  return seasonHealthStateSchema.parse({
    schemaVersion: 1,
    healthVersion: SEASON_HEALTH_VERSION,
    injuries: [],
  });
}

export function m25InitialObjectivesState(): SeasonObjectiveState {
  return seasonObjectiveStateSchema.parse({
    schemaVersion: 1,
    objectiveVersion: SEASON_OBJECTIVE_VERSION,
    catalog: [...SEASON_OBJECTIVE_CATALOG],
    selections: {},
  });
}

/** The +2 initial Influence state for all franchises (engine-owned). */
export function m25InitialInfluenceState(franchiseIds: readonly string[]): SeasonInfluenceState {
  return createInitialSeasonInfluenceState(franchiseIds);
}

/** The run-state facts `seasonRunStateDigest` canonicalizes (§20 item 2, M2.6). */
export interface SeasonM25RunStateFacts {
  stateRevision: number;
  /** M2.6: the explicit run stage. */
  stage: SeasonRun['stage'];
  /** M2.6: the postseason-v2 state. */
  postseason: SeasonRun['postseason'];
  /** M2.6: season awards (null until postseason qualification). */
  awards: SeasonRun['awards'];
  /** M2.6: completion state (null until a champion is decided). */
  completion: SeasonRun['completion'];
  checkpointState: SeasonCheckpointState | null;
  health: SeasonHealthState;
  influence: SeasonInfluenceState;
  transactions: SeasonRun['transactions'];
  trade: SeasonTradeState | null;
  objectives: SeasonObjectiveState;
  rosters: SeasonRun['rosters'];
  ownership: SeasonRun['ownership'];
  rotations: SeasonRun['rotations'];
  effects: SeasonEffectsState;
}

export function m25RunStateFacts(
  run: SeasonRun,
  effects: SeasonEffectsState,
): SeasonM25RunStateFacts {
  return {
    stateRevision: run.stateRevision,
    stage: run.stage,
    postseason: run.postseason,
    awards: run.awards,
    completion: run.completion,
    checkpointState: run.checkpointState,
    health: run.health,
    influence: run.influence,
    transactions: run.transactions,
    trade: run.trade,
    objectives: run.objectives,
    rosters: run.rosters,
    ownership: run.ownership,
    rotations: run.rotations,
    effects,
  };
}

/**
 * Fresh run clone for one cohort seed (identical rosters/schedule/rotations,
 * new root seed, clean M2.5 facts). stateDigest excludes itself from its own
 * computation, mirroring the checkpoint digest.
 */
export function m25FreshRun(
  base: SeasonRun,
  rootSeed: string,
  franchiseIds: readonly string[],
  effects: SeasonEffectsState,
): SeasonRun {
  const fresh: SeasonRun = {
    ...base,
    rootSeed,
    // M2.6: the postseason scaffold (seeds, scheduled play-in ids) derives
    // from the run root seed, so each cohort seed owns its scaffold.
    stage: 'regular-season',
    postseason: buildInitialPostseasonState(rootSeed),
    awards: null,
    completion: null,
    health: m25EmptyHealthState(),
    transactions: [],
    influence: m25InitialInfluenceState(franchiseIds),
    trade: null,
    objectives: m25InitialObjectivesState(),
    checkpointState: null,
    stateRevision: 0,
    stateDigest: '0'.repeat(32),
  };
  return { ...fresh, stateDigest: seasonRunStateDigest(m25RunStateFacts(fresh, effects)) };
}

export interface SeasonM25WindowOpen {
  blockIndex: number;
  /** The applied window result; null when no window opens (§20). */
  result: SeasonWindowOpenResult | null;
}

export interface SeasonM25SeasonFacts {
  rootSeed: string;
  /** Final run state (health/influence/transactions/trade folded). */
  run: SeasonRun;
  /** One candidate checkpoint per block (0..8), in block order. */
  checkpoints: SeasonCandidateCheckpoint[];
  /** Post-block state chain facts per block (0..8). */
  postBlock: Array<{ stateRevision: number; stateDigest: string }>;
  /** Trade windows opened at blocks 2/4/5 (only when driveWindows). */
  windows: SeasonM25WindowOpen[];
  /** Pre-block Influence balance snapshot per block commit (9 per season). */
  balanceSnapshots: Array<Record<string, number>>;
  /** The final post-block effects state (loads + pair chemistries). */
  effects: SeasonEffectsState;
  /** The packaged catalog (playable positions for the legality audits). */
  catalog: SeasonDraftCatalog;
}

export interface SeasonM25DriverOptions {
  runPath?: string | null;
  manifestPath?: string | null;
  profileEra?: string | null;
  /** The cohort root seed for this season. */
  rootSeed: string;
  /** Open trade windows at blocks 2/4/5 (trade + influence cohorts). */
  driveWindows: boolean;
  /** Select the first offered objective per block 0-7 (influence cohort). */
  pickObjectives: boolean;
  /** Determinism probe: re-run window generation at the first window block. */
  probeWindow?: boolean;
}

/** The window blocks in schedule order (contract §13). */
export const M25_TRADE_WINDOW_BLOCKS = [2, 4, 5] as const;

/**
 * Simulates one full season through the engine pipeline with M2.5 facts
 * threaded. Fixture and cohort paths share this driver; worker counts and
 * chunk order never change the recorded facts.
 */
export function runSeasonM25(options: SeasonM25DriverOptions): SeasonM25SeasonFacts {
  const state: SeasonBlockRunnerState = createSeasonBlockRunner({
    runPath: options.runPath,
    manifestPath: options.manifestPath,
    profileEra: options.profileEra,
  });
  const franchiseIds = state.run.league.teams.map((team) => team.franchiseId);
  const run = m25FreshRun(state.run, options.rootSeed, franchiseIds, state.effects);
  state.run = run;
  state.health = run.health;
  state.objectiveId = null;
  state.checkpointState = null;
  state.stateRevision = 0;
  state.stateDigest = run.stateDigest;
  state.summaries = [];
  state.acceptedCommandIds = [];

  const checkpoints: SeasonCandidateCheckpoint[] = [];
  const postBlock: Array<{ stateRevision: number; stateDigest: string }> = [];
  const windows: SeasonM25WindowOpen[] = [];
  const balanceSnapshots: Array<Record<string, number>> = [];
  let probed = false;

  for (let blockIndex = 0; blockIndex < SEASON_BLOCK_COUNT; blockIndex += 1) {
    if (options.pickObjectives && blockIndex <= 7) {
      const choices = seasonObjectiveChoicesForBlock(options.rootSeed, blockIndex);
      const first = choices[0];
      if (first === undefined) {
        throw new Error(
          `seed ${options.rootSeed} offered no objective for block ${String(blockIndex)}`,
        );
      }
      state.objectiveId = first;
    } else {
      state.objectiveId = null;
    }
    const checkpoint = runBlockThroughHandler(state, blockIndex);
    checkpoints.push(checkpoint);
    postBlock.push({ stateRevision: state.stateRevision, stateDigest: state.stateDigest });
    balanceSnapshots.push({ ...checkpoint.influence.balances });
    // Record the locked objective selection; run selections are the
    // objective-history source the influence gates measure.
    if (state.objectiveId !== null && checkpoint.objective.objectiveId !== null) {
      state.run = {
        ...state.run,
        objectives: {
          ...state.run.objectives,
          selections: {
            ...state.run.objectives.selections,
            [blockIndex]: {
              objectiveId: state.objectiveId,
              selectedByCommandId: `season-block-${String(blockIndex)}-${String(state.acceptedCommandIds.length)}`,
              success: checkpoint.objective.success,
            },
          },
        },
      };
    }
    if (
      options.driveWindows &&
      (M25_TRADE_WINDOW_BLOCKS as readonly number[]).includes(blockIndex)
    ) {
      const windowInput = {
        run: state.run,
        blockIndex,
        rootSeed: options.rootSeed,
        humanFranchiseId: state.humanFranchiseId,
        // Window generation needs the packaged catalog (positions + ratings);
        // otherwise the engine throws SeasonTradeFactsError.
        catalog: state.catalog,
        effects: state.effects,
      };
      const result = openSeasonTradeWindow(windowInput);
      windows.push({ blockIndex, result });
      if (result !== null) {
        if (options.probeWindow && !probed) {
          // Determinism probe: the same input must generate identical offers.
          const again = openSeasonTradeWindow(windowInput);
          if (JSON.stringify(again?.trade) !== JSON.stringify(result.trade)) {
            throw new Error(
              `seed ${options.rootSeed} window ${String(blockIndex)} offer generation is not deterministic`,
            );
          }
          probed = true;
        }
        state.run = {
          ...state.run,
          trade: result.trade,
          influence: result.influence,
          transactions: result.transactions,
          rosters: result.rosters,
          ownership: result.ownership,
          rotations: result.rotations,
          stateRevision: result.stateRevision,
          stateDigest: result.stateDigest,
        };
        // Sync runner facts to the post-window revision/digest so the next
        // block's command asserts the advanced chain.
        state.stateRevision = result.stateRevision;
        state.stateDigest = result.stateDigest;
        state.effects = result.effects;
        state.expanded = expandSeasonRunRosters(state.run, state.catalog);
        state.rosterPlayerIds = rosterPlayerIdsOf(state.run);
      }
    }
  }

  return {
    rootSeed: options.rootSeed,
    run: state.run,
    checkpoints,
    postBlock,
    windows,
    balanceSnapshots,
    effects: state.effects,
    catalog: state.catalog,
  };
}
