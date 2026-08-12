import type {
  HoopRushManifest,
  SeasonActiveRunIndex,
  SeasonDraftCatalog,
  SeasonHealthState,
  SeasonInfluenceState,
  SeasonInvalidRosterInterruption,
  SeasonLeague,
  SeasonObjectiveId,
  SeasonObjectiveState,
  SeasonPendingBlockCandidate,
  SeasonRun,
  SeasonSchedule,
  SeasonTeam,
  SeasonTradeState,
} from '@hoop-rush/data-contracts';
import type { SeasonRunSnapshot } from '@hoop-rush/persistence';
import type { SeasonRunPlayerSlice } from './season-player-slice';
import type {
  BlockRunState,
  SeasonHubState,
  SeasonRunCommandError,
  SeasonSpendInfluencePurpose,
} from './season-hub-state';
import type { SeasonFaceRef } from './season-branding';
import type { RotationEditor } from './season-rotation-editor';

/**
 * Season Run shell context (M2.3.5, M2.5). The `/season/run` layout owns one
 * `SeasonRunShellData` instance for the lifetime of the active run (shared
 * `SeasonHubState`, packaged assets, branding join, derived run facts), so
 * switching tabs never reloads IndexedDB and never terminates an in-flight
 * block worker. The shell is destroyed only when leaving the run group or on
 * reload. M2.5 adds the run-state mirrors (`health`, `influence`, `trade`,
 * `objectives`), the interruption/pending mirrors, and the typed command
 * actions.
 */
/**
 * A string key remains identical when Vite hot-reloads this module before all
 * consumers have been replaced. A module-local Symbol can leave the layout
 * and a child page using different context keys during HMR, causing
 * `getContext` to return undefined until a full reload.
 */
export const SEASON_RUN_SHELL_CONTEXT = 'hoop-rush:season-run-shell';

