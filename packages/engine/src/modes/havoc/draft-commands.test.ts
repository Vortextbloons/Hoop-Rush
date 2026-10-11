import { describe, expect, it } from 'vitest';
import type { HavocLockLineupCommand, HavocRunState } from '@hoop-rush/data-contracts';
import {
  HAVOC_DRAFT_ROUNDS,
  HAVOC_SCHEMA_VERSION,
  canonicalJson,
  havocClaimKeyOf,
  havocLockLineupCommandSchema,
  havocLockedInputsSchema,
  havocPickCardCommandSchema,
  havocRerollOfferCommandSchema,
  havocRunStateSchema,
  playerIdSchema,
  seedSchema,
  seedFromString,
} from '@hoop-rush/data-contracts';
import {
  buildFixtureBracket,
  buildHavocCard,
  buildHavocDraftPick,
  buildHavocDraftState,
  buildHavocRunState,
  buildHavocSourcePlayer,
} from '@hoop-rush/test-fixtures';
import type { HavocLockSources } from './api.ts';
import { HavocCatalogCoverageError } from './api.ts';
import { AdaptHavocCatalog } from './catalog.ts';
import { CreateHavocRunState } from './draft-commands.ts';
import { ApplyHavocCommand } from './run-commands.ts';
import { HavocStateDigest } from './state-digest.ts';
import {
  HAVOC_TEST_RUN_SEED,
  buildHavocCatalogFixture,
  buildHavocCreateCommandFixture,
  buildHavocEnvironmentFixture,
  buildHavocEraProfileFixture,
} from './havoc-test-support.ts';

const fixture = buildHavocCatalogFixture();
const environment = buildHavocEnvironmentFixture(fixture.adapted);
const lockSources: HavocLockSources = {
  bracket: buildFixtureBracket(),
  profile: buildHavocEraProfileFixture(),
};

function createDraftState(runSeedOverride?: string): HavocRunState {
  const command = buildHavocCreateCommandFixture(
    fixture,
    runSeedOverride === undefined
      ? {}
      : { runSeed: seedSchema.parse(seedFromString(runSeedOverride)) },
  );
  return CreateHavocRunState(command, fixture.adapted, environment);
}

function rerollCommand(state: HavocRunState, overrides: Record<string, unknown> = {}) {
  const draft = state.draft;
  if (draft === null) throw new Error('no draft');
  return havocRerollOfferCommandSchema.parse({
    schemaVersion: HAVOC_SCHEMA_VERSION,
    commandId: `cmd-reroll-${String(state.revision)}`,
    runId: state.runId,
    expectedRevision: state.revision,
    command: 'reroll-havoc-offer',
    offerId: draft.offerId,
    ...overrides,
  });
}

function pickCommand(
  state: HavocRunState,
  cardId: string,
  overrides: Record<string, unknown> = {},
) {
  const draft = state.draft;
  if (draft === null) throw new Error('no draft');
  return havocPickCardCommandSchema.parse({
    schemaVersion: HAVOC_SCHEMA_VERSION,
    commandId: `cmd-pick-${String(state.revision)}`,
    runId: state.runId,
    expectedRevision: state.revision,
    command: 'pick-havoc-card',
    offerId: draft.offerId,
    cardId,
    ...overrides,
  });
}

function lockCommand(state: HavocRunState): HavocLockLineupCommand {
  const draft = state.draft;
  if (draft === null) throw new Error('no draft');
  return havocLockLineupCommandSchema.parse({
    schemaVersion: HAVOC_SCHEMA_VERSION,
    commandId: `cmd-lock-${String(state.revision)}`,
    runId: state.runId,
    expectedRevision: state.revision,
    command: 'lock-havoc-lineup',
    picks: draft.picks.map((pick) => ({ slot: pick.slot, cardId: pick.card.cardId })),
  });
}

function pickFirstCard(state: HavocRunState): HavocRunState {
  const card = state.draft?.cards[0];
  if (card === undefined) throw new Error('empty offer');
  const outcome = ApplyHavocCommand(
    state,
    pickCommand(state, card.cardId),
    environment,
    lockSources,
  );
  expect(outcome.result.status).toBe('accepted');
  return outcome.state;
}

function draftToCompletion(start: HavocRunState): HavocRunState {
  let state = start;
  while (state.draft !== null && state.draft.status === 'drafting') {
    state = pickFirstCard(state);
  }
  return state;
}

