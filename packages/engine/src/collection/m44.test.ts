import { describe, expect, it } from 'vitest';
import {
  COLLECTION_CHALLENGE_VERSION,
  COLLECTION_COMMAND_VERSION,
  COLLECTION_GAME_COMMAND_VERSION,
  COLLECTION_SCHEMA_VERSION,
  COLLECTION_STATE_SCHEMA_VERSION,
  COLLECTION_TARGETING_VERSION,
  collectionCommandSchema,
  collectionGameCommandSchema,
  collectionPreparedGameV3Schema,
  type CollectionActiveTeam,
  type CollectionCatalog,
  type CollectionCatalogCard,
  type CollectionChallengeDefinition,
  type CollectionCommand,
  type CollectionDifficultyId,
  type CollectionGameCommand,
  type CollectionGameResultV3,
  type CollectionProgressionRules,
  type CollectionPullRecordV2,
  type CollectionState,
  type CollectionTargetSnapshot,
  type EraId,
} from '@hoop-rush/data-contracts';
import {
  DEFAULT_ERA_SIM_PROFILE,
  buildCollectionDifficultyProfiles,
  buildCollectionFixtureCard,
  buildCollectionFixtureCatalog,
  buildCollectionGameRulesFixture,
  buildCollectionProgressionFixture,
} from '@hoop-rush/test-fixtures';
import {
  allocateDefaultMinutes,
  applyCollectionCommand,
  applyCollectionGameCommand,
  checkCollectionChallengeFeasibility,
  collectionObjectiveDefinitionsFromRules,
  collectionPlayStateDigest,
  collectionPlayStateFactsOf,
  collectionStateDigest,
  collectionStateFactsOf,
  describeCollectionTargetOdds,
  drawCollectionPackSlots,
  drawCollectionPackSlotsTargeted,
  initializeCollectionState,
  prepareCollectionChallengeGame,
  reproduceCollectionPull,
  simulateCollectionGame,
  validateCollectionChallengeTeam,
  validateCollectionProgressionRules,
} from '../index.ts';

const HASH = 'b'.repeat(64);
const POSITIONS: CollectionCatalogCard['positions'][] = [['PG'], ['SG'], ['SF'], ['PF'], ['C']];
const RARITIES: CollectionCatalogCard['rarity'][] = [
  'Ember',
  'Eruption',
  'Apex',
  'Titan',
  'Eclipse',
  'Immortal',
];

function buildCatalog(): CollectionCatalog {
  const cards: CollectionCatalogCard[] = [];
  for (let index = 0; index < 30; index += 1) {
    const playerId = `m44-${String(index).padStart(3, '0')}`;
    cards.push(
      buildCollectionFixtureCard(playerId, {
        playerId: playerId as CollectionCatalogCard['playerId'],
        positions: POSITIONS[index % POSITIONS.length] ?? ['PG'],
        rarity: RARITIES[index % RARITIES.length] ?? 'Ember',
        eraId: (index % 2 === 0 ? '1990s' : '2000s') as CollectionCatalogCard['eraId'],
        franchiseId: (index % 3 === 0
          ? 'lakers'
          : index % 3 === 1
            ? 'celtics'
            : 'bulls') as CollectionCatalogCard['franchiseId'],
        summarySource: {
          overallRating: 60 + (index % 12),
          offenseRating: 60 + (index % 12),
          defenseRating: 60,
        },
      }),
    );
  }
  const targetVersions = [
    buildCollectionFixtureCard('m44-target', {
      playerId: 'm44-target' as CollectionCatalogCard['playerId'],
      cardId: `card-${'1'.repeat(32)}`,
      rarity: 'Apex',
      positions: ['SF'],
    }),
    buildCollectionFixtureCard('m44-target', {
      playerId: 'm44-target' as CollectionCatalogCard['playerId'],
      cardId: `card-${'2'.repeat(32)}`,
      rarity: 'Eruption',
      positions: ['PF'],
    }),
  ];
  return buildCollectionFixtureCatalog({
    cards: [...cards, ...targetVersions],
    sets: [
      {
        setId: 'heat-check-set',
        title: 'Heat Checks',
        memberCardIds: [cards[0]?.cardId as string, cards[1]?.cardId as string],
      },
    ],
  });
}

