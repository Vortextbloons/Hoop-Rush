import { describe, expect, it } from 'vitest';
import type {
  HavocCatalog,
  HavocDraftOffer,
  HavocMultiplayerCommandPayload,
  HavocMultiplayerDraftState,
  Position,
  SeasonDraftCandidate,
  SeasonDraftCatalog,
  Seed,
} from '@hoop-rush/data-contracts';
import {
  PLAYER_VERSION_ID_VERSION,
  POSITION_NORMALIZATION_VERSION,
  POSITIONS,
  RATINGS_VERSION,
  SEASON_DRAFT_CATALOG_VERSION,
  SEASON_DURABILITY_VERSION,
  SEASON_STAMINA_VERSION,
  canonicalJson,
  havocMultiplayerDraftStateSchema,
  havocMultiplayerGameSeed,
  playerIdSchema,
  playerVersionId,
  seasonDraftCatalogSchema,
  seasonDraftCandidateSchema,
  seasonDigestHex,
  seasonKeySchema,
  seedFromString,
  seedSchema,
} from '@hoop-rush/data-contracts';
import {
  buildHavocCard,
  buildHavocSourcePlayer,
  buildHavocVersionSet,
  buildSeasonDraftCandidate,
} from '@hoop-rush/test-fixtures';
import { AdaptHavocCatalog } from '../catalog.ts';
import {
  HAVOC_TEST_RUN_SEED,
  buildHavocCatalogFixture,
  buildHavocCatalogSource,
  buildHavocEraProfileFixture,
  buildHavocEnvironmentFixture,
} from '../havoc-test-support.ts';
import type {
  HavocMultiplayerDraftCommandPayload,
  HavocMultiplayerDraftEnvironment,
} from './draft.ts';
import {
  applyHavocMultiplayerDraftCommand,
  buildHavocMultiplayerGameInput,
  buildHavocMultiplayerTeam,
  createHavocMultiplayerDraft,
  generateHavocMultiplayerOffer,
  havocMultiplayerTimeoutPick,
  replayHavocMultiplayerDraft,
} from './draft.ts';

const fixture = buildHavocCatalogFixture();
const environment = buildHavocEnvironmentFixture(fixture.adapted);

function testSeed(value: string): Seed {
  return seedSchema.parse(seedFromString(value));
}

function customCandidate(input: {
  readonly playerId: string;
  readonly seasonKey: string;
  readonly franchiseId: string;
  readonly index: number;
  readonly playable: readonly [Position, ...Position[]];
  readonly overall: number;
}): SeasonDraftCandidate {
  const base = buildSeasonDraftCandidate({
    franchiseId: input.franchiseId,
    eraId: '1990s',
    index: input.index,
  });
  return seasonDraftCandidateSchema.parse({
    ...base,
    playerId: playerIdSchema.parse(input.playerId),
    playerVersionId: playerVersionId(input.playerId, input.franchiseId, '1990s', input.seasonKey),
    seasonKey: seasonKeySchema.parse(input.seasonKey),
    displayName: input.playerId,
    positions: {
      primary: input.playable[0],
      secondary: [],
      playable: [...input.playable],
      normalizationVersion: base.positions.normalizationVersion,
    },
    summaryRatings: {
      overallRating: input.overall,
      offenseRating: input.overall,
      defenseRating: input.overall,
    },
  });
}

function customCatalog(candidates: readonly SeasonDraftCandidate[]): SeasonDraftCatalog {
  const first = candidates[0];
  if (first === undefined) throw new Error('custom catalog requires a candidate');
  return seasonDraftCatalogSchema.parse({
    schemaVersion: 1,
    catalogVersion: SEASON_DRAFT_CATALOG_VERSION,
    dataVersion: `m10-${RATINGS_VERSION}`,
    ratingsVersion: RATINGS_VERSION,
    positionNormalizationVersion: POSITION_NORMALIZATION_VERSION,
    playerVersionIdVersion: PLAYER_VERSION_ID_VERSION,
    staminaVersion: SEASON_STAMINA_VERSION,
    durabilityVersion: SEASON_DURABILITY_VERSION,
    pools: [
      {
        franchiseId: first.franchiseId,
        eraId: first.eraId,
        playerVersionIds: candidates.map((candidate) => candidate.playerVersionId),
      },
    ],
    candidates: [...candidates],
  });
}

