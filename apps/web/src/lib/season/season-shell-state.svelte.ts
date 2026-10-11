import type {
  HoopRushManifest,
  PlayersIndexEntry,
  SeasonActiveRunIndex,
  SeasonDraftCatalog,
  SeasonFreeAgencyState,
  SeasonHealthState,
  SeasonInfluenceState,
  SeasonInvalidRosterInterruption,
  SeasonLeague,
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
  SeasonRunLoadDiagnostic,
  SeasonRunCommandError,
  SeasonTradeReceipt,
} from './season-hub-state';
import type { HubPostseasonProgress } from './season-postseason-presentation';
import type { SeasonFaceRef } from './season-branding';
import type { RotationEditor } from './season-rotation-editor';
import type { SeasonRunShellData } from './season-shell-context';
import { idleBlockRunState, idlePostseasonProgress } from './season-shell-context';
export class SeasonRunShell implements SeasonRunShellData {
  ready = $state(false);
  error = $state<SeasonRunLoadDiagnostic | null>(null);
  hubError = $state<SeasonRunLoadDiagnostic | null>(null);
  hub = $state<SeasonHubState | null>(null);
  snapshot = $state.raw<SeasonRunSnapshot | null>(null);
  index = $state<SeasonActiveRunIndex | null>(null);
  block = $state<BlockRunState>(idleBlockRunState());
  manifest = $state.raw<HoopRushManifest | null>(null);
  league = $state.raw<SeasonLeague | null>(null);
  catalog = $state.raw<SeasonDraftCatalog | null>(null);
  schedule = $state.raw<SeasonSchedule | null>(null);
  playerSlice = $state.raw<SeasonRunPlayerSlice>(new Map());
  playerSliceReady = $state(false);
  facesByVersion = $state.raw<Map<string, SeasonFaceRef>>(new Map());
  facesReady = $state(false);
  playersIndex = $state.raw<readonly PlayersIndexEntry[] | null>(null);
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
  freeAgency = $state.raw<SeasonFreeAgencyState | null>(null);
  objectives = $state.raw<import('@hoop-rush/data-contracts').SeasonObjectiveState | null>(null);
  challenges = $state.raw<import('@hoop-rush/data-contracts').SeasonChallengeState | null>(null);
  pending = $state<SeasonPendingBlockCandidate | null>(null);
  interruption = $state<SeasonInvalidRosterInterruption | null>(null);
  commandError = $state<SeasonRunCommandError | null>(null);
  commandReceipt = $state<SeasonTradeReceipt | null>(null);
  externalChange = $state<{
    kind: 'commit' | 'clear' | 'replace';
    message: string;
  } | null>(null);
  acknowledgeExternalChange = (): void => {};
  prewarmWorker = (): void => {};
  playerName: SeasonRunShellData['playerName'] = () => '—';
  playablePositions: SeasonRunShellData['playablePositions'] = () => [];
  franchiseName: SeasonRunShellData['franchiseName'] = () => '—';
  franchiseAbbrev: SeasonRunShellData['franchiseAbbrev'] = () => '—';
  cancelBlock = (): void => {};
  retryBlock = (): void => {};
  refresh = async (): Promise<void> => {};
  quitRun: SeasonRunShellData['quitRun'] = () =>
    Promise.resolve({ ok: false, error: 'season shell not ready' });
  spendInfluence: SeasonRunShellData['spendInfluence'] = () => Promise.resolve();
  acceptTradeOffer: SeasonRunShellData['acceptTradeOffer'] = () => Promise.resolve();
  declineTradeOffer: SeasonRunShellData['declineTradeOffer'] = () => Promise.resolve();
  declareFreeAgentInterest: SeasonRunShellData['declareFreeAgentInterest'] = () =>
    Promise.resolve();
  skipFreeAgentMarket: SeasonRunShellData['skipFreeAgentMarket'] = () => Promise.resolve();
  resolveFreeAgentMarket: SeasonRunShellData['resolveFreeAgentMarket'] = () => Promise.resolve();
  forfeitInterruptedGame = (): Promise<void> => Promise.resolve();
  resumeBlock = (): Promise<void> => Promise.resolve();
  selectFrontOffice: NonNullable<SeasonRunShellData['selectFrontOffice']> = () => Promise.resolve();
  selectCourtInnovation: NonNullable<SeasonRunShellData['selectCourtInnovation']> = () =>
    Promise.resolve();
  openTradeInquiry: NonNullable<SeasonRunShellData['openTradeInquiry']> = () => Promise.resolve();
  submitTradeProposal: NonNullable<SeasonRunShellData['submitTradeProposal']> = () =>
    Promise.resolve();
  respondToTradeCounter: NonNullable<SeasonRunShellData['respondToTradeCounter']> = () =>
    Promise.resolve();
  walkAwayFromTrade: NonNullable<SeasonRunShellData['walkAwayFromTrade']> = () => Promise.resolve();
  purchaseTradeInquiry: NonNullable<SeasonRunShellData['purchaseTradeInquiry']> = () =>
    Promise.resolve();
  startPostseason = (): Promise<void> => Promise.resolve();
  advancePostseason: SeasonRunShellData['advancePostseason'] = () => Promise.resolve();
  forfeitPostseasonGame: SeasonRunShellData['forfeitPostseasonGame'] = () => Promise.resolve();
  submitPostseasonRotation: SeasonRunShellData['submitPostseasonRotation'] = () =>
    Promise.resolve();
  spectatePostseasonGame: SeasonRunShellData['spectatePostseasonGame'] = () => Promise.resolve();
  fastForwardPostseason: SeasonRunShellData['fastForwardPostseason'] = () => Promise.resolve();
  cancelPostseason = (): void => {};
  postseason = $state<HubPostseasonProgress>(idlePostseasonProgress());
}
