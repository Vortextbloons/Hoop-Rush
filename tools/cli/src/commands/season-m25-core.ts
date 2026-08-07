/**
 * M2.5 calibration core shared by `season health calibrate`, `season trade
 * calibrate`, and `season influence calibrate` (spec/2.0 M2.5, contract §17).
 *
 * Season-level cohorts run the authoritative engine block pipeline in
 * process over root-seed-cloned runs: fresh schema-7 facts per seed (empty
 * health, initial Influence, initial objectives, null trade), the post-block
 * state chain folded through the engine's `deriveSeasonPostBlockState`, and
 * trade windows opened at blocks 2/4/5 through `openSeasonTradeWindow` when
 * the cohort drives the economy. Deterministic objective selection (the
 * first offered choice per block) is applied before each full block when the
 * cohort needs objective facts. Worker counts and chunk order never change
 * the facts (the cohort runner is deliberately in-process; a worker variant
 * is deferred to stay bounded).
 *
 * Engine seams this module imports — `createInitialSeasonInfluenceState`,
 * `seasonRunStateDigest`, `deriveSeasonPostBlockState`,
 * `openSeasonTradeWindow`, `seasonObjectiveChoicesForBlock` — land in
 * `packages/engine/src/index.ts` at M2.5 integration (lead-owned file);
 * until then these imports are typecheck-red by design. `SeasonWindowOpenResult`
 * comes from the engine's `season/trades.ts` (§20 frozen shape).
 */

import {
  SEASON_BLOCK_COUNT,
  SEASON_HEALTH_VERSION,
  SEASON_OBJECTIVE_CATALOG,
  SEASON_OBJECTIVE_VERSION,
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

/** The empty schema-7 health state every fresh cohort run starts with. */
export function m25EmptyHealthState(): SeasonHealthState {
  return seasonHealthStateSchema.parse({
    schemaVersion: 1,
    healthVersion: SEASON_HEALTH_VERSION,
    injuries: [],
  });
}

/** The fixed-catalog initial objective state with no selections. */
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

/**
 * The mutable run-state facts `seasonRunStateDigest` canonicalizes (§20 item
 * 2): the state chain facts plus the run-scoped M2.5 families and the
 * rosters/ownership/rotations/effects the block pipeline carried.
 */
export interface SeasonM25RunStateFacts {
  stateRevision: number;
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

/** Assembles the digest facts from a run + the carried effects state. */
export function m25RunStateFacts(
  run: SeasonRun,
  effects: SeasonEffectsState,
): SeasonM25RunStateFacts {
  return {
    stateRevision: run.stateRevision,
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
 * A fresh schema-7 run clone for one cohort seed: identical rosters,
 * schedule, and rotations, with a new root seed and clean M2.5 facts. The
 * canonical state digest is computed through the engine seam (the stateDigest
 * field is excluded from its own computation, mirroring the checkpoint
 * digest).
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

/** One trade window opened (or refused) after a block commit. */
export interface SeasonM25WindowOpen {
  blockIndex: number;
  /** The applied window result; null when no window opens (§20). */
  result: SeasonWindowOpenResult | null;
}

/** Everything one simulated season measured. */
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

/** Options for one cohort season run. */
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
  /**
   * Determinism probe: at the first window block, re-run the window
   * generation against the exact pre-window run and record both results
   * (offer generation must be a pure function of the input).
   */
  probeWindow?: boolean;
}

/** The window blocks in schedule order (contract §13). */
export const M25_TRADE_WINDOW_BLOCKS = [2, 4, 5] as const;

/**
 * Simulates one full season through the authoritative engine pipeline with
 * the M2.5 facts threaded (health, objectives, state chain, windows).
 * Fixture-driven and cohort paths share this single driver; worker counts
 * and chunk order never change the recorded facts.
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
    // M2.5: record the locked objective selection with its evaluated success
    // (the candidate evaluated it at assembly; the run's selections record
    // is the objective-history source the influence gates measure).
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
        // M2.5: window generation needs the packaged catalog (positions +
        // ratings for legality, value bands, and rotation repair); without
        // it the engine throws SeasonTradeFactsError rather than recording
        // an unvalidated window.
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
        // The window advanced the state chain (revision +1); the runner's
        // facts must match so the next block's command asserts the
        // post-window revision/digest.
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
