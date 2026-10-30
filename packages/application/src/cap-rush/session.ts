import type {
  CapRushCatalogSource,
  CapRushCommand,
  CapRushConferenceStandings,
  CapRushDraftState,
  CapRushHistoryEntry,
  CapRushLeagueGame,
  CapRushLeagueResult,
  CapRushReport,
  CapRushSpinPurchaseId,
  CapRushStoredGame,
  CapRushStoredPlayoffGame,
  CapRushVariant,
  CapRushVersionSet,
  OpponentBracket,
  Position,
} from '@hoop-rush/data-contracts';
import {
  CAP_RUSH_CONFERENCE_AI_GAMES,
  CAP_RUSH_GAME_COUNT,
  CAP_RUSH_HARD_LIMIT_DOLLARS,
  CAP_RUSH_RULES_VERSION,
  CAP_RUSH_SALARY_CURVE_VERSION,
  CAP_RUSH_SCHEMA_VERSION,
  CAP_RUSH_SEED_DERIVATION_VERSION,
  CAP_RUSH_SPIN_PURCHASES,
  POSITIONS,
  capRushAcceptGameCommandSchema,
  capRushAcceptPlayoffGameCommandSchema,
  capRushAcceptStandingsCommandSchema,
  capRushChoosePositionCommandSchema,
  capRushCommandResultSchema,
  capRushCreateDraftCommandSchema,
  capRushFinalizePostseasonCommandSchema,
  capRushFinalizeSeasonCommandSchema,
  capRushLockLineupCommandSchema,
  capRushPurchaseSpinCommandSchema,
  capRushRerollOfferCommandSchema,
  capRushSignCardCommandSchema,
  capRushSkipSpinCommandSchema,
  isConferencePostseason,
} from '@hoop-rush/data-contracts';
import {
  ENGINE_VERSION,
  adaptCapRushCatalog,
  applyCapRushCommand,
  buildCapRushCatalogIndex,
  capRushAssessSigning,
  capRushConferencePostseasonStep,
  capRushPayrollStatus,
  capRushPostseasonStep,
  capRushReport,
  capRushSpinEligibility,
  capRushStateDigest,
  createCapRushDraftState,
  type CapRushCatalogIndex,
  type CapRushLockSources,
} from '@hoop-rush/engine';
import {
  CapRushServiceError,
  type CapRushAcceptedGame,
  type CapRushAcceptedPlayoffGame,
  type CapRushAnyPostseasonStep,
  type CapRushDraftView,
  type CapRushService,
  type CapRushSlotView,
  type CapRushSnapshot,
  type CapRushSpinView,
} from './contract.ts';
import type { CapRushAssetPort, CapRushDraftRepositoryPort, CapRushIdPort } from './ports.ts';

interface CapRushAssets {
  readonly index: CapRushCatalogIndex;
  readonly versionSet: CapRushVersionSet;
  readonly lockSources: CapRushLockSources;
}

export interface CapRushSessionOptions {
  readonly repository: CapRushDraftRepositoryPort;
  readonly assets: CapRushAssetPort;
  readonly ids: CapRushIdPort;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : 'unknown cap rush service failure';
}

const OUTDATED_SAVE_MESSAGE =
  'this Cap Rush save was made by an older version of the game and cannot be resumed. Discard it to start a new draft.';

function isUnsupportedSaveError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'unsupported'
  );
}

export class CapRushSession implements CapRushService {
  private readonly repository: CapRushDraftRepositoryPort;
  private readonly assets: CapRushAssetPort;
  private readonly ids: CapRushIdPort;
  private draft: CapRushDraftState | null = null;
  private loaded: CapRushAssets | null = null;
  private assetsPromise: Promise<CapRushAssets> | null = null;

  constructor(options: CapRushSessionOptions) {
    this.repository = options.repository;
    this.assets = options.assets;
    this.ids = options.ids;
  }

  getSnapshot(): CapRushSnapshot {
    return { draft: this.buildView() };
  }

  async loadActive(): Promise<CapRushSnapshot> {
    try {
      const state = await this.repository.loadActiveDraft();
      if (state === null) {
        this.draft = null;
        return { draft: null };
      }
      const assets = await this.loadAssets();
      this.assertSupportedVersion(state, assets.versionSet);
      this.draft = state;
      return this.getSnapshot();
    } catch (error) {
      if (error instanceof CapRushServiceError) throw error;
      if (isUnsupportedSaveError(error)) {
        throw new CapRushServiceError('unsupported-version', OUTDATED_SAVE_MESSAGE);
      }
      throw new CapRushServiceError('storage', messageOf(error));
    }
  }

