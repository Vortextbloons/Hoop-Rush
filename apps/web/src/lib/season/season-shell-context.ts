import type {
  HoopRushManifest,
  SeasonActiveRunIndex,
  SeasonDraftCatalog,
  SeasonLeague,
  SeasonRun,
  SeasonSchedule,
  SeasonTeam,
} from '@hoop-rush/data-contracts';
import type { SeasonRunSnapshot } from '@hoop-rush/persistence';
import type { BlockRunState, SeasonHubState } from './season-hub-state';
import type { SeasonFaceRef } from './season-branding';
import type { RotationEditor } from './season-rotation-editor';

/**
 * Season Run shell context (M2.3.5). The `/season/run` route-group layout
 * owns one `SeasonRunShellData` instance for the lifetime of the active run:
 * the shared `SeasonHubState` (snapshot, block runner), packaged assets,
 * branding join, and derived run facts. Pages under `/season/run/*` read the
 * shell from context, so switching tabs never reloads IndexedDB and never
 * terminates an in-flight block worker. The shell is destroyed only when the
 * user leaves the run group (or reloads).
 *
 * The layout holds the instance in `$state` and mirrors hub events into it;
 * components read the reactive proxy directly from context.
 */
export const SEASON_RUN_SHELL_CONTEXT = Symbol('season-run-shell');

export interface SeasonRunShellData {
  /** True once assets, repo, runner, and the first refresh have settled. */
  ready: boolean;
  /** Shell-level load error (asset or repository failure). */
  error: string | null;
  hub: SeasonHubState | null;
  snapshot: SeasonRunSnapshot | null;
  index: SeasonActiveRunIndex | null;
  block: BlockRunState;
  manifest: HoopRushManifest | null;
  league: SeasonLeague | null;
  catalog: SeasonDraftCatalog | null;
  schedule: SeasonSchedule | null;
  /** playerVersionId -> face refs (players-index join) for the run's rosters. */
  facesByVersion: Map<string, SeasonFaceRef>;
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
  playerName: (playerVersionId: string) => string;
  playablePositions: (playerVersionId: string) => readonly string[];
  franchiseName: (franchiseId: string) => string;
  franchiseAbbrev: (franchiseId: string) => string;
  cancelBlock: () => void;
  retryBlock: () => void;
  refresh: () => Promise<void>;
}

/** Initial (empty) shell object; the layout turns it into `$state`. */
export function initialSeasonRunShellData(): SeasonRunShellData {
  return {
    ready: false,
    error: null,
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
    facesByVersion: new Map(),
    run: null,
    humanFranchiseId: null,
    humanTeam: null,
    nextBlockIndex: null,
    seasonComplete: false,
    editor: null,
    editorKey: null,
    playerName: () => '—',
    playablePositions: () => [],
    franchiseName: () => '—',
    franchiseAbbrev: () => '—',
    cancelBlock: () => undefined,
    retryBlock: () => undefined,
    refresh: async () => undefined,
  };
}
