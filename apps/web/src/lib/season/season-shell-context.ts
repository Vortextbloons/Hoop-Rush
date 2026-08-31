import type {
  HoopRushManifest,
  PlayersIndexEntry,
  SeasonActiveRunIndex,
  SeasonDraftCatalog,
  SeasonFreeAgencyRoleExpectation,
  SeasonFreeAgencyState,
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
export const SEASON_RUN_SHELL_CONTEXT = 'hoop-rush:season-run-shell';
export interface SeasonRunShellData {
  ready: boolean;
  error: string | null;
  hubError: string | null;
  hub: SeasonHubState | null;
  snapshot: SeasonRunSnapshot | null;
  index: SeasonActiveRunIndex | null;
  block: BlockRunState;
  manifest: HoopRushManifest | null;
  league: SeasonLeague | null;
  catalog: SeasonDraftCatalog | null;
  schedule: SeasonSchedule | null;
  playerSlice: SeasonRunPlayerSlice;
  playerSliceReady: boolean;
  facesByVersion: Map<string, SeasonFaceRef>;
  facesReady: boolean;
  playersIndex: readonly PlayersIndexEntry[] | null;
  run: SeasonRun | null;
  humanFranchiseId: string | null;
  humanTeam: SeasonTeam | null;
  nextBlockIndex: number | null;
  seasonComplete: boolean;
  editor: RotationEditor | null;
  editorKey: string | null;
  health: SeasonHealthState | null;
  influence: SeasonInfluenceState | null;
  trade: SeasonTradeState | null;
  freeAgency: SeasonFreeAgencyState | null;
  objectives: SeasonObjectiveState | null;
  pending: SeasonPendingBlockCandidate | null;
  interruption: SeasonInvalidRosterInterruption | null;
  commandError: SeasonRunCommandError | null;
  externalChange: {
    kind: 'commit' | 'clear' | 'replace';
    message: string;
  } | null;
  acknowledgeExternalChange: () => void;
  prewarmWorker: () => void;
  playerName: (playerVersionId: string) => string;
  playablePositions: (playerVersionId: string) => readonly string[];
  franchiseName: (franchiseId: string) => string;
  franchiseAbbrev: (franchiseId: string) => string;
  cancelBlock: () => void;
  retryBlock: () => void;
  refresh: () => Promise<void>;
  quitRun: () => Promise<{
    ok: boolean;
    error: string | null;
  }>;
  selectBlockObjective: (input: {
    blockIndex: number;
    objectiveId: SeasonObjectiveId;
  }) => Promise<void>;
  spendInfluence: (input: {
    purpose: SeasonSpendInfluencePurpose;
    windowIndex?: number;
    injuryId?: string;
  }) => Promise<void>;
  acceptTradeOffer: (input: { windowIndex: number; offerId: string }) => Promise<void>;
  declineTradeOffer: (input: { windowIndex: number; offerId: string }) => Promise<void>;
  declareFreeAgentInterest: (input: {
    windowIndex: number;
    targets: {
      playerVersionId: string;
      roleExpectation: SeasonFreeAgencyRoleExpectation;
      influence: number;
    }[];
  }) => Promise<void>;
  skipFreeAgentMarket: (input: { windowIndex: number }) => Promise<void>;
  resolveFreeAgentMarket: (input: { windowIndex: number }) => Promise<void>;
  forfeitInterruptedGame: () => Promise<void>;
  resumeBlock: () => Promise<void>;
  selectGmIdentity?: (input: { identity: string; focus: string | null }) => Promise<void>;
  selectCampaignOpportunity?: (input: {
    blockIndex: number;
    opportunityId: string;
  }) => Promise<void>;
  evolveGmCampaign?: (input: { offerId: string }) => Promise<void>;
  openTradeInquiry?: (input: { windowIndex: number; toFranchiseId: string }) => Promise<void>;
  submitTradeProposal?: (input: {
    windowIndex: number;
    toFranchiseId: string;
    outgoingPlayerVersionIds: string[];
    incomingPlayerVersionIds: string[];
    influenceAmount: number;
    influenceFromSender: string | null;
  }) => Promise<void>;
  respondToTradeCounter?: (input: {
    windowIndex: number;
    inquiryId: string;
    accept: boolean;
  }) => Promise<void>;
  walkAwayFromTrade?: (input: { windowIndex: number; inquiryId: string }) => Promise<void>;
  purchaseTradeInquiry?: (input: { windowIndex: number }) => Promise<void>;
  startPostseason: () => Promise<void>;
  advancePostseason: (input?: { targetGameId?: string }) => Promise<void>;
  submitPostseasonRotation: (input: {
    targetGameId: string;
    rotation: SeasonPostseasonRotationPayload;
  }) => Promise<void>;
  spectatePostseasonGame: (input: { targetGameId: string }) => Promise<void>;
  fastForwardPostseason: (input?: { targetGameId?: string }) => Promise<void>;
  cancelPostseason: () => void;
  postseason: HubPostseasonProgress;
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
    playersIndex: null,
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
    freeAgency: null,
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
    declareFreeAgentInterest: () => Promise.resolve(),
    skipFreeAgentMarket: () => Promise.resolve(),
    resolveFreeAgentMarket: () => Promise.resolve(),
    forfeitInterruptedGame: () => Promise.resolve(),
    resumeBlock: () => Promise.resolve(),
    selectGmIdentity: () => Promise.resolve(),
    selectCampaignOpportunity: () => Promise.resolve(),
    evolveGmCampaign: () => Promise.resolve(),
    openTradeInquiry: () => Promise.resolve(),
    submitTradeProposal: () => Promise.resolve(),
    respondToTradeCounter: () => Promise.resolve(),
    walkAwayFromTrade: () => Promise.resolve(),
    purchaseTradeInquiry: () => Promise.resolve(),
    startPostseason: () => Promise.resolve(),
    advancePostseason: () => Promise.resolve(),
    submitPostseasonRotation: () => Promise.resolve(),
    spectatePostseasonGame: () => Promise.resolve(),
    fastForwardPostseason: () => Promise.resolve(),
    cancelPostseason: () => undefined,
    postseason: {
      phase: 'idle',
      gamesCompleted: 0,
      gamesTotal: 0,
      latestGameId: null,
      latestResult: null,
      error: null,
    },
  };
}