  async createDraft(variant: CapRushVariant): Promise<void> {
    try {
      const active = await this.repository.loadActiveDraft();
      if (active !== null) {
        throw new CapRushServiceError('invalid-phase', 'an active cap rush draft already exists');
      }
      const assets = await this.loadAssets();
      const command = capRushCreateDraftCommandSchema.parse({
        command: 'create-cap-rush-draft',
        commandId: this.ids.newCommandId(),
        runId: this.ids.newRunId(),
        runSeed: this.ids.rootSeed(),
        variant,
        versionSet: assets.versionSet,
        catalog: assets.index.catalog.source,
      });
      const state = createCapRushDraftState(command, assets.index, assets.lockSources);
      const result = capRushCommandResultSchema.parse({
        schemaVersion: CAP_RUSH_SCHEMA_VERSION,
        commandId: command.commandId,
        runId: state.runId,
        status: 'accepted',
        revisionBefore: 0,
        revisionAfter: state.revision,
        stateDigest: capRushStateDigest(state),
        rejection: null,
      });
      const applied = await this.repository.applyOutcome({
        outcome: { state, result },
        command,
      });
      if (applied.status === 'rejected') {
        throw new CapRushServiceError(
          'invalid-phase',
          applied.rejection?.message ?? 'the draft was rejected',
        );
      }
      this.draft = state;
    } catch (error) {
      if (error instanceof CapRushServiceError) throw error;
      throw new CapRushServiceError('command', messageOf(error));
    }
  }

  async choosePosition(slot: Position): Promise<void> {
    await this.dispatch((state) =>
      capRushChoosePositionCommandSchema.parse({
        command: 'choose-cap-rush-position',
        commandId: this.ids.newCommandId(),
        runId: state.runId,
        expectedRevision: state.revision,
        slot,
      }),
    );
  }

  async rerollOffer(protectedCardId: string): Promise<void> {
    await this.dispatch((state) => {
      const offer = state.offer;
      if (offer === null) {
        throw new CapRushServiceError('invalid-phase', 'there is no open offer to reroll');
      }
      return capRushRerollOfferCommandSchema.parse({
        command: 'reroll-cap-rush-offer',
        commandId: this.ids.newCommandId(),
        runId: state.runId,
        expectedRevision: state.revision,
        offerId: offer.offerId,
        protectedCardId,
      });
    });
  }

  async signCard(cardId: string): Promise<void> {
    await this.dispatch((state) => {
      const offer = state.offer;
      if (offer === null) {
        throw new CapRushServiceError('invalid-phase', 'there is no open offer to sign from');
      }
      return capRushSignCardCommandSchema.parse({
        command: 'sign-cap-rush-card',
        commandId: this.ids.newCommandId(),
        runId: state.runId,
        expectedRevision: state.revision,
        offerId: offer.offerId,
        cardId,
      });
    });
  }

  async purchaseSpin(purchase: CapRushSpinPurchaseId, targetCardId: string): Promise<void> {
    await this.dispatch((state) =>
      capRushPurchaseSpinCommandSchema.parse({
        command: 'purchase-cap-rush-spin',
        commandId: this.ids.newCommandId(),
        runId: state.runId,
        expectedRevision: state.revision,
        purchase,
        targetCardId,
      }),
    );
  }

  async skipSpin(): Promise<void> {
    await this.dispatch((state) =>
      capRushSkipSpinCommandSchema.parse({
        command: 'skip-cap-rush-spin',
        commandId: this.ids.newCommandId(),
        runId: state.runId,
        expectedRevision: state.revision,
      }),
    );
  }

  async lockLineup(): Promise<void> {
    await this.dispatch((state) => {
      if (state.stage !== 'complete') {
        throw new CapRushServiceError('invalid-phase', 'the draft is not complete');
      }
      return capRushLockLineupCommandSchema.parse({
        command: 'lock-cap-rush-lineup',
        commandId: this.ids.newCommandId(),
        runId: state.runId,
        expectedRevision: state.revision,
        picks: state.picks.map((pick) => ({ slot: pick.slot, cardId: pick.card.cardId })),
      });
    });
  }