function adaptedFixture(catalog: SeasonDraftCatalog): {
  readonly adapted: HavocCatalog;
  readonly environment: HavocMultiplayerDraftEnvironment;
} {
  const adapted = AdaptHavocCatalog(catalog, buildHavocCatalogSource(catalog));
  return { adapted, environment: buildHavocEnvironmentFixture(adapted) };
}

function fillerCandidates(
  prefix: string,
  slots: readonly (readonly [Position, ...Position[]])[],
  baseIndex: number,
  baseOverall: number,
): SeasonDraftCandidate[] {
  return slots.map((playable, index) =>
    customCandidate({
      playerId: `${prefix}-${String(index)}`,
      seasonKey: '1995-96',
      franchiseId: index % 2 === 0 ? 'lakers' : 'celtics',
      index: baseIndex + index,
      playable,
      overall: baseOverall + index,
    }),
  );
}

const POSITION_FILLERS: readonly (readonly [Position, ...Position[]])[] = [
  ['PG'],
  ['PG'],
  ['PG'],
  ['PG'],
  ['PG'],
  ['SG'],
  ['SG'],
  ['SF'],
  ['SF'],
  ['PF'],
  ['PF'],
  ['C'],
  ['C'],
];

function personFixtureCandidates(): SeasonDraftCandidate[] {
  return [
    customCandidate({
      playerId: 'p-shared',
      seasonKey: '1995-96',
      franchiseId: 'lakers',
      index: 0,
      playable: ['PG', 'SG', 'SF', 'PF', 'C'],
      overall: 70,
    }),
    customCandidate({
      playerId: 'p-shared',
      seasonKey: '1995-96',
      franchiseId: 'celtics',
      index: 1,
      playable: ['PG', 'SG', 'SF', 'PF', 'C'],
      overall: 70,
    }),
    customCandidate({
      playerId: 'p-shared',
      seasonKey: '1996-97',
      franchiseId: 'lakers',
      index: 2,
      playable: ['PG', 'SG', 'SF', 'PF', 'C'],
      overall: 71,
    }),
    customCandidate({
      playerId: 'p-other',
      seasonKey: '1995-96',
      franchiseId: 'warriors',
      index: 3,
      playable: ['PG', 'SG', 'SF', 'PF', 'C'],
      overall: 72,
    }),
    ...fillerCandidates('p-fill', POSITION_FILLERS, 10, 60),
  ];
}

function draftablePersonFixtureCandidates(): SeasonDraftCandidate[] {
  return [...personFixtureCandidates(), ...fillerCandidates('p-more', POSITION_FILLERS, 40, 75)];
}

function lowOverallCandidates(): SeasonDraftCandidate[] {
  return [
    customCandidate({
      playerId: 'p-low',
      seasonKey: '1995-96',
      franchiseId: 'lakers',
      index: 0,
      playable: ['PG'],
      overall: 1,
    }),
    ...fillerCandidates('p-fill', POSITION_FILLERS, 10, 60),
  ];
}

type MultiplayerPickPayload = Extract<HavocMultiplayerCommandPayload, { kind: 'pick' }>;

function firstCardPayload(state: HavocMultiplayerDraftState): MultiplayerPickPayload {
  const offer = state.offer;
  if (offer === null) throw new Error('draft has no offer');
  const card = offer.cards[0];
  if (card === undefined) throw new Error('offer has no cards');
  if (card.source.seasonKey === null) throw new Error('offer card has no season');
  return {
    kind: 'pick',
    turnOrdinal: state.turnOrdinal,
    offerId: offer.offerId,
    cardId: card.cardId,
    claimKey: { playerId: card.source.playerId, seasonKey: card.source.seasonKey },
  };
}