const CATALOG = buildCatalog();
const PROGRESSION = buildCollectionProgressionFixture({ catalog: CATALOG });
const RULES = buildCollectionGameRulesFixture();
const DIFFICULTIES = buildCollectionDifficultyProfiles();
const OBJECTIVES = collectionObjectiveDefinitionsFromRules(RULES);

function ownedIds(): Set<string> {
  return new Set(CATALOG.cards.map((card) => card.cardId));
}

function teamFrom(starters: string[], bench: string[]): CollectionActiveTeam {
  const roster = [...starters, ...bench];
  const starterSet = new Set(starters);
  return {
    teamVersion: 'collection-team-v1',
    starters,
    bench,
    targetMinutes: allocateDefaultMinutes(
      roster.map((cardId) => ({ cardId, starter: starterSet.has(cardId) })),
    ),
  };
}

function baseTeam(): CollectionActiveTeam {
  const [pg, sg, sf, pf, c, extra] = CATALOG.cards;
  if (
    pg === undefined ||
    sg === undefined ||
    sf === undefined ||
    pf === undefined ||
    c === undefined ||
    extra === undefined
  ) {
    throw new Error('fixture catalog too small');
  }
  return teamFrom([pg.cardId, sg.cardId, sf.cardId, pf.cardId, c.cardId], [extra.cardId]);
}

function collectionState(): CollectionState {
  return initializeCollectionState({
    collectionId: 'collection-m44',
    rootSeed: '0'.repeat(32),
    progressionHash: HASH,
  });
}

function commandFor(
  state: CollectionState,
  command: CollectionCommand['command'],
  payload: Record<string, unknown>,
  commandId: string,
): CollectionCommand {
  return collectionCommandSchema.parse({
    schemaVersion: COLLECTION_STATE_SCHEMA_VERSION,
    commandVersion: COLLECTION_COMMAND_VERSION,
    commandId,
    collectionId: state.collectionId,
    expectedRevision: state.revision,
    expectedDigest: state.digest,
    command,
    ...payload,
  });
}

function challengeDefinitions(): CollectionChallengeDefinition[] {
  return PROGRESSION.challenges;
}

function franchiseChallenge(): CollectionChallengeDefinition {
  return challengeDefinitions().find(
    (entry) => entry.requirement.kind === 'franchise-core',
  ) as CollectionChallengeDefinition;
}

const EMPTY_WEIGHTS = {
  Ember: 1,
  Eruption: 1,
  Apex: 1,
  Titan: 1,
  Eclipse: 1,
  Immortal: 1,
};

function challengeInput() {
  return {
    collectionId: 'collection-m44',
    rootSeed: '0'.repeat(32),
    gameSequence: 0,
    ownedCardIds: ownedIds(),
    team: baseTeam(),
    catalog: CATALOG,
    difficultyProfiles: DIFFICULTIES,
    objectiveDefinitions: OBJECTIVES,
    selectedObjectiveId: null,
    clearedDifficultyIds: [] as CollectionDifficultyId[],
    clearedChallengeIds: [] as string[],
    progression: PROGRESSION,
    progressionHash: HASH,
    profileVersion: DEFAULT_ERA_SIM_PROFILE.profileVersion,
    profileHash: HASH,
    catalogHash: HASH,
    rulesHash: HASH,
  };
}

function playStateFor(state: CollectionState) {
  const play = {
    saveVersion: 3 as const,
    schemaVersion: COLLECTION_SCHEMA_VERSION as 1,
    teamVersion: 'collection-team-v1' as const,
    gameVersion: 'collection-game-v3' as const,
    collectionId: state.collectionId,
    activeTeam: baseTeam(),
    revision: 0,
    digest: '0'.repeat(32),
    nextGameSequence: 0,
    pendingGame: null,
    clearedDifficultyIds: [],
    clearedChallengeIds: [],
  };
  return { ...play, digest: collectionPlayStateDigest(collectionPlayStateFactsOf(play)) };
}

