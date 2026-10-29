import { describe, expect, it } from 'bun:test';
/* eslint-disable @typescript-eslint/require-await -- the in-memory fake mirrors async repository methods without I/O */
import type {
  CapRushCommand,
  CapRushCommandResult,
  CapRushDraftState,
  HoopRushManifest,
  Seed,
} from '@hoop-rush/data-contracts';
import {
  CAP_RUSH_GAME_COUNT,
  CAP_RUSH_RULES_VERSION,
  CAP_RUSH_SALARY_CURVE_VERSION,
  CAP_RUSH_SCHEMA_VERSION,
  CAP_RUSH_SEED_DERIVATION_VERSION,
  POSITIONS,
  capRushVersionSetSchema,
  commandIdSchema,
  contentHashSchema,
  eraIdSchema,
  idSchema,
  seedSchema,
} from '@hoop-rush/data-contracts';
import {
  adaptCapRushCatalog,
  buildCapRushCatalogIndex,
  createCapRushDraftState,
} from '@hoop-rush/engine';
import type { CapRushRepository } from '@hoop-rush/persistence';
import {
  buildCapRushTestCatalog,
  buildEraSimulationProfile,
  buildFixtureBracket,
  buildManifest,
  capRushTestCatalogSource,
} from '@hoop-rush/test-fixtures';
import { CapRushServiceError, CapRushSession, type CapRushDraftRepositoryPort } from './index.ts';

class MemoryCapRushRepository implements CapRushRepository {
  active: CapRushDraftState | null = null;
  readonly commands = new Map<string, CapRushCommandResult>();

  async loadActiveDraft(): Promise<CapRushDraftState | null> {
    return this.active;
  }

  async loadCommandResult(commandId: string): Promise<CapRushCommandResult | null> {
    return this.commands.get(commandId) ?? null;
  }

  async applyOutcome(input: {
    outcome: { state: CapRushDraftState; result: CapRushCommandResult };
    command: CapRushCommand;
  }): Promise<CapRushCommandResult> {
    const recorded = this.commands.get(input.outcome.result.commandId);
    if (recorded !== undefined) return recorded;
    const result = input.outcome.result;
    this.commands.set(result.commandId, result);
    if (result.status === 'accepted') {
      if (this.active !== null && this.active.revision !== result.revisionBefore) {
        throw new Error('stale revision');
      }
      this.active = input.outcome.state;
    }
    return result;
  }

  async clearActiveDraft(): Promise<void> {
    this.active = null;
    this.commands.clear();
  }
}

function createAssets() {
  const catalog = buildCapRushTestCatalog();
  const source = capRushTestCatalogSource(catalog);
  const manifest: HoopRushManifest = buildManifest({
    draftCatalog: {
      url: 'draft-catalog.json',
      contentHash: contentHashSchema.parse(source.catalogHash),
    },
    eraSimulationProfiles: [
      {
        eraId: eraIdSchema.parse('2010s'),
        url: '2010s.json',
        contentHash: contentHashSchema.parse('c'.repeat(64)),
      },
    ],
    bracket: {
      url: 'bracket.json',
      contentHash: contentHashSchema.parse('b'.repeat(64)),
    },
  });
  const profile = buildEraSimulationProfile({ eraId: eraIdSchema.parse('2010s') });
  const bracket = buildFixtureBracket();
  return {
    catalog,
    source,
    manifest,
    assets: {
      loadCatalog: async () => catalog,
      loadPreamble: async () => ({ manifest, profile, bracket }),
    },
  };
}

function createSession(repository: CapRushDraftRepositoryPort) {
  const { assets } = createAssets();
  let counter = 0;
  return new CapRushSession({
    repository,
    assets,
    ids: {
      newRunId: () => 'run-test',
      newCommandId: () => {
        counter += 1;
        return `cmd-${String(counter)}`;
      },
      rootSeed: (): Seed => seedSchema.parse('abc123def4567890'),
    },
  });
}

