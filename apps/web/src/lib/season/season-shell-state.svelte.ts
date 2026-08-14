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
  SeasonPostseasonRotationPayload,
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
import type { HubPostseasonProgress } from './season-postseason-presentation';
import type { SeasonFaceRef } from './season-branding';
import type { RotationEditor } from './season-rotation-editor';
import type { SeasonRunShellData } from './season-shell-context';

/**
 * Performance pass: the reactive Season Run shell as a class, so the large
 * immutable payloads (snapshot with the 1,230 reassembled game records, the
 * packaged catalog and schedule, the players-index face map, the per-run
 * player slice) live in `$state.raw` fields: reads are tracked and wholesale
 * reassignment triggers updates, but the values are NEVER deep-proxied into
 * per-property sources. Only the fields that actually change during a session
 * (block state, mirrors, editor, flags) stay deeply reactive.
 */
export class SeasonRunShell implements SeasonRunShellData {
  ready = $state(false);
  error = $state<string | null>(null);
  hubError = $state<string | null>(null);
  hub = $state<SeasonHubState | null>(null);
  snapshot = $state.raw<SeasonRunSnapshot | null>(null);
  index = $state<SeasonActiveRunIndex | null>(null);
  block = $state<BlockRunState>({
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
  });
  manifest = $state.raw<HoopRushManifest | null>(null);
  league = $state.raw<SeasonLeague | null>(null);
  catalog = $state.raw<SeasonDraftCatalog | null>(null);
  schedule = $state.raw<SeasonSchedule | null>(null);
  // Raw Maps on purpose: the slice and face index are immutable payloads
  // replaced wholesale, never proxied into SvelteMap (cheap reads, no
  // per-entry tracking).
  // eslint-disable-next-line svelte/prefer-svelte-reactivity
  playerSlice = $state.raw<SeasonRunPlayerSlice>(new Map());
  playerSliceReady = $state(false);
  // eslint-disable-next-line svelte/prefer-svelte-reactivity
  facesByVersion = $state.raw<Map<string, SeasonFaceRef>>(new Map());
  facesReady = $state(false);
  run = $state.raw<SeasonRun | null>(null);
  humanFranchiseId = $state<string | null>(null);
  humanTeam = $state.raw<SeasonTeam | null>(null);
  nextBlockIndex = $state<number | null>(null);
  seasonComplete = $state(false);
  editor = $state<RotationEditor | null>(null);
  editorKey = $state<string | null>(null);
  health = $state.raw<SeasonHealthState | null>(null);
  influence = $state.raw<SeasonInfluenceState | null>(null);
  trade = $state.raw<SeasonTradeState | null>(null);
  objectives = $state.raw<SeasonObjectiveState | null>(null);
  pending = $state<SeasonPendingBlockCandidate | null>(null);
  interruption = $state<SeasonInvalidRosterInterruption | null>(null);
  commandError = $state<SeasonRunCommandError | null>(null);
  externalChange = $state<{ kind: 'commit' | 'clear' | 'replace'; message: string } | null>(null);
  acknowledgeExternalChange = (): void => {};
  prewarmWorker = (): void => {};
  playerName = (playerVersionId: string): string => {
    void playerVersionId;
    return '—';
  };
  playablePositions = (playerVersionId: string): readonly string[] => {
    void playerVersionId;
    return [];
  };
  franchiseName = (franchiseId: string): string => {
    void franchiseId;
    return '—';
  };
  franchiseAbbrev = (franchiseId: string): string => {
    void franchiseId;
    return '—';
  };
  cancelBlock = (): void => {};
  retryBlock = (): void => {};
  refresh = async (): Promise<void> => {};
  quitRun = (): Promise<{ ok: boolean; error: string | null }> =>
    Promise.resolve({ ok: false, error: 'season shell not ready' });
  selectBlockObjective = (input: {
    blockIndex: number;
    objectiveId: SeasonObjectiveId;
  }): Promise<void> => {
    void input;
    return Promise.resolve();
  };
  spendInfluence = (input: {
    purpose: SeasonSpendInfluencePurpose;
    windowIndex?: number;
    injuryId?: string;
  }): Promise<void> => {
    void input;
    return Promise.resolve();
  };
  acceptTradeOffer = (input: { windowIndex: number; offerId: string }): Promise<void> => {
    void input;
    return Promise.resolve();
  };
  declineTradeOffer = (input: { windowIndex: number; offerId: string }): Promise<void> => {
    void input;
    return Promise.resolve();
  };
  forfeitInterruptedGame = (): Promise<void> => Promise.resolve();
  resumeBlock = (): Promise<void> => Promise.resolve();
  startPostseason = (): Promise<void> => Promise.resolve();
  advancePostseason = (input?: { targetGameId?: string }): Promise<void> => {
    void input;
    return Promise.resolve();
  };
  submitPostseasonRotation = (input: {
    targetGameId: string;
    rotation: SeasonPostseasonRotationPayload;
  }): Promise<void> => {
    void input;
    return Promise.resolve();
  };
  spectatePostseasonGame = (input: { targetGameId: string }): Promise<void> => {
    void input;
    return Promise.resolve();
  };
  fastForwardPostseason = (input?: { targetGameId?: string }): Promise<void> => {
    void input;
    return Promise.resolve();
  };
  cancelPostseason = (): void => {};
  postseason = $state<HubPostseasonProgress>({
    phase: 'idle',
    gamesCompleted: 0,
    gamesTotal: 0,
    latestGameId: null,
    latestResult: null,
    error: null,
  });
}