describe('M4.4 challenge validation', () => {
  it('passes every launch-shaped fixture challenge on a legal committed team', () => {
    const team = baseTeam();
    for (const definition of challengeDefinitions()) {
      const check = validateCollectionChallengeTeam({
        definition,
        team,
        catalog: CATALOG,
        ownedCardIds: ownedIds(),
      });
      expect(check.facts.success, definition.challengeId).toBe(true);
      expect(check.facts.teamValid).toBe(true);
      expect(check.facts.failureCode).toBeNull();
    }
  });

  it('fails the family challenge when the set member is benched', () => {
    const [pg, sg, sf, pf, c, extra, sixth] = CATALOG.cards;
    if (
      pg === undefined ||
      sg === undefined ||
      sf === undefined ||
      pf === undefined ||
      c === undefined ||
      extra === undefined ||
      sixth === undefined
    ) {
      throw new Error('fixture catalog too small');
    }
    const definition = challengeDefinitions().find(
      (entry) => entry.requirement.kind === 'set-family-core',
    ) as CollectionChallengeDefinition;
    const team = teamFrom(
      [extra.cardId, sixth.cardId, sf.cardId, pf.cardId, c.cardId],
      [pg.cardId, sg.cardId],
    );
    const check = validateCollectionChallengeTeam({
      definition,
      team,
      catalog: CATALOG,
      ownedCardIds: ownedIds(),
    });
    expect(check.facts.success).toBe(false);
    expect(check.facts.failureCode).toBe('challenge-roster-requirement');
    expect(check.facts.starterCount).toBe(0);
  });

  it('rejects a challenge that cannot be fielded from the pinned catalog', () => {
    const impossible: CollectionChallengeDefinition = {
      challengeVersion: COLLECTION_CHALLENGE_VERSION,
      challengeId: 'challenge-impossible-v1' as CollectionChallengeDefinition['challengeId'],
      displayName: 'Impossible',
      description: 'Needs eight 1960s starters',
      requirement: {
        kind: 'era-core',
        eraId: '1960s' as EraId,
        minimumRosterCount: 8,
        minimumStarterCount: 5,
      },
      difficultyId: 'pro',
      firstClearCoins: 100,
      repeatWinCoins: 10,
    };
    const feasibility = checkCollectionChallengeFeasibility(impossible, CATALOG);
    expect(feasibility.ok).toBe(false);
    expect(feasibility.failures.length).toBeGreaterThan(0);
  });

  it('keeps matching facts canonical regardless of roster order', () => {
    const definition = challengeDefinitions()[0] as CollectionChallengeDefinition;
    const first = validateCollectionChallengeTeam({
      definition,
      team: baseTeam(),
      catalog: CATALOG,
      ownedCardIds: ownedIds(),
    });
    const second = validateCollectionChallengeTeam({
      definition,
      team: baseTeam(),
      catalog: CATALOG,
      ownedCardIds: ownedIds(),
    });
    expect(first.facts.matchingCardIds).toEqual(second.facts.matchingCardIds);
    expect(first.facts.matchingStarterIds).toEqual(second.facts.matchingStarterIds);
  });
});