describe('cap rush session', () => {
  it('creates, drafts, persists, and resumes a run', async () => {
    const repository = new MemoryCapRushRepository();
    const session = createSession(repository);
    await session.createDraft('clash');
    expect(session.getSnapshot().draft?.draft.stage).toBe('select-position');

    await session.choosePosition('PG');
    const offered = session.getSnapshot().draft;
    expect(offered?.draft.offer?.cards).toHaveLength(8);
    const legal = offered?.cards.find((entry) => entry.signing.legal);
    if (legal === undefined) throw new Error('offer has no legal signing');

    await session.signCard(legal.card.cardId);
    expect(session.getSnapshot().draft?.draft.picks).toHaveLength(1);

    const resumed = createSession(repository);
    const loaded = await resumed.loadActive();
    expect(loaded.draft?.draft.picks).toHaveLength(1);
    expect(loaded.draft?.draft.picks[0]?.card.cardId).toBe(legal.card.cardId);

    await resumed.abandonDraft();
    expect(repository.active).toBeNull();
  });

  it('rejects an incompatible stored version without rewriting it', async () => {
    const repository = new MemoryCapRushRepository();
    const catalog = buildCapRushTestCatalog();
    const source = capRushTestCatalogSource(catalog);
    const index = buildCapRushCatalogIndex(adaptCapRushCatalog(catalog, source));
    const versionSet = capRushVersionSetSchema.parse({
      schemaVersion: CAP_RUSH_SCHEMA_VERSION,
      rulesVersion: CAP_RUSH_RULES_VERSION,
      salaryCurveVersion: CAP_RUSH_SALARY_CURVE_VERSION,
      seedDerivationVersion: CAP_RUSH_SEED_DERIVATION_VERSION,
      engineVersion: 'older-engine-v0',
      profileVersion: 'test-profile-v1',
      dataVersion: source.dataVersion,
      catalogVersion: source.catalogVersion,
      catalogHash: source.catalogHash,
      bracketHash: 'b'.repeat(64),
      profileHash: 'c'.repeat(64),
    });
    const command = {
      command: 'create-cap-rush-draft' as const,
      commandId: commandIdSchema.parse('cmd-old'),
      runId: idSchema.parse('run-old'),
      runSeed: seedSchema.parse('abc123def4567890'),
      variant: 'clash' as const,
      versionSet,
      catalog: source,
    };
    const state = createCapRushDraftState(command, index);
    repository.active = state;

    const session = createSession(repository);
    await expect(session.loadActive()).rejects.toBeInstanceOf(CapRushServiceError);
    await expect(session.loadActive()).rejects.toMatchObject({ code: 'unsupported-version' });
    expect(repository.active).toBe(state);
    expect(repository.active.versionSet.engineVersion).toBe('older-engine-v0');
  });

  it('stores a rejected command without changing the active draft', async () => {
    const repository = new MemoryCapRushRepository();
    const session = createSession(repository);
    await session.createDraft('clash');
    await session.choosePosition('PG');
    const before = repository.active;
    await expect(session.signCard(`crc-${'0'.repeat(32)}`)).rejects.toBeInstanceOf(
      CapRushServiceError,
    );
    expect(repository.active).toBe(before);
    expect(repository.commands.size).toBe(3);
  });

  it('buys one Roulette spin and resumes the persisted receipt', async () => {
    const repository = new MemoryCapRushRepository();
    const session = createSession(repository);
    await session.createDraft('roulette');
    for (const slot of POSITIONS) {
      await session.choosePosition(slot);
      const cards = session.getSnapshot().draft?.cards ?? [];
      const cheapest = [...cards]
        .filter((entry) => entry.signing.legal)
        .sort((left, right) => left.card.salaryDollars - right.card.salaryDollars)[0];
      if (cheapest === undefined) throw new Error(`no legal ${slot} signing`);
      await session.signCard(cheapest.card.cardId);
    }
    const complete = session.getSnapshot().draft;
    expect(complete?.draft.stage).toBe('complete');
    expect(complete?.spin?.state.status).toBe('pending');
    const target = complete?.spin?.targets[0];
    if (target === undefined) throw new Error('roulette spin has no targets');

    await session.purchaseSpin('standard', target.cardId);
    const purchased = session.getSnapshot().draft?.spin;
    expect(purchased?.state.status).toBe('purchased');
    await expect(session.skipSpin()).rejects.toBeInstanceOf(CapRushServiceError);

    const resumed = createSession(repository);
    const loaded = await resumed.loadActive();
    const spin = loaded.draft?.spin;
    if (spin === undefined || spin === null || spin.state.status !== 'purchased') {
      throw new Error('resumed spin receipt is missing');
    }
    expect(spin.state.receipt.target.cardId).toBe(target.cardId);
    expect(spin.state.receipt.receiptDigest).toHaveLength(32);
  });

  it('locks the lineup and resumes the pinned inputs', async () => {
    const repository = new MemoryCapRushRepository();
    const session = createSession(repository);
    await session.createDraft('clash');
    for (const slot of POSITIONS) {
      await session.choosePosition(slot);
      const cards = session.getSnapshot().draft?.cards ?? [];
      const cheapest = [...cards]
        .filter((entry) => entry.signing.legal)
        .sort((left, right) => left.card.salaryDollars - right.card.salaryDollars)[0];
      if (cheapest === undefined) throw new Error(`no legal ${slot} signing`);
      await session.signCard(cheapest.card.cardId);
    }
    const complete = session.getSnapshot().draft;
    expect(complete?.canLock).toBe(true);
    expect(complete?.draft.locked).toBeNull();

    await session.lockLineup();
    const locked = session.getSnapshot().draft;
    expect(locked?.draft.stage).toBe('locked');
    expect(locked?.canLock).toBe(false);
    const inputs = locked?.draft.locked;
    if (inputs === undefined || inputs === null) throw new Error('lock did not produce inputs');
    expect(inputs.payrollDollars).toBe(complete?.payrollDollars ?? -1);
    expect(inputs.schedule).toHaveLength(CAP_RUSH_GAME_COUNT);

    const resumed = createSession(repository);
    const loaded = await resumed.loadActive();
    expect(loaded.draft?.draft.stage).toBe('locked');
    expect(loaded.draft?.draft.locked).toEqual(inputs);
    await expect(resumed.lockLineup()).rejects.toBeInstanceOf(CapRushServiceError);
  });

  it('refuses to resume a locked run against a different bracket', async () => {
    const repository = new MemoryCapRushRepository();
    const session = createSession(repository);
    await session.createDraft('clash');
    for (const slot of POSITIONS) {
      await session.choosePosition(slot);
      const cards = session.getSnapshot().draft?.cards ?? [];
      const cheapest = [...cards]
        .filter((entry) => entry.signing.legal)
        .sort((left, right) => left.card.salaryDollars - right.card.salaryDollars)[0];
      if (cheapest === undefined) throw new Error(`no legal ${slot} signing`);
      await session.signCard(cheapest.card.cardId);
    }
    await session.lockLineup();

    const stored = repository.active;
    if (stored === null) throw new Error('lock was not stored');
    repository.active = {
      ...stored,
      versionSet: {
        ...stored.versionSet,
        bracketHash: contentHashSchema.parse('d'.repeat(64)),
      },
    };

    const resumed = createSession(repository);
    await expect(resumed.loadActive()).rejects.toBeInstanceOf(CapRushServiceError);
  });
});
