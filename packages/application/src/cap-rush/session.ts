import type {
  CapRushCatalogSource,
  CapRushCommand,
  CapRushDraftState,
  CapRushVariant,
  CapRushVersionSet,
  Position,
} from '@hoop-rush/data-contracts';
import {
  CAP_RUSH_HARD_LIMIT_DOLLARS,
  CAP_RUSH_RULES_VERSION,
  CAP_RUSH_SALARY_CURVE_VERSION,
  CAP_RUSH_SCHEMA_VERSION,
  CAP_RUSH_SEED_DERIVATION_VERSION,
  POSITIONS,
  capRushChoosePositionCommandSchema,
  capRushCommandResultSchema,
  capRushCreateDraftCommandSchema,
  capRushRerollOfferCommandSchema,
  capRushSignCardCommandSchema,
} from '@hoop-rush/data-contracts';
import {
  ENGINE_VERSION,
  adaptCapRushCatalog,
  applyCapRushCommand,
  buildCapRushCatalogIndex,
  capRushAssessSigning,
  capRushPayrollStatus,
  capRushStateDigest,
  createCapRushDraftState,
  type CapRushCatalogIndex,
} from '@hoop-rush/engine';
import {
  CapRushServiceError,
  type CapRushDraftView,
  type CapRushService,
  type CapRushSlotView,
  type CapRushSnapshot,
} from './contract.ts';
import type { CapRushAssetPort, CapRushDraftRepositoryPort, CapRushIdPort } from './ports.ts';

interface CapRushAssets {
  readonly index: CapRushCatalogIndex;
  readonly versionSet: CapRushVersionSet;
}

export interface CapRushSessionOptions {
  readonly repository: CapRushDraftRepositoryPort;
  readonly assets: CapRushAssetPort;
  readonly ids: CapRushIdPort;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : 'unknown cap rush service failure';
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
      const state = createCapRushDraftState(command, assets.index);
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

  async abandonDraft(): Promise<void> {
    try {
      await this.repository.clearActiveDraft();
      this.draft = null;
    } catch (error) {
      throw new CapRushServiceError('storage', messageOf(error));
    }
  }

  private async dispatch(build: (state: CapRushDraftState) => CapRushCommand): Promise<void> {
    const state = this.draft;
    if (state === null) {
      throw new CapRushServiceError('invalid-phase', 'there is no active cap rush draft');
    }
    try {
      const assets = await this.loadAssets();
      this.assertSupportedVersion(state, assets.versionSet);
      const command = build(state);
      const outcome = applyCapRushCommand(state, command, { index: assets.index });
      const applied = await this.repository.applyOutcome({ outcome, command });
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
    };
  }

  private assertSupportedVersion(state: CapRushDraftState, current: CapRushVersionSet): void {
    const version = state.versionSet;
    if (
      version.engineVersion !== current.engineVersion ||
      version.catalogVersion !== current.catalogVersion ||
      version.catalogHash !== current.catalogHash ||
      version.dataVersion !== current.dataVersion
    ) {
      throw new CapRushServiceError(
        'unsupported-version',
        'this cap rush draft was created with a different engine or data version and cannot be resumed',
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
    };
  }
}