describe('M4.4 targeting odds and draws', () => {
  const pack = CATALOG.packs[0];
  if (pack === undefined) throw new Error('fixture pack missing');

  it('shows higher odds for an eligible target and zero for an ineligible one', () => {
    const odds = describeCollectionTargetOdds({
      catalog: CATALOG,
      pack,
      targetPlayerId: 'm44-target',
      multiplierBp: PROGRESSION.targetMultiplierBp,
    });
    expect(odds.eligibleCardIds.length).toBe(2);
    expect(odds.atLeastOneTarget).toBeGreaterThan(0);
    expect(odds.atLeastOneTarget).toBeLessThan(1);
    const untargeted = describeCollectionTargetOdds({
      catalog: CATALOG,
      pack,
      targetPlayerId: null,
      multiplierBp: PROGRESSION.targetMultiplierBp,
    });
    expect(untargeted.atLeastOneTarget).toBe(0);
    expect(untargeted.eligibleCardIds).toEqual([]);
  });

  it('keeps rarity draws identical with and without a target', () => {
    const legacy = drawCollectionPackSlots(CATALOG, pack, '0'.repeat(32), 0);
    const targeted = drawCollectionPackSlotsTargeted({
      catalog: CATALOG,
      pack,
      rootSeed: '0'.repeat(32),
      pullSequence: 0,
      target: {
        targetingVersion: COLLECTION_TARGETING_VERSION,
        targetPlayerId: 'm44-target' as CollectionTargetSnapshot['targetPlayerId'],
        multiplierBp: PROGRESSION.targetMultiplierBp,
        packId: pack.packId,
        packRulesVersion: pack.packRulesVersion,
        eligibleByRarity: [
          { rarity: 'Ember', cardIds: [] },
          { rarity: 'Eruption', cardIds: [`card-${'2'.repeat(32)}`] },
          { rarity: 'Apex', cardIds: [`card-${'1'.repeat(32)}`] },
          { rarity: 'Titan', cardIds: [] },
          { rarity: 'Eclipse', cardIds: [] },
          { rarity: 'Immortal', cardIds: [] },
        ],
        eligibleCardCount: 2,
        seedPath: ['collection', 'targeting', pack.packId, pack.packRulesVersion, '0'],
      },
    });
    expect(targeted.map((draw) => draw.rarity)).toEqual(legacy.draws.map((draw) => draw.rarity));
  });

  it('records a targeted pull that reproduces from its snapshot', () => {
    const state = collectionState();
    const welcomeCommand = commandFor(
      state,
      'claim-welcome',
      { acquiredAtIso: '2026-01-01T00:00:00.000Z' },
      'cmd-1',
    );
    const welcome = applyCollectionCommand(
      state,
      welcomeCommand,
      CATALOG,
      [],
      [],
      [],
      HASH,
      PROGRESSION,
      HASH,
    );
    expect(welcome.status).toBe('accepted');
    if (welcome.status !== 'accepted') return;
    const targetCommand = commandFor(
      welcome.state,
      'set-target-player',
      { playerId: 'm44-target' },
      'cmd-2',
    );
    const target = applyCollectionCommand(
      welcome.state,
      targetCommand,
      CATALOG,
      [],
      [],
      [welcomeCommand],
      HASH,
      PROGRESSION,
      HASH,
    );
    expect(target.status).toBe('accepted');
    if (target.status !== 'accepted') return;
    const purchaseCommand = commandFor(
      target.state,
      'open-pack',
      { packId: 'tip-off', acquiredAtIso: '2026-01-01T00:00:00.000Z' },
      'cmd-3',
    );
    const purchase = applyCollectionCommand(
      target.state,
      purchaseCommand,
      CATALOG,
      [],
      [],
      [welcomeCommand, targetCommand],
      HASH,
      PROGRESSION,
      HASH,
    );
    expect(purchase.status).toBe('accepted');
    if (purchase.status !== 'accepted' || purchase.pull === null) return;
    const purchasePull = purchase.pull as CollectionPullRecordV2;
    expect(purchasePull.replayVersion).toBe('collection-replay-v2');
    expect(purchasePull.targeting?.targetPlayerId).toBe('m44-target');
    const reproduced = reproduceCollectionPull(CATALOG, purchase.pull, state.rootSeed);
    expect(reproduced.failures).toEqual([]);
    expect(reproduced.ok).toBe(true);
  });

  it('rejects an unknown target and an unchanged target', () => {
    const state = collectionState();
    const unknown = applyCollectionCommand(
      state,
      commandFor(state, 'set-target-player', { playerId: 'm44-missing' }, 'cmd-unknown'),
      CATALOG,
      [],
      [],
      [],
      HASH,
      PROGRESSION,
      HASH,
    );
    expect(unknown.status).toBe('rejected');
    if (unknown.status === 'rejected') {
      expect(unknown.rejection.code).toBe('unknown-target-player');
    }
    const cleared = applyCollectionCommand(
      state,
      commandFor(state, 'set-target-player', { playerId: null }, 'cmd-clear'),
      CATALOG,
      [],
      [],
      [],
      HASH,
      PROGRESSION,
      HASH,
    );
    expect(cleared.status).toBe('rejected');
    if (cleared.status === 'rejected') {
      expect(cleared.rejection.code).toBe('target-unchanged');
    }
  });
});