  async updatePlayback(game: number | string, cursor: number, resolved: boolean): Promise<void> {
    if (this.draft === null)
      throw new CapRushServiceError('invalid-phase', 'there is no active run');
    await this.repository.updatePlayback(this.draft.runId, game, cursor, resolved);
  }

  async acceptGame(game: CapRushAcceptedGame): Promise<void> {
    await this.dispatch(
      (state) =>
        capRushAcceptGameCommandSchema.parse({
          command: 'accept-cap-rush-game',
          commandId: this.ids.newCommandId(),
          runId: state.runId,
          expectedRevision: state.revision,
          cursor: game.cursor,
          inputDigest: game.inputDigest,
          resultDigest: game.resultDigest,
          isolations: game.isolations,
          strikes: game.strikes,
          summary: game.summary,
          ...(game.leagueGames === undefined ? {} : { leagueGames: game.leagueGames }),
        }),
      {
        game: game.stored,
        ...(game.leagueGames === undefined ? {} : { leagueGames: game.leagueGames }),
      },
    );
  }

  async finalizeSeason(): Promise<CapRushReport | null> {
    const state = this.draft;
    if (state === null || state.locked === null) {
      throw new CapRushServiceError('invalid-phase', 'there is no locked cap rush run');
    }
    if (state.stage === 'postseason') {
      if (state.postseason?.phase !== 'complete') {
        throw new CapRushServiceError('invalid-phase', 'the postseason is not finished');
      }
      return this.buildReport(state);
    }
    if (state.season.games.length !== CAP_RUSH_GAME_COUNT) {
      throw new CapRushServiceError(
        'invalid-phase',
        `the season has ${String(state.season.games.length)} of ${String(CAP_RUSH_GAME_COUNT)} games`,
      );
    }
    const games = await this.repository.listRunGames(state.runId);
    if (games.length !== state.season.games.length) {
      throw new CapRushServiceError(
        'storage',
        `stored games (${String(games.length)}) disagree with the accepted season (${String(state.season.games.length)})`,
      );
    }
    if (state.postseasonEligible === true) {
      await this.dispatch((current) =>
        capRushFinalizeSeasonCommandSchema.parse({
          command: 'finalize-cap-rush-season',
          commandId: this.ids.newCommandId(),
          runId: current.runId,
          expectedRevision: current.revision,
        }),
      );
      return null;
    }
    const report = capRushReport({
      locked: state.locked,
      games,
      aggregate: state.season.aggregate,
      apronTriggers: state.season.apronTriggers,
      ...(state.locked.leagueSchedule === undefined
        ? {}
        : { leagueGames: await this.repository.listLeagueGames(state.runId) }),
    });
    await this.dispatch(
      (current) =>
        capRushFinalizeSeasonCommandSchema.parse({
          command: 'finalize-cap-rush-season',
          commandId: this.ids.newCommandId(),
          runId: current.runId,
          expectedRevision: current.revision,
        }),
      { report },
    );
    return report;
  }

  async acceptStandings(league: CapRushLeagueResult): Promise<void> {
    await this.dispatch((state) =>
      capRushAcceptStandingsCommandSchema.parse({
        command: 'accept-cap-rush-standings',
        commandId: this.ids.newCommandId(),
        runId: state.runId,
        expectedRevision: state.revision,
        league,
      }),
    );
  }

  async acceptConferenceStandings(standings: CapRushConferenceStandings): Promise<void> {
    await this.dispatch((state) =>
      capRushAcceptStandingsCommandSchema.parse({
        command: 'accept-cap-rush-standings',
        commandId: this.ids.newCommandId(),
        runId: state.runId,
        expectedRevision: state.revision,
        standings,
      }),
    );
  }

  async acceptPlayoffGame(game: CapRushAcceptedPlayoffGame): Promise<void> {
    await this.dispatch(
      (state) =>
        capRushAcceptPlayoffGameCommandSchema.parse({
          command: 'accept-cap-rush-playoff-game',
          commandId: this.ids.newCommandId(),
          runId: state.runId,
          expectedRevision: state.revision,
          game: game.summary,
          audit: game.stored.audit,
          result: game.stored.result,
        }),
      { playoffGame: game.stored },
    );
  }