export interface SeasonRunShellData {
  /** True once assets, repo, runner, and the first refresh have settled. */
  ready: boolean;
  /** Shell-level load error (asset or repository failure). */
  error: string | null;
  /** Hub refresh error (corrupt or unrecoverable persisted run). */
  hubError: string | null;
  hub: SeasonHubState | null;
  snapshot: SeasonRunSnapshot | null;
  index: SeasonActiveRunIndex | null;
  block: BlockRunState;
  manifest: HoopRushManifest | null;
  league: SeasonLeague | null;
  catalog: SeasonDraftCatalog | null;
  schedule: SeasonSchedule | null;
  /**
   * Performance pass: the compact per-run player presentation slice
   * (positions/ratings/stamina/durability), loaded from IndexedDB with the
   * shell. Views render from this; the full catalog stays lazy.
   */
  playerSlice: SeasonRunPlayerSlice;
  /** True once the player slice row is loaded (or known missing). */
  playerSliceReady: boolean;
  /** playerVersionId -> face refs (players-index join) for the run's rosters. */
  facesByVersion: Map<string, SeasonFaceRef>;
  /** Performance pass: false until the global players index finished loading
   * after first paint; face views keep a loading fallback meanwhile. */
  facesReady: boolean;
  run: SeasonRun | null;
  humanFranchiseId: string | null;
  humanTeam: SeasonTeam | null;
  /** Accepted-block count (0..8); null when no run is loaded. */
  nextBlockIndex: number | null;
  seasonComplete: boolean;
  /**
   * Shared rotation editor for the human team. Owned by the shell so edits
   * survive tab switches; rebuilt whenever the locked rotation changes
   * (i.e. after an accepted block).
   */
  editor: RotationEditor | null;
  /** Identity key of the rotation the current editor was built from. */
  editorKey: string | null;
  /** M2.5: run-scoped health mirror (null when no run is loaded). */
  health: SeasonHealthState | null;
  /** M2.5: run-scoped Influence mirror. */
  influence: SeasonInfluenceState | null;
  /** M2.5: run-scoped trade-window state mirror (null until the first window). */
  trade: SeasonTradeState | null;
  /** M2.5: run-scoped objective state mirror (catalog + selections). */
  objectives: SeasonObjectiveState | null;
  /** M2.5: uncommitted pending block candidate of an interrupted run. */
  pending: SeasonPendingBlockCandidate | null;
  /** M2.5: typed invalid-roster interruption (null after a reload). */
  interruption: SeasonInvalidRosterInterruption | null;
  /** M2.5: the last rejected between-block command (typed alert). */
  commandError: SeasonRunCommandError | null;
  /** Performance pass: cross-tab invalidation banner (another tab moved the
   * run); null when nothing external changed. */
  externalChange: { kind: 'commit' | 'clear' | 'replace'; message: string } | null;
  /** Performance pass: clears the cross-tab banner (user acknowledged it). */
  acknowledgeExternalChange: () => void;
  /** Performance pass: prewarms the worker's packaged asset caches. */
  prewarmWorker: () => void;
  playerName: (playerVersionId: string) => string;
  playablePositions: (playerVersionId: string) => readonly string[];
  franchiseName: (franchiseId: string) => string;
  franchiseAbbrev: (franchiseId: string) => string;
  cancelBlock: () => void;
  retryBlock: () => void;
  refresh: () => Promise<void>;
  /** Ends the current run and clears it from this browser. */
  quitRun: () => Promise<{ ok: boolean; error: string | null }>;
  /** M2.5: selects the block's objective before submission. */
  selectBlockObjective: (input: {
    blockIndex: number;
    objectiveId: SeasonObjectiveId;
  }) => Promise<void>;
  /** M2.5: spends Influence (extra trade offer or risky rehab). */
  spendInfluence: (input: {
    purpose: SeasonSpendInfluencePurpose;
    windowIndex?: number;
    injuryId?: string;
  }) => Promise<void>;
  /** M2.5: accepts an open trade offer. */
  acceptTradeOffer: (input: { windowIndex: number; offerId: string }) => Promise<void>;
  /** M2.5: declines an open trade offer. */
  declineTradeOffer: (input: { windowIndex: number; offerId: string }) => Promise<void>;
  /** M2.5: forfeits the interrupted game and advances the pending block. */
  forfeitInterruptedGame: () => Promise<void>;
  /** M2.5: resumes an interrupted block from its pending candidate. */
  resumeBlock: () => Promise<void>;
}

export function initialSeasonRunShellData(): SeasonRunShellData {
  return {
    ready: false,
    error: null,
    hubError: null,
    hub: null,
    snapshot: null,
    index: null,
    block: {
      requestId: null,
      blockIndex: null,
      phase: 'idle',
      gamesCompleted: 0,
      gamesTotal: 0,
      latestGameId: null,
      latestResult: null,
      error: null,
      command: null,
      startInput: null,
    },
    manifest: null,
    league: null,
    catalog: null,
    schedule: null,
    playerSlice: new Map(),
    playerSliceReady: false,
    facesByVersion: new Map(),
    facesReady: false,
    run: null,
    humanFranchiseId: null,
    humanTeam: null,
    nextBlockIndex: null,
    seasonComplete: false,
    editor: null,
    editorKey: null,
    health: null,
    influence: null,
    trade: null,
    objectives: null,
    pending: null,
    interruption: null,
    commandError: null,
    externalChange: null,
    acknowledgeExternalChange: () => undefined,
    prewarmWorker: () => undefined,
    playerName: () => '—',
    playablePositions: () => [],
    franchiseName: () => '—',
    franchiseAbbrev: () => '—',
    cancelBlock: () => undefined,
    retryBlock: () => undefined,
    refresh: () => Promise.resolve(),
    quitRun: () => Promise.resolve({ ok: false, error: 'season shell not ready' }),
    selectBlockObjective: () => Promise.resolve(),
    spendInfluence: () => Promise.resolve(),
    acceptTradeOffer: () => Promise.resolve(),
    declineTradeOffer: () => Promise.resolve(),
    forfeitInterruptedGame: () => Promise.resolve(),
    resumeBlock: () => Promise.resolve(),
  };
}