describe('M4.4 set rewards', () => {
  it('claims a completed set exactly once without consuming cards', () => {
    const set = CATALOG.sets[0];
    if (set === undefined) throw new Error('fixture set missing');
    const state: CollectionState = (() => {
      const base = collectionState();
      const withOwned: CollectionState = {
        ...base,
        owned: set.memberCardIds.map((cardId, index) => ({
          cardId,
          acquiredPullSequence: 0,
          acquiredSlotIndex: index,
          acquiredAtIso: '2026-01-01T00:00:00.000Z',
        })),
      };
      return {
        ...withOwned,
        digest: collectionStateDigest(collectionStateFactsOf(withOwned)),
      };
    })();
    const claimCommand = commandFor(
      state,
      'claim-set-reward',
      { setId: set.setId, claimedAtIso: '2026-01-01T00:00:00.000Z' },
      'cmd-claim',
    );
    const claim = applyCollectionCommand(
      state,
      claimCommand,
      CATALOG,
      [],
      [],
      [],
      HASH,
      PROGRESSION,
      HASH,
    );
    expect(claim.status).toBe('accepted');
    if (claim.status !== 'accepted') return;
    expect(claim.ledgerEntries).toHaveLength(1);
    expect(claim.ledgerEntries[0]?.reason).toBe('set-completion-reward');
    expect(claim.ledgerEntries[0]?.currency).toBe('Exchange');
    expect(claim.state.balances.Exchange).toBe(2000);
    expect(claim.state.claimedSetIds).toEqual([set.setId]);
    expect(claim.state.owned.map((entry) => entry.cardId)).toEqual(
      state.owned.map((entry) => entry.cardId),
    );
    expect(claim.setReceipt?.amount).toBe(2000);
    const repeat = applyCollectionCommand(
      claim.state,
      commandFor(
        claim.state,
        'claim-set-reward',
        { setId: set.setId, claimedAtIso: '2026-01-01T00:00:00.000Z' },
        'cmd-claim-2',
      ),
      CATALOG,
      [],
      claim.ledgerEntries,
      [claimCommand],
      HASH,
      PROGRESSION,
      HASH,
    );
    expect(repeat.status).toBe('rejected');
    if (repeat.status === 'rejected') {
      expect(repeat.rejection.code).toBe('set-already-claimed');
    }
  });

  it('rejects an incomplete set with the missing cards', () => {
    const set = CATALOG.sets[0];
    if (set === undefined) throw new Error('fixture set missing');
    const state = collectionState();
    const claim = applyCollectionCommand(
      state,
      commandFor(
        state,
        'claim-set-reward',
        { setId: set.setId, claimedAtIso: '2026-01-01T00:00:00.000Z' },
        'cmd-claim-incomplete',
      ),
      CATALOG,
      [],
      [],
      [],
      HASH,
      PROGRESSION,
      HASH,
    );
    expect(claim.status).toBe('rejected');
    if (claim.status === 'rejected') {
      expect(claim.rejection.code).toBe('set-incomplete');
      expect(claim.rejection.missingCardIds).toEqual([...set.memberCardIds].sort());
    }
  });

  it('validates the pinned progression artifact and rejects tampering', () => {
    expect(() => {
      validateCollectionProgressionRules({
        progression: PROGRESSION,
        progressionHash: HASH,
        catalog: CATALOG,
        verifyFeasibility: true,
      });
    }).not.toThrow();
    const tampered: CollectionProgressionRules = {
      ...PROGRESSION,
      targetMultiplierBp: 90_000,
    };
    expect(() => {
      validateCollectionProgressionRules({
        progression: tampered,
        progressionHash: HASH,
        catalog: CATALOG,
      });
    }).toThrow();
  });
});