  postseasonStep(): CapRushAnyPostseasonStep {
    const state = this.draft;
    if (state === null || state.postseason === undefined) {
      return { kind: 'complete' };
    }
    if (isConferencePostseason(state.postseason)) {
      return capRushConferencePostseasonStep({
        postseason: state.postseason,
        runSeed: state.runSeed,
        userTeamId:
          state.locked?.human.teamId ?? state.postseason.standings?.qualifiedTeamIds[0] ?? '',
      });
    }
    return capRushPostseasonStep({
      postseason: state.postseason,
      runSeed: state.runSeed,
      userTeamId: state.locked?.human.teamId,
    });
  }

  async loadBracket(): Promise<OpponentBracket> {
    try {
      const assets = await this.loadAssets();
      const hash = this.draft?.versionSet.bracketHash;
      if (hash !== undefined && hash !== assets.versionSet.bracketHash) {
        if (this.assets.loadBracket === undefined)
          throw new Error('the original opponent field is unavailable');
        return await this.assets.loadBracket(hash);
      }
      return assets.lockSources.bracket;
    } catch (error) {
      throw new CapRushServiceError('catalog', messageOf(error));
    }
  }

  async finalizePostseason(): Promise<CapRushReport> {
    const state = this.draft;
    if (state === null || state.stage !== 'postseason' || state.postseason === undefined) {
      throw new CapRushServiceError('invalid-phase', 'there is no active cap rush postseason');
    }
    try {
      const assets = await this.loadAssets();
      this.assertSupportedVersion(state, assets.versionSet);
      const command = capRushFinalizePostseasonCommandSchema.parse({
        command: 'finalize-cap-rush-postseason',
        commandId: this.ids.newCommandId(),
        runId: state.runId,
        expectedRevision: state.revision,
      });
      const outcome = applyCapRushCommand(state, command, {
        index: assets.index,
        lockSources: assets.lockSources,
      });
      if (outcome.result.status !== 'accepted') {
        throw new CapRushServiceError(
          'invalid-phase',
          outcome.result.rejection?.message ?? 'the postseason could not be finalized',
        );
      }
      const report = await this.buildReport(outcome.state);
      const applied = await this.repository.applyOutcome({
        outcome,
        command,
        report,
      });
      if (applied.status === 'rejected') {
        throw new CapRushServiceError(
          'invalid-phase',
          applied.rejection?.message ?? 'the postseason could not be finalized',
        );
      }
      this.draft = outcome.state;
      return report;
    } catch (error) {
      if (error instanceof CapRushServiceError) throw error;
      throw new CapRushServiceError('command', messageOf(error));
    }
  }

  private async buildReport(state: CapRushDraftState): Promise<CapRushReport> {
    if (state.locked === null) {
      throw new CapRushServiceError('invalid-phase', 'there is no locked cap rush run');
    }
    const games = await this.repository.listRunGames(state.runId);
    if (games.length !== state.season.games.length) {
      throw new CapRushServiceError(
        'storage',
        `stored games (${String(games.length)}) disagree with the accepted season (${String(state.season.games.length)})`,
      );
    }
    return capRushReport({
      locked: state.locked,
      games,
      aggregate: state.season.aggregate,
      apronTriggers: state.season.apronTriggers,
      postseason: state.postseason,
      ...(state.locked.leagueSchedule === undefined
        ? {}
        : { leagueGames: await this.repository.listLeagueGames(state.runId) }),
    });
  }

  async loadReport(runId: string): Promise<CapRushReport | null> {
    try {
      return await this.repository.readReport(runId);
    } catch (error) {
      throw new CapRushServiceError('storage', messageOf(error));
    }
  }

  async listHistory(): Promise<readonly CapRushHistoryEntry[]> {
    try {
      return await this.repository.listHistory();
    } catch (error) {
      throw new CapRushServiceError('storage', messageOf(error));
    }
  }

  async listRunGames(runId: string): Promise<readonly CapRushStoredGame[]> {
    try {
      return await this.repository.listRunGames(runId);
    } catch (error) {
      throw new CapRushServiceError('storage', messageOf(error));
    }
  }

  async listPlayoffGames(runId: string): Promise<readonly CapRushStoredPlayoffGame[]> {
    try {
      return await this.repository.listPlayoffGames(runId);
    } catch (error) {
      throw new CapRushServiceError('storage', messageOf(error));
    }
  }

  async listLeagueGames(runId: string): Promise<readonly CapRushLeagueGame[]> {
    try {
      return await this.repository.listLeagueGames(runId);
    } catch (error) {
      throw new CapRushServiceError('storage', messageOf(error));
    }
  }