describe('havoc draft command flow', () => {
  it('creates a round-1 draft state from the frozen command', () => {
    const state = createDraftState();
    expect(state.revision).toBe(0);
    expect(state.phase).toBe('draft');
    expect(state.runSeed).toBe(HAVOC_TEST_RUN_SEED);
    expect(state.draft).not.toBeNull();
    expect(state.draft?.round).toBe(1);
    expect(state.draft?.slot).toBe('PG');
    expect(state.draft?.status).toBe('drafting');
    expect(state.draft?.offerIndex).toBe(0);
    expect(state.draft?.rerollUsed).toBe(false);
    expect(state.draft?.cards).toHaveLength(3);
    expect(state.draft?.catalog).toEqual(fixture.source);
    expect(state.locked).toBeNull();
    expect(state.havocAggregate.games).toBe(0);
    expect(havocRunStateSchema.safeParse(state).success).toBe(true);
  });

  it('replays identical seeds and commands into identical states', () => {
    const first = draftToCompletion(createDraftState());
    const second = draftToCompletion(createDraftState());
    expect(canonicalJson(first)).toBe(canonicalJson(second));
    expect(HavocStateDigest(first)).toBe(HavocStateDigest(second));
    expect(first.draft?.status).toBe('complete');
    expect(first.draft?.picks).toHaveLength(5);
    expect(first.revision).toBe(5);

    const rerollFirst = (() => {
      const created = createDraftState();
      const rerolled = ApplyHavocCommand(created, rerollCommand(created), environment, lockSources);
      expect(rerolled.result.status).toBe('accepted');
      return draftToCompletion(rerolled.state);
    })();
    const rerollSecond = (() => {
      const created = createDraftState();
      const rerolled = ApplyHavocCommand(created, rerollCommand(created), environment, lockSources);
      expect(rerolled.result.status).toBe('accepted');
      return draftToCompletion(rerolled.state);
    })();
    expect(canonicalJson(rerollFirst)).toBe(canonicalJson(rerollSecond));
    expect(HavocStateDigest(rerollFirst)).toBe(HavocStateDigest(rerollSecond));
    expect(rerollFirst.draft?.rerollUsed).toBe(true);
    expect(rerollFirst.revision).toBe(6);
    expect(rerollFirst.draft?.picks).toHaveLength(5);
  });

  it('resumes a reloaded draft state without granting extra randomness', () => {
    const partial = pickFirstCard(pickFirstCard(createDraftState()));
    expect(partial.revision).toBe(2);
    expect(partial.draft?.round).toBe(3);
    const reloaded = havocRunStateSchema.parse(JSON.parse(JSON.stringify(partial)) as unknown);
    expect(HavocStateDigest(reloaded)).toBe(HavocStateDigest(partial));
    const card = reloaded.draft?.cards[0];
    if (card === undefined) throw new Error('empty offer');
    const command = pickCommand(partial, card.cardId, { commandId: 'cmd-reloaded-pick' });
    const fromOriginal = ApplyHavocCommand(partial, command, environment, lockSources);
    const fromReload = ApplyHavocCommand(reloaded, command, environment, lockSources);
    expect(fromOriginal.result).toEqual(fromReload.result);
    expect(canonicalJson(fromOriginal.state)).toBe(canonicalJson(fromReload.state));
  });

  it('uses the single draft-wide reroll exactly once and never mutates on rejection', () => {
    const state = createDraftState();
    const before = state.draft?.offerId;
    const first = ApplyHavocCommand(state, rerollCommand(state), environment, lockSources);
    expect(first.result.status).toBe('accepted');
    expect(first.result.revisionBefore).toBe(0);
    expect(first.result.revisionAfter).toBe(1);
    expect(first.state.revision).toBe(1);
    expect(first.state.draft?.rerollUsed).toBe(true);
    expect(first.state.draft?.offerIndex).toBe(1);
    expect(first.state.draft?.offerId).not.toBe(before);
    const second = ApplyHavocCommand(
      first.state,
      rerollCommand(first.state),
      environment,
      lockSources,
    );
    expect(second.result.status).toBe('rejected');
    expect(second.result.rejection?.code).toBe('reroll-spent');
    expect(second.state).toBe(first.state);
    expect(second.result.revisionAfter).toBe(1);
    expect(HavocStateDigest(second.state)).toBe(HavocStateDigest(first.state));

    const picked = pickFirstCard(first.state);
    const lateReroll = ApplyHavocCommand(picked, rerollCommand(picked), environment, lockSources);
    expect(lateReroll.result.status).toBe('rejected');
    expect(lateReroll.result.rejection?.code).toBe('reroll-spent');
  });

  it('rejects stale revisions, wrong runs, wrong offers, and unknown cards', () => {
    const state = createDraftState();
    const card = state.draft?.cards[0];
    if (card === undefined) throw new Error('empty offer');
    const stale = ApplyHavocCommand(
      state,
      pickCommand(state, card.cardId, { expectedRevision: 7 }),
      environment,
      lockSources,
    );
    expect(stale.result.rejection?.code).toBe('stale-revision');
    const wrongRun = ApplyHavocCommand(
      state,
      pickCommand(state, card.cardId, { runId: 'other-run' }),
      environment,
      lockSources,
    );
    expect(wrongRun.result.rejection?.code).toBe('run-mismatch');
    const wrongOffer = ApplyHavocCommand(
      state,
      pickCommand(state, card.cardId, { offerId: `hvo-${'f'.repeat(32)}` }),
      environment,
      lockSources,
    );
    expect(wrongOffer.result.rejection?.code).toBe('offer-mismatch');
    const unknown = ApplyHavocCommand(
      state,
      pickCommand(state, `hvc-${'f'.repeat(32)}`),
      environment,
      lockSources,
    );
    expect(unknown.result.rejection?.code).toBe('unknown-card');
    for (const outcome of [stale, wrongRun, wrongOffer, unknown]) {
      expect(outcome.state).toBe(state);
      expect(outcome.result.revisionAfter).toBe(state.revision);
    }
  });

  it('advances round and slot after a pick and excludes the drafted claim', () => {
    const state = createDraftState();
    const card = state.draft?.cards[0];
    if (card === undefined) throw new Error('empty offer');
    const draftedClaim = havocClaimKeyOf(card.source.playerId, card.source.seasonKey ?? '');
    const outcome = ApplyHavocCommand(
      state,
      pickCommand(state, card.cardId),
      environment,
      lockSources,
    );
    expect(outcome.result.status).toBe('accepted');
    const draft = outcome.state.draft;
    expect(draft?.round).toBe(2);
    expect(draft?.slot).toBe('SG');
    expect(draft?.offerIndex).toBe(0);
    expect(draft?.picks).toHaveLength(1);
    expect(draft?.picks[0]?.claimKey).toEqual({
      playerId: card.source.playerId,
      seasonKey: card.source.seasonKey,
    });
    for (const next of draft?.cards ?? []) {
      expect(havocClaimKeyOf(next.source.playerId, next.source.seasonKey ?? '')).not.toBe(
        draftedClaim,
      );
    }
  });

  it('rejects picking a card whose claim was already drafted', () => {
    const offerId = `hvo-${'a'.repeat(32)}`;
    const sharedSource = buildHavocSourcePlayer({
      playerId: playerIdSchema.parse('p-dup-claim'),
      positions: ['PG'],
    });
    const pickedCard = buildHavocCard({
      slot: 'PG',
      offerId,
      cardId: `hvc-${'1'.repeat(32)}`,
      source: sharedSource,
    });
    const duplicateCard = buildHavocCard({
      slot: 'SG',
      offerId,
      cardId: `hvc-${'2'.repeat(32)}`,
      source: { ...sharedSource, positions: ['SG'] },
    });
    const draft = buildHavocDraftState({
      offerId,
      round: 2,
      slot: 'SG',
      offerIndex: 0,
      rerollUsed: false,
      picks: [buildHavocDraftPick(0, { card: pickedCard })],
      cards: [
        duplicateCard,
        buildHavocCard({
          slot: 'SG',
          offerId,
          cardId: `hvc-${'3'.repeat(32)}`,
          source: buildHavocSourcePlayer({
            playerId: playerIdSchema.parse('p-other'),
            positions: ['SG'],
          }),
        }),
        buildHavocCard({
          slot: 'SG',
          offerId,
          cardId: `hvc-${'4'.repeat(32)}`,
          source: buildHavocSourcePlayer({
            playerId: playerIdSchema.parse('p-third'),
            positions: ['SG'],
          }),
        }),
      ],
    });
    const state = buildHavocRunState({ draft });
    const command = havocPickCardCommandSchema.parse({
      schemaVersion: HAVOC_SCHEMA_VERSION,
      commandId: 'cmd-dup-claim',
      runId: state.runId,
      expectedRevision: state.revision,
      command: 'pick-havoc-card',
      offerId,
      cardId: duplicateCard.cardId,
    });
    const outcome = ApplyHavocCommand(state, command, environment, lockSources);
    expect(outcome.result.status).toBe('rejected');
    expect(outcome.result.rejection?.code).toBe('illegal-claim');
    expect(outcome.state).toBe(state);
  });

  it('rejects picking a card that cannot play the current slot', () => {
    const offerId = `hvo-${'b'.repeat(32)}`;
    const draft = buildHavocDraftState({
      offerId,
      round: 1,
      slot: 'PG',
      cards: [
        buildHavocCard({
          slot: 'PG',
          offerId,
          cardId: `hvc-${'5'.repeat(32)}`,
          source: buildHavocSourcePlayer({
            playerId: playerIdSchema.parse('p-positionless'),
            positions: ['SG'],
          }),
        }),
        buildHavocCard({ slot: 'PG', offerId, cardId: `hvc-${'6'.repeat(32)}` }),
        buildHavocCard({ slot: 'PG', offerId, cardId: `hvc-${'7'.repeat(32)}` }),
      ],
    });
    const state = buildHavocRunState({ draft });
    const command = havocPickCardCommandSchema.parse({
      schemaVersion: HAVOC_SCHEMA_VERSION,
      commandId: 'cmd-bad-position',
      runId: state.runId,
      expectedRevision: state.revision,
      command: 'pick-havoc-card',
      offerId,
      cardId: `hvc-${'5'.repeat(32)}`,
    });
    const outcome = ApplyHavocCommand(state, command, environment, lockSources);
    expect(outcome.result.status).toBe('rejected');
    expect(outcome.result.rejection?.code).toBe('illegal-position');
  });

  it('locks the completed lineup into schema-valid frozen inputs', () => {
    const drafted = draftToCompletion(createDraftState());
    expect(drafted.draft?.status).toBe('complete');
    const shortPicks = {
      ...lockCommand(drafted),
      picks: lockCommand(drafted).picks.slice(0, HAVOC_DRAFT_ROUNDS - 1),
    };
    const belowLock = ApplyHavocCommand(drafted, shortPicks, environment, lockSources);
    expect(belowLock.result.status).toBe('rejected');
    expect(belowLock.result.rejection?.code).toBe('incomplete-lineup');
    const mismatched = ApplyHavocCommand(
      drafted,
      {
        ...lockCommand(drafted),
        picks: lockCommand(drafted).picks.map((pick, index) =>
          index === 0 ? { ...pick, cardId: `hvc-${'9'.repeat(32)}` } : pick,
        ),
      },
      environment,
      lockSources,
    );
    expect(mismatched.result.status).toBe('rejected');
    expect(mismatched.result.rejection?.code).toBe('incomplete-lineup');

    const locked = ApplyHavocCommand(drafted, lockCommand(drafted), environment, lockSources);
    expect(locked.result.status).toBe('accepted');
    expect(locked.state.phase).toBe('run');
    expect(locked.state.draft).toBeNull();
    expect(locked.state.completionState).toBe('season');
    expect(locked.state.locked).not.toBeNull();
    expect(havocLockedInputsSchema.safeParse(locked.state.locked).success).toBe(true);
    expect(locked.state.locked?.picks).toHaveLength(5);
    expect(locked.state.locked?.schedule).toHaveLength(82);
    expect(locked.state.locked?.opponents).toHaveLength(30);
    expect(locked.result.revisionAfter).toBe(drafted.revision + 1);
  });

  it('locks even before a reroll was used', () => {
    const drafted = draftToCompletion(createDraftState());
    expect(drafted.draft?.rerollUsed).toBe(false);
    const locked = ApplyHavocCommand(drafted, lockCommand(drafted), environment, lockSources);
    expect(locked.result.status).toBe('accepted');
  });

  it('raises HavocCatalogCoverageError when the catalog cannot fill the draft', () => {
    const keep = new Set([
      'p-d-lakers-1980s-0',
      'p-d-lakers-1980s-1',
      'p-d-lakers-1980s-3',
      'p-d-lakers-1980s-4',
      'p-d-lakers-1980s-7',
    ]);
    const candidates = fixture.catalog.candidates.filter((candidate) =>
      keep.has(candidate.playerId),
    );
    expect(candidates).toHaveLength(keep.size);
    const thinCatalog = AdaptHavocCatalog({ ...fixture.catalog, candidates }, fixture.source);
    expect(() =>
      CreateHavocRunState(
        buildHavocCreateCommandFixture(fixture),
        thinCatalog,
        buildHavocEnvironmentFixture(thinCatalog),
      ),
    ).toThrow(HavocCatalogCoverageError);
  });

  it('requires the adapted catalog for offer-advancing commands', () => {
    const state = createDraftState();
    const card = state.draft?.cards[0];
    if (card === undefined) throw new Error('empty offer');
    const bareEnvironment = {
      rngFactory: environment.rngFactory,
      definitions: environment.definitions,
    };
    expect(() =>
      ApplyHavocCommand(state, pickCommand(state, card.cardId), bareEnvironment, lockSources),
    ).toThrow(/catalog/);
  });
});
