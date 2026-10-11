import {
  franchiseAbbreviation,
  humanTeamOf,
  type HoopRushManifest,
  type PlayersIndexEntry,
  type Position,
  type SeasonActiveRunIndex,
  type SeasonDraftCatalog,
  type SeasonFreeAgencyState,
  type SeasonInvalidRosterInterruption,
  type SeasonLeague,
  type SeasonPendingBlockCandidate,
  type SeasonRun,
  type SeasonSchedule,
  type SeasonTradeState,
} from '@hoop-rush/data-contracts';
import type { SeasonRunPlayerSliceEntry, SeasonRunSnapshot } from '@hoop-rush/persistence';
import {
  SeasonSession,
  seasonRunLoadDiagnosticOf,
  type BlockRunState,
  type SeasonRunCommandError,
  type SeasonRunLoadDiagnostic,
  type SeasonSessionOptions,
  type SeasonTradeReceipt,
} from '@hoop-rush/application/season';
import { getManifest, getPlayersIndex } from '$lib/data';
import { catalogCandidateMap } from './season-catalog-index';
import {
  buildVersionFaceIndex,
  freeAgencyVersionTuples,
  versionTupleOfRosterEntry,
  type SeasonFaceRef,
} from './season-branding';
import {
  createRotationEditor,
  rotationEditorNeedsPositionRefresh,
  type RotationEditor,
} from './season-rotation-editor';
import {
  playablePositionsOfSlice,
  playerSliceOf,
  type SeasonRunPlayerSlice,
} from './season-player-slice';
import {
  hasPostseasonHubMethods,
  idlePostseasonProgress,
  POSTSEASON_ORCHESTRATION_UNAVAILABLE,
  type HubPostseasonProgress,
} from './season-postseason-presentation';
import { loadSeasonLeague, loadSeasonSchedule } from './season-assets';
import { createSeasonSessionPorts } from './season-session-ports';
import { idleBlockRunState, type SeasonRunShellData } from './season-shell-context';
export interface SeasonRunShellDeps {
  createPorts: (options: { schedule: SeasonSchedule }) => Promise<SeasonSessionOptions>;
  loadManifest: () => Promise<HoopRushManifest>;
  loadLeague: () => Promise<SeasonLeague>;
  loadSchedule: () => Promise<SeasonSchedule>;
  loadPlayersIndex: () => Promise<readonly PlayersIndexEntry[]>;
  loadCatalog: () => Promise<SeasonDraftCatalog>;
  scheduleLazyWork: (work: () => void) => void;
}
function freeAgencyOf(run: SeasonRun): SeasonFreeAgencyState | null | undefined {
  return run.freeAgency;
}
function defaultDeps(): SeasonRunShellDeps {
  return {
    createPorts: (options) => createSeasonSessionPorts(options),
    loadManifest: () => getManifest(),
    loadLeague: () => loadSeasonLeague(),
    loadSchedule: () => loadSeasonSchedule(),
    loadPlayersIndex: () => getPlayersIndex().then((index) => index.players),
    loadCatalog: async () => {
      const { loadSeasonDraftCatalog } = await import('./season-assets');
      return loadSeasonDraftCatalog();
    },
    scheduleLazyWork: (work) => {
      if (typeof requestIdleCallback !== 'undefined') {
        requestIdleCallback(work, { timeout: 2500 });
      } else {
        setTimeout(work, 0);
      }
    },
  };
}
export class SeasonRunShell implements SeasonRunShellData {
  ready = $state(false);
  error = $state<SeasonRunLoadDiagnostic | null>(null);
  hubError = $state<SeasonRunLoadDiagnostic | null>(null);
  hub = $state<SeasonSession | null>(null);
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
  pending = $state<SeasonPendingBlockCandidate | null>(null);
  interruption = $state<SeasonInvalidRosterInterruption | null>(null);
  commandError = $state<SeasonRunCommandError | null>(null);
  commandReceipt = $state<SeasonTradeReceipt | null>(null);
  externalChange = $state<{
    kind: 'commit' | 'clear' | 'replace';
    message: string;
  } | null>(null);
  postseason = $state<HubPostseasonProgress>(idlePostseasonProgress());
  editor = $state<RotationEditor | null>(null);
  editorKey = $state<string | null>(null);
  run = $derived(this.snapshot?.run ?? null);
  humanTeam = $derived(this.run === null ? null : humanTeamOf(this.run.league));
  humanFranchiseId = $derived(this.humanTeam?.franchiseId ?? null);
  nextBlockIndex = $derived(this.snapshot === null ? null : this.snapshot.acceptedBlocks.length);
  seasonComplete = $derived((this.nextBlockIndex ?? 0) >= 9);
  health = $derived(this.run?.health ?? null);
  influence = $derived(this.run?.influence ?? null);
  trade = $derived(this.tradeStateOf(this.run?.trade ?? null));
  freeAgency = $derived(this.run?.freeAgency ?? null);
  objectives = $derived(this.run?.objectives ?? null);
  challenges = $derived(
    (this.run as unknown as { challenges?: SeasonRunShellData['challenges'] } | null)?.challenges ??
      null,
  );
  private readonly deps: SeasonRunShellDeps;
  private unsubscribeSession: (() => void) | null = null;
  private disposed = false;
  private lastHeavySnapshot: SeasonRunSnapshot | null = null;
  private lastHeavyBlockPhase: BlockRunState['phase'] | null = null;
  private faceIndexKey = '';
  private tradeCacheSource: SeasonTradeState | null = null;
  private tradeCacheClone: SeasonTradeState | null = null;
  constructor(deps: Partial<SeasonRunShellDeps> = {}) {
    this.deps = { ...defaultDeps(), ...deps };
  }
  async init(): Promise<void> {
    if (this.isDisposed()) return;
    try {
      const [manifest, league, schedule] = await Promise.all([
        this.deps.loadManifest(),
        this.deps.loadLeague(),
        this.deps.loadSchedule(),
      ]);
      if (this.isDisposed()) return;
      this.manifest = manifest;
      this.league = league;
      this.schedule = schedule;
      const session = new SeasonSession(await this.deps.createPorts({ schedule }));
      if (this.isDisposed()) {
        session.destroy();
        return;
      }
      this.hub = session;
      this.unsubscribeSession = session.subscribe(() => {
        this.onSessionEmit();
      });
      session.prewarm();
      await session.refresh();
      if (this.isDisposed()) return;
      this.mirrorSession(true);
      await this.loadPlayerSlice();
      if (this.isDisposed()) return;
      this.mirrorSession(true);
      this.scheduleLazyAssets();
    } catch (error) {
      if (!this.isDisposed()) {
        this.error = seasonRunLoadDiagnosticOf(error, 'SEASON_RUN_INIT_FAILED');
      }
    } finally {
      if (!this.isDisposed()) this.ready = true;
    }
  }
  dispose(): void {
    this.disposed = true;
    this.unsubscribeSession?.();
    this.unsubscribeSession = null;
    const session = this.hub;
    if (session !== null) {
      session.destroy();
      this.hub = null;
    }
  }
  private isDisposed(): boolean {
    return this.disposed;
  }
  private onSessionEmit(): void {
    if (this.isDisposed()) return;
    this.mirrorSession();
  }
  private mirrorSession(forceHeavy = false): void {
    const session = this.hub;
    if (session === null) return;
    const view = session.getSnapshot();
    this.snapshot = view.snapshot;
    this.index = view.index;
    this.block = view.block;
    this.postseason = hasPostseasonHubMethods(session) ? view.postseason : this.postseason;
    this.pending = view.pending;
    this.interruption = view.interruption;
    this.commandError = view.commandError;
    this.commandReceipt = view.commandReceipt;
    this.hubError = view.error;
    this.externalChange = view.externalChange;
    this.maybeRefreshHeavy(forceHeavy);
  }
  private maybeRefreshHeavy(force = false): void {
    if (this.isDisposed()) return;
    const phase = this.block.phase;
    const snapshotChanged = this.snapshot !== this.lastHeavySnapshot;
    const phaseChanged = phase !== this.lastHeavyBlockPhase;
    const isTerminal = phase !== 'running';
    if (!force && !snapshotChanged && !phaseChanged && !isTerminal) return;
    this.lastHeavySnapshot = this.snapshot;
    this.lastHeavyBlockPhase = phase;
    this.refreshRunFacts();
  }
  private refreshRunFacts(): void {
    const run = this.run;
    if (run === null) {
      this.facesByVersion = new Map();
      this.faceIndexKey = '';
      this.editor = null;
      this.editorKey = null;
      return;
    }
    this.refreshFaces();
    const rebuilt = this.rotationEditorFor(run);
    this.editor = rebuilt.editor;
    this.editorKey = rebuilt.key;
  }
  private refreshFaces(): void {
    const playersIndex = this.playersIndex;
    const run = this.run;
    if (playersIndex === null || run === null) return;
    const catalog = this.catalog;
    const freeAgency = freeAgencyOf(run);
    const freeAgencyKey =
      freeAgency === null || freeAgency === undefined
        ? 'no-fa'
        : freeAgency.windows
            .map((window) =>
              window.candidates.map((candidate) => candidate.playerVersionId).join(','),
            )
            .join('|');
    const key = `${run.runId}:${run.rosters
      .map(
        (roster) =>
          `${roster.franchiseId}:${roster.players.map((p) => p.playerVersionId).join(',')}`,
      )
      .join('|')}:${freeAgencyKey}:${catalog === null ? 'no-catalog' : 'catalog'}`;
    if (key === this.faceIndexKey) return;
    const candidates = catalog === null ? null : catalogCandidateMap(catalog);
    const tuples = [
      ...run.rosters.flatMap((roster) =>
        roster.players.map((entry) =>
          versionTupleOfRosterEntry(entry, candidates?.get(entry.playerVersionId) ?? null),
        ),
      ),
      ...freeAgencyVersionTuples(run.freeAgency, catalog),
    ];
    this.facesByVersion = buildVersionFaceIndex(playersIndex, tuples);
    this.faceIndexKey = key;
  }
  private rotationEditorFor(run: SeasonRun): {
    editor: RotationEditor | null;
    key: string | null;
  } {
    const franchiseId = this.humanFranchiseId;
    if (franchiseId === null) return { editor: null, key: null };
    const rotation = run.rotations.find((r) => r.franchiseId === franchiseId);
    const roster = run.rosters.find((r) => r.franchiseId === franchiseId);
    if (rotation === undefined || roster === undefined) return { editor: null, key: null };
    const key = `${run.runId}:${rotation.starters.join(',')}:${rotation.closingFive.join(',')}`;
    const rosterIds = roster.players.map((entry) => entry.playerVersionId);
    if (
      this.editorKey === key &&
      this.editor !== null &&
      !rotationEditorNeedsPositionRefresh(
        this.editor,
        rosterIds,
        (playerVersionId) =>
          playablePositionsOfSlice(this.playerSlice, playerVersionId) as readonly Position[],
      )
    ) {
      return { editor: this.editor, key };
    }
    const members = roster.players.map((entry) => ({
      playerVersionId: entry.playerVersionId,
      displayName: entry.displayName,
      playable: playablePositionsOfSlice(
        this.playerSlice,
        entry.playerVersionId,
      ) as readonly Position[],
      franchiseId: entry.franchiseId,
      eraId: entry.eraId,
      seasonKey: entry.seasonKey,
    }));
    return { editor: createRotationEditor(rotation, members), key };
  }
  private tradeStateOf(trade: SeasonTradeState | null): SeasonTradeState | null {
    if (trade === null) return null;
    if (trade === this.tradeCacheSource && this.tradeCacheClone !== null)
      return this.tradeCacheClone;
    const cloned: SeasonTradeState = {
      ...trade,
      windows: trade.windows.map((window) => ({
        ...window,
        offers: window.offers.map((offer) => ({
          ...offer,
          seedPath: [...offer.seedPath],
          outgoingPlayerVersionIds: [...offer.outgoingPlayerVersionIds],
          incomingPlayerVersionIds: [...offer.incomingPlayerVersionIds],
          outgoingHealth: offer.outgoingHealth.map((entry) => ({
            ...entry,
            activeInjuryIds: [...entry.activeInjuryIds],
          })),
          incomingHealth: offer.incomingHealth.map((entry) => ({
            ...entry,
            activeInjuryIds: [...entry.activeInjuryIds],
          })),
          valueBand: { ...offer.valueBand },
          roleFit: {
            ...offer.roleFit,
            outgoingRoles: [...offer.roleFit.outgoingRoles],
            incomingRoles: [...offer.roleFit.incomingRoles],
          },
          rosterNeedFacts: { ...offer.rosterNeedFacts },
          projectedChemistryDisruption: { ...offer.projectedChemistryDisruption },
        })),
        boardProfiles: window.boardProfiles?.map((profile) => ({
          ...profile,
          needs: [...profile.needs],
          listedPlayerIds: [...profile.listedPlayerIds],
          discussablePlayerIds: [...profile.discussablePlayerIds],
          protectedPlayerIds: [...profile.protectedPlayerIds],
          hardConstraints: [...profile.hardConstraints],
          competitorInterest:
            profile.competitorInterest === undefined
              ? undefined
              : { ...profile.competitorInterest },
        })),
        canonicalTeamOrder:
          window.canonicalTeamOrder === undefined ? undefined : [...window.canonicalTeamOrder],
        negotiations: window.negotiations?.map((negotiation) => ({
          ...negotiation,
          exchanges: negotiation.exchanges.map((exchange) => ({ ...exchange })),
          rejectedPlayerVersionIds: [...negotiation.rejectedPlayerVersionIds],
          expressedInterests: [...negotiation.expressedInterests],
        })),
        valueTrends: window.valueTrends?.map((trend) => ({ ...trend })),
      })),
      humanDirectNegotiations: trade.humanDirectNegotiations?.map((negotiation) => ({
        ...negotiation,
        confirmations: { ...negotiation.confirmations },
        currentProposal:
          negotiation.currentProposal === null ? null : { ...negotiation.currentProposal },
        counterProposal:
          negotiation.counterProposal === null ? null : { ...negotiation.counterProposal },
      })),
    };
    this.tradeCacheSource = trade;
    this.tradeCacheClone = cloned;
    return cloned;
  }
  private async loadPlayerSlice(): Promise<void> {
    const runId = this.snapshot?.run.runId ?? null;
    if (runId === null) {
      if (!this.isDisposed()) {
        this.playerSlice = new Map();
        this.playerSliceReady = true;
      }
      return;
    }
    try {
      const entries = await this.hub?.loadPlayerSlice(runId);
      if (this.isDisposed()) return;
      this.playerSlice = playerSliceOf(entries ?? []);
    } catch {
      if (this.isDisposed()) return;
      this.playerSlice = new Map();
    } finally {
      if (!this.isDisposed()) this.playerSliceReady = true;
    }
  }
  private async topUpPlayerSliceFromCatalog(catalog: SeasonDraftCatalog): Promise<void> {
    const run = this.run;
    const session = this.hub;
    if (run === null || session === null) return;
    const byVersion = new Map<string, SeasonRunPlayerSliceEntry>();
    for (const entry of this.playerSlice.values()) {
      byVersion.set(entry.playerVersionId, entry);
    }
    const candidates = new Map(
      catalog.candidates.map((candidate) => [candidate.playerVersionId, candidate]),
    );
    const missing: SeasonRunPlayerSliceEntry[] = [];
    for (const roster of run.rosters) {
      for (const entry of roster.players) {
        if (byVersion.has(entry.playerVersionId)) continue;
        const candidate = candidates.get(entry.playerVersionId);
        if (candidate === undefined) continue;
        missing.push({
          playerVersionId: entry.playerVersionId,
          playerId: entry.playerId,
          franchiseId: candidate.franchiseId,
          eraId: candidate.eraId,
          seasonKey: candidate.seasonKey,
          displayName: entry.displayName,
          positionsPlayable: [...candidate.positions.playable],
          summaryRatings: { ...candidate.summaryRatings },
          staminaRating: candidate.stamina.rating,
          durabilityRating: candidate.durability.rating,
        });
      }
    }
    if (missing.length === 0) return;
    await session.upsertPlayerSlice(run.runId, missing);
    if (this.isDisposed()) return;
    const merged = playerSliceOf([...byVersion.values(), ...missing]);
    this.playerSlice = merged;
  }
  private async topUpAfterTradeCommand(): Promise<void> {
    const catalog = this.catalog;
    if (catalog === null) return;
    await this.topUpPlayerSliceFromCatalog(catalog);
    this.maybeRefreshHeavy();
  }
  private scheduleLazyAssets(): void {
    this.deps.scheduleLazyWork(() => {
      void this.lazyLoadAssets();
    });
  }
  private async lazyLoadAssets(): Promise<void> {
    if (this.isDisposed() || import.meta.env.SSR) return;
    try {
      const [catalog, playersIndex] = await Promise.all([
        this.deps.loadCatalog(),
        this.deps.loadPlayersIndex(),
      ]);
      if (this.isDisposed()) return;
      this.catalog = catalog;
      if (this.hub !== null) {
        this.hub.catalog = catalog;
      }
      this.playersIndex = playersIndex;
      this.facesReady = true;
      if (this.run !== null) {
        this.refreshFaces();
      }
      await this.topUpPlayerSliceFromCatalog(catalog);
      if (this.isDisposed()) return;
      this.maybeRefreshHeavy();
      this.hub?.prewarm();
    } catch {}
  }
  private postseasonUnavailable(): void {
    this.postseason = {
      ...idlePostseasonProgress(),
      phase: 'failed',
      error: { code: 'unavailable', message: POSTSEASON_ORCHESTRATION_UNAVAILABLE },
    };
  }
  cancelBlock = (): void => {
    this.hub?.cancel();
  };
  retryBlock = (): void => {
    void this.hub?.retry();
  };
  acknowledgeExternalChange = (): void => {
    this.hub?.acknowledgeExternalChange();
    this.externalChange = null;
  };
  prewarmWorker = (): void => {
    this.hub?.prewarm();
  };
  refresh = async (): Promise<void> => {
    await this.hub?.refresh();
  };
  quitRun: SeasonRunShellData['quitRun'] = async () => {
    const session = this.hub;
    if (session === null) {
      return { ok: false, error: 'season hub is not ready' };
    }
    return session.quitRun();
  };
  spendInfluence: SeasonRunShellData['spendInfluence'] = async (input) => {
    await this.hub?.spendInfluence(input);
  };
  acceptTradeOffer: SeasonRunShellData['acceptTradeOffer'] = async (input) => {
    await this.hub?.acceptTradeOffer(input);
    await this.topUpAfterTradeCommand();
  };
  declineTradeOffer: SeasonRunShellData['declineTradeOffer'] = async (input) => {
    await this.hub?.declineTradeOffer(input);
  };
  declareFreeAgentInterest: SeasonRunShellData['declareFreeAgentInterest'] = async (input) => {
    await this.hub?.declareFreeAgentInterest(input);
  };
  skipFreeAgentMarket: SeasonRunShellData['skipFreeAgentMarket'] = async (input) => {
    await this.hub?.skipFreeAgentMarket(input);
  };
  resolveFreeAgentMarket: SeasonRunShellData['resolveFreeAgentMarket'] = async (input) => {
    await this.hub?.resolveFreeAgentMarket(input);
    await this.topUpAfterTradeCommand();
  };
  forfeitInterruptedGame = async (): Promise<void> => {
    await this.hub?.forfeitInterruptedGame();
  };
  resumeBlock = async (): Promise<void> => {
    await this.hub?.resumeBlock();
  };
  selectFrontOffice: NonNullable<SeasonRunShellData['selectFrontOffice']> = async (input) => {
    await this.hub?.selectFrontOffice(input);
  };
  selectCourtInnovation: NonNullable<SeasonRunShellData['selectCourtInnovation']> = async (
    input,
  ) => {
    await this.hub?.selectCourtInnovation(input);
  };
  openTradeInquiry: NonNullable<SeasonRunShellData['openTradeInquiry']> = async (input) => {
    await this.hub?.openTradeInquiry(input);
  };
  submitTradeProposal: NonNullable<SeasonRunShellData['submitTradeProposal']> = async (input) => {
    await this.hub?.submitTradeProposal(input);
  };
  respondToTradeCounter: NonNullable<SeasonRunShellData['respondToTradeCounter']> = async (
    input,
  ) => {
    await this.hub?.respondToTradeCounter(input);
    await this.topUpAfterTradeCommand();
  };
  walkAwayFromTrade: NonNullable<SeasonRunShellData['walkAwayFromTrade']> = async (input) => {
    await this.hub?.walkAwayFromTrade(input);
  };
  purchaseTradeInquiry: NonNullable<SeasonRunShellData['purchaseTradeInquiry']> = async (input) => {
    await this.hub?.purchaseTradeInquiry(input);
  };
  startPostseason = async (): Promise<void> => {
    const session = this.hub;
    if (session === null) return;
    if (!hasPostseasonHubMethods(session)) {
      this.postseasonUnavailable();
      return;
    }
    await session.startPostseason();
  };
  advancePostseason: SeasonRunShellData['advancePostseason'] = async (input) => {
    const session = this.hub;
    if (session === null) return;
    if (!hasPostseasonHubMethods(session)) {
      this.postseasonUnavailable();
      return;
    }
    await session.advancePostseason(input);
  };
  forfeitPostseasonGame: SeasonRunShellData['forfeitPostseasonGame'] = async (input) => {
    const session = this.hub;
    if (session === null) return;
    if (!hasPostseasonHubMethods(session)) {
      this.postseasonUnavailable();
      return;
    }
    await session.forfeitPostseasonGame(input);
  };
  submitPostseasonRotation: SeasonRunShellData['submitPostseasonRotation'] = async (input) => {
    const session = this.hub;
    if (session === null) return;
    if (!hasPostseasonHubMethods(session)) {
      this.postseasonUnavailable();
      return;
    }
    await session.submitPostseasonRotation(input);
  };
  spectatePostseasonGame: SeasonRunShellData['spectatePostseasonGame'] = async (input) => {
    const session = this.hub;
    if (session === null) return;
    if (!hasPostseasonHubMethods(session)) {
      this.postseasonUnavailable();
      return;
    }
    await session.spectatePostseasonGame(input);
  };
  fastForwardPostseason: SeasonRunShellData['fastForwardPostseason'] = async (input) => {
    const session = this.hub;
    if (session === null) return;
    if (!hasPostseasonHubMethods(session)) {
      this.postseasonUnavailable();
      return;
    }
    await session.fastForwardPostseason(input);
  };
  cancelPostseason = (): void => {
    const session = this.hub;
    if (session !== null && hasPostseasonHubMethods(session)) {
      session.cancelPostseason();
    }
  };
  playerName = (playerVersionId: string): string => {
    for (const roster of this.run?.rosters ?? []) {
      const entry = roster.players.find((p) => p.playerVersionId === playerVersionId);
      if (entry !== undefined) return entry.displayName;
    }
    return '';
  };
  playablePositions = (playerVersionId: string): readonly string[] =>
    playablePositionsOfSlice(this.playerSlice, playerVersionId);
  franchiseName = (franchiseId: string): string => {
    return (
      this.manifest?.modernFranchiseSlots.find((slot) => slot.franchiseId === franchiseId)
        ?.displayName ?? franchiseId
    );
  };
  franchiseAbbrev = (franchiseId: string): string => {
    return franchiseAbbreviation(franchiseId);
  };
}