  async abandonDraft(): Promise<void> {
    try {
      await this.repository.clearActiveDraft();
      this.draft = null;
    } catch (error) {
      throw new CapRushServiceError('storage', messageOf(error));
    }
  }

  private async dispatch(
    build: (state: CapRushDraftState) => CapRushCommand,
    extra: {
      readonly game?: CapRushStoredGame;
      readonly playoffGame?: CapRushStoredPlayoffGame;
      readonly leagueGames?: readonly CapRushLeagueGame[];
      readonly report?: CapRushReport;
    } = {},
  ): Promise<void> {
    const state = this.draft;
    if (state === null) {
      throw new CapRushServiceError('invalid-phase', 'there is no active cap rush draft');
    }
    try {
      const assets = await this.loadAssets();
      this.assertSupportedVersion(state, assets.versionSet);
      const command = build(state);
      const outcome = applyCapRushCommand(state, command, {
        index: assets.index,
        lockSources: assets.lockSources,
      });
      const applied = await this.repository.applyOutcome({
        outcome,
        command,
        ...(extra.game === undefined ? {} : { game: extra.game }),
        ...(extra.playoffGame === undefined ? {} : { playoffGame: extra.playoffGame }),
        ...(extra.leagueGames === undefined ? {} : { leagueGames: extra.leagueGames }),
        ...(extra.report === undefined ? {} : { report: extra.report }),
      });
      if (applied.status === 'rejected') {
        throw new CapRushServiceError(
          'invalid-phase',
          applied.rejection?.message ?? 'the draft rejected that action',
        );
      }
      this.draft = outcome.state;
    } catch (error) {
      if (error instanceof CapRushServiceError) throw error;
      throw new CapRushServiceError('command', messageOf(error));
    }
  }

  private buildView(): CapRushDraftView | null {
    const state = this.draft;
    const assets = this.loaded;
    if (state === null || assets === null) return null;
    const payrollDollars = state.picks.reduce((total, pick) => total + pick.card.salaryDollars, 0);
    const pickBySlot = new Map(state.picks.map((pick) => [pick.slot, pick]));
    const slots: CapRushSlotView[] = POSITIONS.map((slot) => {
      const pick = pickBySlot.get(slot);
      return {
        slot,
        player: pick?.card.source ?? null,
        salaryDollars: pick?.card.salaryDollars ?? 0,
        highestPaid: false,
      };
    });
    if (state.picks.length > 0) {
      const highest = [...state.picks].sort((left, right) => {
        if (left.card.salaryDollars !== right.card.salaryDollars) {
          return right.card.salaryDollars - left.card.salaryDollars;
        }
        return POSITIONS.indexOf(left.slot) - POSITIONS.indexOf(right.slot);
      })[0];
      if (highest !== undefined) {
        const target = slots.find((slot) => slot.slot === highest.slot);
        if (target !== undefined) {
          const index = slots.indexOf(target);
          slots[index] = { ...target, highestPaid: true };
        }
      }
    }
    return {
      draft: state,
      franchise: state.franchise ?? null,
      payrollDollars,
      hardLimitDollars: CAP_RUSH_HARD_LIMIT_DOLLARS,
      remainingRoomDollars: CAP_RUSH_HARD_LIMIT_DOLLARS - payrollDollars,
      status: capRushPayrollStatus(payrollDollars),
      cards:
        state.offer?.cards.map((card) => ({
          card,
          signing: capRushAssessSigning(state, assets.index, card),
        })) ?? [],
      slots,
      spin: this.buildSpinView(state, payrollDollars),
      canLock:
        state.stage === 'complete' &&
        (state.variant === 'clash' || state.spin.status !== 'pending'),
      season:
        state.stage === 'locked' ||
        state.stage === 'postseason' ||
        state.stage === 'completed' ||
        state.stage === 'abandoned'
          ? {
              games: state.season.games,
              aggregate: state.season.aggregate,
              apronTriggers: state.season.apronTriggers,
              completedAt: state.season.completedAt,
              nextGameNumber: state.season.games.length + 1,
              leagueGamesAccepted: state.season.leagueGamesAccepted ?? 0,
              leagueGamesTotal:
                state.locked?.leagueSchedule === undefined ? 0 : CAP_RUSH_CONFERENCE_AI_GAMES,
            }
          : null,
      postseason: state.postseason ?? null,
    };
  }