describe('M4.4 challenge games', () => {
  it('prepares a challenge game with snapshotted facts and fixed difficulty', () => {
    const definition = franchiseChallenge();
    const prepared = prepareCollectionChallengeGame({
      ...challengeInput(),
      challengeId: definition.challengeId,
    });
    expect(prepared.gameVersion).toBe('collection-game-v3');
    expect(prepared.challenge.challengeId).toBe(definition.challengeId);
    expect(prepared.challenge.difficultyId).toBe('pro');
    expect(prepared.difficulty.difficultyId).toBe('pro');
    expect(prepared.challenge.firstClearEligible).toBe(true);
    expect(prepared.challenge.validation.success).toBe(true);
    expect(collectionPreparedGameV3Schema.safeParse(prepared).success).toBe(true);
  });

  it('rejects semantically invalid progression rules before preparing a challenge', () => {
    const tampered: CollectionProgressionRules = {
      ...PROGRESSION,
      targetMultiplierBp: PROGRESSION.targetMultiplierBp + 1,
    };
    expect(() =>
      prepareCollectionChallengeGame({
        ...challengeInput(),
        progression: tampered,
        challengeId: franchiseChallenge().challengeId,
      }),
    ).toThrow();
  });

  it('keeps challenge CPU and game seeds independent of the challenge id', () => {
    const first = prepareCollectionChallengeGame({
      ...challengeInput(),
      gameSequence: 3,
      challengeId: 'challenge-fixture-era-v1',
    });
    const second = prepareCollectionChallengeGame({
      ...challengeInput(),
      gameSequence: 3,
      challengeId: 'challenge-fixture-franchise-v1',
    });
    expect(first.seed).toBe(second.seed);
    expect(first.cpuTeam.starters).toEqual(second.cpuTeam.starters);
    expect(first.cpuTeam.bench).toEqual(second.cpuTeam.bench);
    expect(first.inputDigest).not.toBe(second.inputDigest);
  });

  it('grants a first clear then only a repeat win', () => {
    const definition = franchiseChallenge();
    const collection = collectionState();
    const play = playStateFor(collection);
    const commandInput = {
      catalog: CATALOG,
      ownedCardIds: ownedIds(),
      rootSeed: collection.rootSeed,
      cpuWeights: EMPTY_WEIGHTS,
      difficultyProfiles: DIFFICULTIES,
      objectiveDefinitions: OBJECTIVES,
      profile: DEFAULT_ERA_SIM_PROFILE,
      profileHash: HASH,
      catalogHash: HASH,
      rulesHash: HASH,
      balances: { Coins: 5000, Exchange: 0 },
      priorCommands: [] as CollectionGameCommand[],
      progression: PROGRESSION,
      progressionHash: HASH,
    };
    const prepareCommand: CollectionGameCommand = collectionGameCommandSchema.parse({
      schemaVersion: COLLECTION_SCHEMA_VERSION,
      commandVersion: COLLECTION_GAME_COMMAND_VERSION,
      commandId: 'game-cmd-prepare-1',
      collectionId: collection.collectionId,
      expectedRevision: play.revision,
      expectedDigest: play.digest,
      command: 'prepare-challenge-game',
      challengeId: definition.challengeId,
      objectiveId: null,
    });
    const preparedResult = applyCollectionGameCommand(play, prepareCommand, commandInput);
    expect(preparedResult.status).toBe('accepted');
    if (preparedResult.status !== 'accepted') return;
    const pending = preparedResult.playState.pendingGame;
    if (pending === null) throw new Error('no pending game');
    expect(pending.gameVersion).toBe('collection-game-v3');
    if (pending.gameVersion !== 'collection-game-v3') return;
    const simulated = simulateCollectionGame(pending, CATALOG, DEFAULT_ERA_SIM_PROFILE);
    const result = simulated.result as CollectionGameResultV3;
    const acceptCommand: CollectionGameCommand = collectionGameCommandSchema.parse({
      schemaVersion: COLLECTION_SCHEMA_VERSION,
      commandVersion: COLLECTION_GAME_COMMAND_VERSION,
      commandId: 'game-cmd-accept-1',
      collectionId: collection.collectionId,
      expectedRevision: preparedResult.playState.revision,
      expectedDigest: preparedResult.playState.digest,
      command: 'accept-challenge-game-result',
      gameId: pending.gameId,
      result,
      events: simulated.events,
      completedAtIso: '2026-01-01T00:00:00.000Z',
    });
    const accepted = applyCollectionGameCommand(preparedResult.playState, acceptCommand, {
      ...commandInput,
      priorCommands: [prepareCommand],
    });
    expect(accepted.status).toBe('accepted');
    if (accepted.status !== 'accepted') return;
    expect(accepted.record?.gameVersion).toBe('collection-game-v3');
    const playerWin = result.winner === 'home' && result.outcome === 'completed';
    const challengeEntries = (accepted.ledgerEntries ?? []).filter(
      (entry) =>
        entry.reason === 'challenge-first-clear-reward' ||
        entry.reason === 'challenge-repeat-win-reward',
    );
    if (playerWin) {
      expect(challengeEntries.map((entry) => entry.reason)).toEqual([
        'challenge-first-clear-reward',
      ]);
      expect(accepted.playState.clearedChallengeIds).toEqual([definition.challengeId]);
    } else {
      expect(challengeEntries).toEqual([]);
      expect(accepted.playState.clearedChallengeIds).toEqual([]);
    }
    const prepareCommand2: CollectionGameCommand = collectionGameCommandSchema.parse({
      schemaVersion: COLLECTION_SCHEMA_VERSION,
      commandVersion: COLLECTION_GAME_COMMAND_VERSION,
      commandId: 'game-cmd-prepare-2',
      collectionId: collection.collectionId,
      expectedRevision: accepted.playState.revision,
      expectedDigest: accepted.playState.digest,
      command: 'prepare-challenge-game',
      challengeId: definition.challengeId,
      objectiveId: null,
    });
    const secondPrepared = applyCollectionGameCommand(accepted.playState, prepareCommand2, {
      ...commandInput,
      balances: accepted.balances ?? commandInput.balances,
      priorCommands: [prepareCommand, acceptCommand],
    });
    expect(secondPrepared.status).toBe('accepted');
    if (secondPrepared.status !== 'accepted') return;
    const secondPending = secondPrepared.playState.pendingGame;
    if (secondPending === null) throw new Error('no pending game');
    if (secondPending.gameVersion !== 'collection-game-v3') return;
    expect(secondPending.challenge.firstClearEligible).toBe(playerWin ? false : true);
    const secondSimulated = simulateCollectionGame(secondPending, CATALOG, DEFAULT_ERA_SIM_PROFILE);
    const secondResult = secondSimulated.result as CollectionGameResultV3;
    const acceptCommand2: CollectionGameCommand = collectionGameCommandSchema.parse({
      schemaVersion: COLLECTION_SCHEMA_VERSION,
      commandVersion: COLLECTION_GAME_COMMAND_VERSION,
      commandId: 'game-cmd-accept-2',
      collectionId: collection.collectionId,
      expectedRevision: secondPrepared.playState.revision,
      expectedDigest: secondPrepared.playState.digest,
      command: 'accept-challenge-game-result',
      gameId: secondPending.gameId,
      result: secondResult,
      events: secondSimulated.events,
      completedAtIso: '2026-01-01T00:00:00.000Z',
    });
    const secondAccepted = applyCollectionGameCommand(secondPrepared.playState, acceptCommand2, {
      ...commandInput,
      balances: accepted.balances ?? commandInput.balances,
      priorCommands: [prepareCommand, acceptCommand, prepareCommand2],
    });
    expect(secondAccepted.status).toBe('accepted');
    if (secondAccepted.status !== 'accepted') return;
    const secondEntries = (secondAccepted.ledgerEntries ?? []).filter(
      (entry) =>
        entry.reason === 'challenge-first-clear-reward' ||
        entry.reason === 'challenge-repeat-win-reward',
    );
    if (playerWin && secondResult.winner === 'home' && secondResult.outcome === 'completed') {
      expect(secondEntries.map((entry) => entry.reason)).toEqual(['challenge-repeat-win-reward']);
      expect(secondAccepted.playState.clearedChallengeIds).toEqual([definition.challengeId]);
    }
  });
});