function playFullDraft(
  rootSeed: Seed,
  catalog: HavocCatalog,
  draftEnvironment: HavocMultiplayerDraftEnvironment,
): {
  readonly state: HavocMultiplayerDraftState;
  readonly commands: HavocMultiplayerDraftCommandPayload[];
  readonly offers: HavocDraftOffer[];
} {
  let state = createHavocMultiplayerDraft(rootSeed, catalog, draftEnvironment);
  const commands: HavocMultiplayerDraftCommandPayload[] = [];
  const offers: HavocDraftOffer[] = [];
  while (state.status === 'drafting') {
    const offer = state.offer;
    if (offer === null) throw new Error('drafting state has no offer');
    offers.push(offer);
    const payload = firstCardPayload(state);
    const outcome = applyHavocMultiplayerDraftCommand(state, payload, catalog, draftEnvironment);
    expect(outcome.receipt.accepted).toBe(true);
    commands.push(payload);
    state = outcome.state;
  }
  return { state, commands, offers };
}

describe('havoc multiplayer draft', () => {
  it('creates a deterministic alternating draft with per-turn offers', () => {
    const first = createHavocMultiplayerDraft(HAVOC_TEST_RUN_SEED, fixture.adapted, environment);
    const second = createHavocMultiplayerDraft(HAVOC_TEST_RUN_SEED, fixture.adapted, environment);
    expect(canonicalJson(first)).toBe(canonicalJson(second));
    expect(first.status).toBe('drafting');
    expect(first.turnOrdinal).toBe(0);
    expect(first.revision).toBe(0);
    expect(first.activeParticipantId).toBe(first.firstPicker);
    expect(first.offer?.cards).toHaveLength(3);
    expect(first.offer?.slot).toBe('PG');
    expect(first.offer?.round).toBe(1);
    expect(new Set(first.offer?.cards.map((card) => card.source.playerId)).size).toBe(3);

    const { state, offers, commands } = playFullDraft(
      HAVOC_TEST_RUN_SEED,
      fixture.adapted,
      environment,
    );
    expect(state.status).toBe('complete');
    expect(state.turnOrdinal).toBe(10);
    expect(state.revision).toBe(10);
    expect(state.offer).toBeNull();
    expect(state.activeParticipantId).toBeNull();
    expect(state.picks).toHaveLength(10);
    expect(havocMultiplayerDraftStateSchema.safeParse(state).success).toBe(true);
    expect(commands).toHaveLength(10);
    expect(offers).toHaveLength(10);

    for (const offer of offers) {
      expect(offer.offerId).toMatch(/^hvo-[0-9a-f]{32}$/);
      expect(offer.cards).toHaveLength(3);
      expect(new Set(offer.cards.map((card) => card.source.playerId)).size).toBe(3);
      const roundIndex = Math.floor(offer.round - 1);
      expect(offer.slot).toBe(POSITIONS[roundIndex]);
      offer.cards.forEach((card, cardIndex) => {
        expect(card.cardId).toMatch(/^hvc-[0-9a-f]{32}$/);
        expect(card.offerId).toBe(offer.offerId);
        expect(card.cardIndex).toBe(cardIndex);
        expect(card.slot).toBe(offer.slot);
        expect(card.source.positions).toContain(offer.slot);
      });
    }
    expect(new Set(offers.map((offer) => offer.offerId)).size).toBe(10);

    state.picks.forEach((pick, index) => {
      const expectedPicker =
        index % 2 === 0 ? state.firstPicker : state.firstPicker === 'p1' ? 'p2' : 'p1';
      expect(pick.participantId).toBe(expectedPicker);
      expect(pick.turnOrdinal).toBe(index);
      expect(pick.slot).toBe(POSITIONS[Math.floor(index / 2)]);
    });
    for (const participantId of ['p1', 'p2'] as const) {
      const slots = state.picks
        .filter((pick) => pick.participantId === participantId)
        .map((pick) => pick.slot);
      expect(slots).toEqual(['PG', 'SG', 'SF', 'PF', 'C']);
    }
    expect(state.claimedPlayerIds).toEqual(state.picks.map((pick) => pick.claimKey.playerId));
  });

  it('rejects commands that do not match the active turn, offer, card, or phase', () => {
    const state = createHavocMultiplayerDraft(HAVOC_TEST_RUN_SEED, fixture.adapted, environment);
    const offer = state.offer;
    if (offer === null) throw new Error('draft has no offer');
    const payload = firstCardPayload(state);

    const wrongTurn = applyHavocMultiplayerDraftCommand(
      state,
      { ...payload, turnOrdinal: state.turnOrdinal + 1 },
      fixture.adapted,
      environment,
    );
    expect(wrongTurn.receipt).toEqual({
      accepted: false,
      rejectionCode: 'wrong-turn',
      revision: state.revision,
    });
    expect(wrongTurn.state).toBe(state);

    const wrongOffer = applyHavocMultiplayerDraftCommand(
      state,
      { ...payload, offerId: `hvo-${'0'.repeat(32)}` },
      fixture.adapted,
      environment,
    );
    expect(wrongOffer.receipt.rejectionCode).toBe('offer-mismatch');
    expect(wrongOffer.state).toBe(state);

    const unknownCard = applyHavocMultiplayerDraftCommand(
      state,
      { ...payload, cardId: `hvc-${'0'.repeat(32)}` },
      fixture.adapted,
      environment,
    );
    expect(unknownCard.receipt.rejectionCode).toBe('card-unavailable');
    expect(unknownCard.state).toBe(state);

    const wrongClaim = applyHavocMultiplayerDraftCommand(
      state,
      {
        ...payload,
        claimKey: {
          playerId: playerIdSchema.parse('p-unknown'),
          seasonKey: payload.claimKey.seasonKey,
        },
      },
      fixture.adapted,
      environment,
    );
    expect(wrongClaim.receipt.rejectionCode).toBe('offer-mismatch');
    expect(wrongClaim.state).toBe(state);

    const notDraftCommand = applyHavocMultiplayerDraftCommand(
      state,
      { kind: 'ready' },
      fixture.adapted,
      environment,
    );
    expect(notDraftCommand.receipt.rejectionCode).toBe('unknown-command');
    expect(notDraftCommand.state).toBe(state);

    const { state: complete } = playFullDraft(HAVOC_TEST_RUN_SEED, fixture.adapted, environment);
    const afterComplete = applyHavocMultiplayerDraftCommand(
      complete,
      { ...payload, turnOrdinal: 0, offerId: offer.offerId },
      fixture.adapted,
      environment,
    );
    expect(afterComplete.receipt.rejectionCode).toBe('invalid-phase');
    expect(afterComplete.state).toBe(complete);
  });

  it('enforces one reroll per participant and rerolls to a different offer', () => {
    const state = createHavocMultiplayerDraft(HAVOC_TEST_RUN_SEED, fixture.adapted, environment);
    const active = state.activeParticipantId;
    const offer = state.offer;
    if (active === null || offer === null) throw new Error('draft has no active offer');
    const reroll: HavocMultiplayerDraftCommandPayload = {
      kind: 'reroll',
      turnOrdinal: state.turnOrdinal,
      offerId: offer.offerId,
    };
    const rerolled = applyHavocMultiplayerDraftCommand(state, reroll, fixture.adapted, environment);
    expect(rerolled.receipt.accepted).toBe(true);
    expect(rerolled.state.revision).toBe(state.revision + 1);
    expect(rerolled.state.rerollsUsed[active]).toBe(1);
    expect(rerolled.state.offer?.offerIndex).toBe(1);
    expect(rerolled.state.offer?.cards.map((card) => card.cardId)).not.toEqual(
      offer.cards.map((card) => card.cardId),
    );
    expect(new Set(rerolled.state.offer?.cards.map((card) => card.source.playerId)).size).toBe(3);

    const second = applyHavocMultiplayerDraftCommand(
      rerolled.state,
      { ...reroll, offerId: rerolled.state.offer?.offerId ?? offer.offerId },
      fixture.adapted,
      environment,
    );
    expect(second.receipt.rejectionCode).toBe('reroll-unavailable');
    expect(second.state).toBe(rerolled.state);

    const picked = applyHavocMultiplayerDraftCommand(
      rerolled.state,
      firstCardPayload(rerolled.state),
      fixture.adapted,
      environment,
    );
    expect(picked.receipt.accepted).toBe(true);
    const nextActive = picked.state.activeParticipantId;
    const nextOffer = picked.state.offer;
    if (nextActive === null || nextOffer === null) throw new Error('next turn has no offer');
    expect(nextActive).not.toBe(active);
    const otherReroll = applyHavocMultiplayerDraftCommand(
      picked.state,
      { kind: 'reroll', turnOrdinal: picked.state.turnOrdinal, offerId: nextOffer.offerId },
      fixture.adapted,
      environment,
    );
    expect(otherReroll.receipt.accepted).toBe(true);
    expect(otherReroll.state.rerollsUsed[nextActive]).toBe(1);
    expect(otherReroll.state.rerollsUsed[active]).toBe(1);
  });

  it('replays the accepted command log to identical deterministic state', () => {
    let state = createHavocMultiplayerDraft(HAVOC_TEST_RUN_SEED, fixture.adapted, environment);
    const commands: HavocMultiplayerDraftCommandPayload[] = [];
    const offer = state.offer;
    if (offer === null) throw new Error('draft has no offer');
    const reroll: HavocMultiplayerDraftCommandPayload = {
      kind: 'reroll',
      turnOrdinal: state.turnOrdinal,
      offerId: offer.offerId,
    };
    const rerolled = applyHavocMultiplayerDraftCommand(state, reroll, fixture.adapted, environment);
    expect(rerolled.receipt.accepted).toBe(true);
    commands.push(reroll);
    state = rerolled.state;
    while (state.status === 'drafting') {
      const payload = firstCardPayload(state);
      const outcome = applyHavocMultiplayerDraftCommand(
        state,
        payload,
        fixture.adapted,
        environment,
      );
      expect(outcome.receipt.accepted).toBe(true);
      commands.push(payload);
      state = outcome.state;
    }
    const roomLog: HavocMultiplayerCommandPayload[] = [
      { kind: 'ready' },
      { kind: 'start' },
      ...commands,
    ];
    const replay = replayHavocMultiplayerDraft({
      rootSeed: HAVOC_TEST_RUN_SEED,
      catalog: fixture.adapted,
      environment,
      commands: roomLog,
    });
    const replayAgain = replayHavocMultiplayerDraft({
      rootSeed: HAVOC_TEST_RUN_SEED,
      catalog: fixture.adapted,
      environment,
      commands: roomLog,
    });
    expect(canonicalJson(replay)).toBe(canonicalJson(state));
    expect(canonicalJson(replayAgain)).toBe(canonicalJson(state));
    expect(seasonDigestHex(canonicalJson(replay))).toBe(seasonDigestHex(canonicalJson(state)));
    expect(replay.rerollsUsed).toEqual(state.rerollsUsed);
    expect(replay.rerollsUsed.p1 + replay.rerollsUsed.p2).toBe(1);
  });

  it('resolves timeout picks deterministically from the current offer', () => {
    const state = createHavocMultiplayerDraft(HAVOC_TEST_RUN_SEED, fixture.adapted, environment);
    const first = havocMultiplayerTimeoutPick(state, fixture.adapted, environment);
    const second = havocMultiplayerTimeoutPick(state, fixture.adapted, environment);
    expect(first).toEqual(second);
    expect(state.offer?.cards.some((card) => card.cardId === first.cardId)).toBe(true);

    const payload: HavocMultiplayerDraftCommandPayload = {
      kind: 'timeout-pick',
      turnOrdinal: state.turnOrdinal,
      offerId: state.offer?.offerId ?? '',
      cardId: first.cardId,
    };
    const outcome = applyHavocMultiplayerDraftCommand(state, payload, fixture.adapted, environment);
    expect(outcome.receipt.accepted).toBe(true);
    expect(outcome.state.turnOrdinal).toBe(state.turnOrdinal + 1);
    expect(outcome.state.picks[0]?.card.cardId).toBe(first.cardId);
    expect(outcome.state.claimedPlayerIds).toContain(first.source.playerId);
  });

  it('excludes every season of a drafted person globally', () => {
    const { adapted, environment: customEnvironment } = adaptedFixture(
      customCatalog(personFixtureCandidates()),
    );
    let sawSharedUnclaimed = false;
    for (let index = 0; index < 120; index += 1) {
      const offer = generateHavocMultiplayerOffer(
        {
          catalog: adapted,
          rootSeed: testSeed(`havoc-mp-exclusion-${String(index)}`),
          participantId: 'p1',
          turnOrdinal: 0,
          offerIndex: 0,
          claimedPlayerIds: ['p-shared'],
          picks: [],
        },
        customEnvironment,
      );
      expect(offer.cards).toHaveLength(3);
      for (const card of offer.cards) {
        expect(card.source.playerId).not.toBe('p-shared');
      }
      const unclaimed = generateHavocMultiplayerOffer(
        {
          catalog: adapted,
          rootSeed: testSeed(`havoc-mp-exclusion-${String(index)}`),
          participantId: 'p1',
          turnOrdinal: 0,
          offerIndex: 0,
          claimedPlayerIds: [],
          picks: [],
        },
        customEnvironment,
      );
      if (unclaimed.cards.some((card) => card.source.playerId === 'p-shared')) {
        sawSharedUnclaimed = true;
      }
    }
    expect(sawSharedUnclaimed).toBe(true);

    const draftable = adaptedFixture(customCatalog(draftablePersonFixtureCandidates()));
    let found: { seed: Seed; state: HavocMultiplayerDraftState } | null = null;
    for (let index = 0; index < 80 && found === null; index += 1) {
      const seed = testSeed(`havoc-mp-drafted-person-${String(index)}`);
      const state = createHavocMultiplayerDraft(seed, draftable.adapted, draftable.environment);
      if (state.offer?.cards.some((card) => card.source.playerId === 'p-shared')) {
        found = { seed, state };
      }
    }
    expect(found).not.toBeNull();
    if (found === null) return;
    const card = found.state.offer?.cards.find(
      (candidate) => candidate.source.playerId === 'p-shared',
    );
    if (card === undefined || card.source.seasonKey === null)
      throw new Error('missing shared card');
    let state = found.state;
    const picked = applyHavocMultiplayerDraftCommand(
      state,
      {
        kind: 'pick',
        turnOrdinal: state.turnOrdinal,
        offerId: state.offer?.offerId ?? '',
        cardId: card.cardId,
        claimKey: { playerId: card.source.playerId, seasonKey: card.source.seasonKey },
      },
      draftable.adapted,
      draftable.environment,
    );
    expect(picked.receipt.accepted).toBe(true);
    state = picked.state;
    while (state.status === 'drafting') {
      const offer = state.offer;
      if (offer === null) throw new Error('drafting state has no offer');
      for (const candidate of offer.cards) {
        expect(candidate.source.playerId).not.toBe('p-shared');
      }
      const outcome = applyHavocMultiplayerDraftCommand(
        state,
        firstCardPayload(state),
        draftable.adapted,
        draftable.environment,
      );
      expect(outcome.receipt.accepted).toBe(true);
      state = outcome.state;
    }
    expect(state.claimedPlayerIds).toContain('p-shared');
  });

  it('groups traded variants of one person-season as a single sampling unit', () => {
    const { adapted, environment: customEnvironment } = adaptedFixture(
      customCatalog(personFixtureCandidates()),
    );
    const variants = new Set<string>();
    let sawOtherSeason = false;
    for (let index = 0; index < 200; index += 1) {
      const offer = generateHavocMultiplayerOffer(
        {
          catalog: adapted,
          rootSeed: testSeed(`havoc-mp-variants-${String(index)}`),
          participantId: 'p1',
          turnOrdinal: 0,
          offerIndex: 0,
          claimedPlayerIds: [],
          picks: [],
        },
        customEnvironment,
      );
      const shared = offer.cards.filter((card) => card.source.playerId === 'p-shared');
      expect(shared.length).toBeLessThanOrEqual(1);
      for (const card of shared) {
        if (card.source.seasonKey === '1995-96') {
          variants.add(card.source.playerVersionId ?? '');
        }
        if (card.source.seasonKey === '1996-97') sawOtherSeason = true;
      }
    }
    expect(sawOtherSeason).toBe(true);
    expect(variants.size).toBe(2);
    for (const variant of variants) expect(variant).toMatch(/^pv-/);
  });

  it('samples the full eligible pool without rating bands', () => {
    const { adapted, environment: customEnvironment } = adaptedFixture(
      customCatalog(lowOverallCandidates()),
    );
    let found: HavocDraftOffer | null = null;
    for (let index = 0; index < 60 && found === null; index += 1) {
      const offer = generateHavocMultiplayerOffer(
        {
          catalog: adapted,
          rootSeed: testSeed(`havoc-mp-full-pool-${String(index)}`),
          participantId: 'p1',
          turnOrdinal: 0,
          offerIndex: 0,
          claimedPlayerIds: [],
          picks: [],
        },
        customEnvironment,
      );
      if (offer.cards.some((card) => card.source.playerId === 'p-low')) found = offer;
    }
    expect(found).not.toBeNull();
    if (found === null) return;
    const overalls = found.cards.map((card) => card.source.originalOverall);
    expect(Math.max(...overalls) - Math.min(...overalls)).toBeGreaterThan(3);
    const low = found.cards.find((card) => card.source.playerId === 'p-low');
    expect(low?.slot).toBe('PG');
    expect(low?.source.positions).toContain('PG');
  });

  it('completes ten picks with valid slot coverage across seeds', () => {
    for (const seedString of [
      'havoc-mp-feasibility-0',
      'havoc-mp-feasibility-1',
      'havoc-mp-feasibility-2',
    ]) {
      const { state } = playFullDraft(testSeed(seedString), fixture.adapted, environment);
      expect(state.status).toBe('complete');
      expect(state.picks).toHaveLength(10);
      for (const participantId of ['p1', 'p2'] as const) {
        const slots = state.picks
          .filter((pick) => pick.participantId === participantId)
          .map((pick) => pick.slot);
        expect(slots).toEqual(['PG', 'SG', 'SF', 'PF', 'C']);
      }
    }
  });

  it('builds deterministic battle teams and a labeled battle game input', () => {
    const { state } = playFullDraft(HAVOC_TEST_RUN_SEED, fixture.adapted, environment);
    const p1a = buildHavocMultiplayerTeam({
      participantId: 'p1',
      side: 'home',
      teamId: 'havoc-mp-p1',
      displayName: 'Player One',
      picks: state.picks,
      rootSeed: HAVOC_TEST_RUN_SEED,
    });
    const p1b = buildHavocMultiplayerTeam({
      participantId: 'p1',
      side: 'home',
      teamId: 'havoc-mp-p1',
      displayName: 'Player One',
      picks: state.picks,
      rootSeed: HAVOC_TEST_RUN_SEED,
    });
    expect(canonicalJson(p1a)).toBe(canonicalJson(p1b));
    const p2 = buildHavocMultiplayerTeam({
      participantId: 'p2',
      side: 'away',
      teamId: 'havoc-mp-p2',
      displayName: 'Player Two',
      picks: state.picks,
      rootSeed: HAVOC_TEST_RUN_SEED,
    });
    const allStarters = [...p1a.starters, ...p2.starters];
    expect(new Set(allStarters.map((starter) => starter.instanceId)).size).toBe(10);

    const p1Picks = state.picks.filter((pick) => pick.participantId === 'p1');
    p1a.starters.forEach((starter, index) => {
      const pick = p1Picks[index];
      if (pick === undefined) throw new Error('missing p1 pick');
      expect(starter.slot).toBe(POSITIONS[index]);
      expect(starter.kind).toBe('starter');
      expect(starter.ownerInstanceId).toBeNull();
      expect(starter.source.playerId).toBe(pick.card.source.playerId);
      expect(starter.mutationPackage).toEqual(pick.card.mutations);
      expect(starter.effective).toEqual(pick.card.effective);
    });
    p1a.replacements.forEach((replacement) => {
      const starter = p1a.starters.find((entry) => entry.slot === replacement.slot);
      expect(replacement.kind).toBe('replacement');
      expect(replacement.mutationPackage).toEqual([]);
      expect(replacement.ownerInstanceId).toBe(starter?.instanceId);
      expect(replacement.source.playerId).toBe(starter?.source.playerId);
    });

    const input = buildHavocMultiplayerGameInput({
      rootSeed: HAVOC_TEST_RUN_SEED,
      gameNumber: 1,
      homeTeam: p1a,
      awayTeam: p2,
      profile: buildHavocEraProfileFixture(),
      versionSet: buildHavocVersionSet(),
    });
    const inputAgain = buildHavocMultiplayerGameInput({
      rootSeed: HAVOC_TEST_RUN_SEED,
      gameNumber: 1,
      homeTeam: p1a,
      awayTeam: p2,
      profile: buildHavocEraProfileFixture(),
      versionSet: buildHavocVersionSet(),
    });
    expect(canonicalJson(input)).toBe(canonicalJson(inputAgain));
    expect(input.variant).toBe('havoc');
    expect(input.seed).toBe(havocMultiplayerGameSeed(HAVOC_TEST_RUN_SEED, 1));
    expect(input.home.side).toBe('home');
    expect(input.away.side).toBe('away');
    expect(input.home.teamId).toBe('havoc-mp-p1');
    expect(input.away.teamId).toBe('havoc-mp-p2');
  });

  it('builds clone participants for clone-army picks with deterministic ids', () => {
    const syntheticPicks = (participantId: 'p1' | 'p2') =>
      POSITIONS.map((slot, slotIndex) => {
        const card = buildHavocCard({
          cardId: `hvc-${(slotIndex + (participantId === 'p1' ? 1 : 6)).toString(16).padStart(32, '0')}`,
          slot,
          source: buildHavocSourcePlayer({
            playerId: playerIdSchema.parse(`p-clone-${participantId}-${slot.toLowerCase()}`),
            positions: [slot],
          }),
          mutations:
            slotIndex === 0
              ? [{ mutationId: 'clone-army' }]
              : [{ mutationId: 'growth-spurt', sampledHeightDelta: 8 }],
        });
        return {
          turnOrdinal: slotIndex * 2 + (participantId === 'p1' ? 0 : 1),
          participantId,
          slot,
          claimKey: {
            playerId: card.source.playerId,
            seasonKey: card.source.seasonKey ?? seasonKeySchema.parse('1996-97'),
          },
          card,
        };
      });
    const picks = [...syntheticPicks('p1'), ...syntheticPicks('p2')];
    const team = buildHavocMultiplayerTeam({
      participantId: 'p1',
      side: 'home',
      teamId: 'havoc-mp-clones',
      displayName: 'Clone Squad',
      picks,
      rootSeed: HAVOC_TEST_RUN_SEED,
    });
    expect(team.clones).toHaveLength(1);
    const clone = team.clones[0];
    const starter = team.starters[0];
    expect(clone?.kind).toBe('clone');
    expect(clone?.slot).toBe('PG');
    expect(clone?.ownerInstanceId).toBe(starter?.instanceId);
    expect(clone?.mutationPackage).toEqual([]);
    expect(clone?.effective).toEqual(starter?.effective);
    expect(clone?.source.playerId).toBe(starter?.source.playerId);

    const rebuilt = buildHavocMultiplayerTeam({
      participantId: 'p1',
      side: 'home',
      teamId: 'havoc-mp-clones',
      displayName: 'Clone Squad',
      picks,
      rootSeed: HAVOC_TEST_RUN_SEED,
    });
    expect(canonicalJson(rebuilt)).toBe(canonicalJson(team));
  });
});