  private buildSpinView(state: CapRushDraftState, payrollDollars: number): CapRushSpinView | null {
    if (state.stage !== 'complete' || state.variant !== 'roulette') return null;
    return {
      state: state.spin,
      targets: [...state.picks]
        .sort((left, right) => left.pickOrdinal - right.pickOrdinal)
        .map((pick) => ({
          pickOrdinal: pick.pickOrdinal,
          cardId: pick.card.cardId,
          slot: pick.slot,
          player: pick.card.source,
          salaryDollars: pick.card.salaryDollars,
        })),
      purchases: (['standard', 'premium'] as const).map((purchase) => {
        const spent =
          state.spin.status === 'purchased'
            ? [state.spin.receipt, ...(state.spin.additionalReceipts ?? [])].reduce(
                (total, receipt) => total + receipt.priceDollars,
                0,
              )
            : 0;
        const eligibility = capRushSpinEligibility(payrollDollars + spent, purchase);
        return {
          purchase,
          priceDollars: eligibility.priceDollars,
          maxEligiblePayrollDollars: eligibility.maxEligiblePayrollDollars,
          eligible: eligibility.eligible,
          tierOdds: CAP_RUSH_SPIN_PURCHASES[purchase].tierOdds,
        };
      }),
    };
  }

  private assertSupportedVersion(state: CapRushDraftState, current: CapRushVersionSet): void {
    const version = state.versionSet;
    if (
      version.engineVersion !== current.engineVersion ||
      version.catalogVersion !== current.catalogVersion ||
      version.catalogHash !== current.catalogHash ||
      version.dataVersion !== current.dataVersion ||
      version.profileVersion !== current.profileVersion ||
      (version.bracketHash !== current.bracketHash &&
        (state.locked === null || state.locked.versionSet.bracketHash !== version.bracketHash)) ||
      version.profileHash !== current.profileHash
    ) {
      throw new CapRushServiceError(
        'unsupported-version',
        'this cap rush draft was created with a different engine, bracket or data version and cannot be resumed',
      );
    }
  }

  private loadAssets(): Promise<CapRushAssets> {
    if (this.loaded !== null) return Promise.resolve(this.loaded);
    if (this.assetsPromise !== null) return this.assetsPromise;
    this.assetsPromise = this.buildAssets().then(
      (assets) => {
        this.loaded = assets;
        return assets;
      },
      (error: unknown) => {
        this.assetsPromise = null;
        throw error;
      },
    );
    return this.assetsPromise;
  }

  private async buildAssets(): Promise<CapRushAssets> {
    const [catalog, preamble] = await Promise.all([
      this.assets.loadCatalog(),
      this.assets.loadPreamble(),
    ]);
    const manifest = preamble.manifest;
    const catalogEntry = manifest.draftCatalog;
    const profileEntry = manifest.eraSimulationProfiles.find((entry) => entry.eraId === '2010s');
    const bracketEntry = manifest.bracket;
    if (catalogEntry === undefined || profileEntry === undefined || bracketEntry === undefined) {
      throw new CapRushServiceError('catalog', 'the cap rush data assets are unavailable');
    }
    const catalogSource: CapRushCatalogSource = {
      catalogVersion: catalog.catalogVersion,
      catalogHash: catalogEntry.contentHash,
      dataVersion: catalog.dataVersion,
      ratingsVersion: catalog.ratingsVersion,
      playerVersionIdVersion: catalog.playerVersionIdVersion,
      positionNormalizationVersion: catalog.positionNormalizationVersion,
    };
    const versionSet: CapRushVersionSet = {
      schemaVersion: CAP_RUSH_SCHEMA_VERSION,
      rulesVersion: CAP_RUSH_RULES_VERSION,
      salaryCurveVersion: CAP_RUSH_SALARY_CURVE_VERSION,
      seedDerivationVersion: CAP_RUSH_SEED_DERIVATION_VERSION,
      engineVersion: ENGINE_VERSION,
      profileVersion: preamble.profile.profileVersion,
      dataVersion: catalog.dataVersion,
      catalogVersion: catalog.catalogVersion,
      catalogHash: catalogEntry.contentHash,
      bracketHash: bracketEntry.contentHash,
      profileHash: profileEntry.contentHash,
    };
    return {
      index: buildCapRushCatalogIndex(adaptCapRushCatalog(catalog, catalogSource)),
      versionSet,
      lockSources: {
        bracket: preamble.bracket,
        profile: preamble.profile,
        historicalCatalog: catalog,
      },
    };
  }
}
