import { describe, expect, it } from 'vitest';
import {
  seasonLeagueSchema,
  seasonPostseasonStateSchema,
  seasonRunSchema,
  seasonScheduleSchema,
  seasonDraftCatalogSchema,
  seasonDraftStateSchema,
  seasonHealthStateSchema,
  seasonInfluenceStateSchema,
  seasonTradeOfferSchema,
  seasonSelectBlockObjectiveCommandSchema,
  seasonSpendInfluenceCommandSchema,
  seasonAcceptTradeOfferCommandSchema,
  seasonDeclineTradeOfferCommandSchema,
  seasonResumeSeasonBlockCommandSchema,
  seasonForfeitInterruptedGameCommandSchema,
  seasonStartPostseasonCommandSchema,
  seasonAdvancePostseasonCommandSchema,
  seasonSubmitPostseasonRotationCommandSchema,
  seasonSpectatePostseasonGameCommandSchema,
  seasonFastForwardPostseasonCommandSchema,
  seasonRunCommandHistorySchema,
  seasonRunCommandSchema,
  seasonCandidateCheckpointSchema,
  seasonWorkerStartRequestSchema,
  seasonWorkerCancelRequestSchema,
  seasonWorkerCompleteMessageSchema,
  SEASON_NEUTRAL_HOME_COURT,
  SEASON_WORKER_WIRE_SCHEMA_VERSION,
  SEASON_AI_VERSION,
  SEASON_ROSTER_GENERATION_VERSION,
  SEASON_ROSTER_TARGETS_VERSION,
  RATINGS_VERSION,
} from './index.ts';
import {
  buildEffectsStateFixture,
  buildEmptyHealth,
  buildInitialInfluence,
  buildCheckpointFixture,
  buildPendingBlockFixture,
  buildLeague,
  buildPostseason,
  buildRun,
  buildSchedule,
  buildSummaryFixture,
  fixturePlayerId,
  SEED,
} from './season-schemas-fixtures.ts';
function roundTrip<T>(
  schema: {
    parse: (input: unknown) => T;
  },
  value: unknown,
): T {
  return schema.parse(JSON.parse(JSON.stringify(value)));
}
describe('season league schema', () => {
  it('round-trips a valid league', () => {
    const league = roundTrip(seasonLeagueSchema, buildLeague());
    expect(league.teams).toHaveLength(30);
    expect(league.teams.filter((t) => t.conference === 'east')).toHaveLength(15);
    expect(league.teams.filter((t) => t.conference === 'west')).toHaveLength(15);
    for (const division of [
      'atlantic',
      'central',
      'southeast',
      'northwest',
      'pacific',
      'southwest',
    ]) {
      expect(league.teams.filter((t) => t.division === division)).toHaveLength(5);
    }
    expect(league.teams[0]?.control).toBe('human');
  });
  it('rejects a wrong league version', () => {
    expect(() =>
      seasonLeagueSchema.parse({ ...buildLeague(), leagueVersion: 'league-v2' }),
    ).toThrow();
  });
});
describe('season schedule schema', () => {
  it('round-trips the full schedule artifact', () => {
    const schedule = roundTrip(seasonScheduleSchema, buildSchedule());
    expect(schedule.games).toHaveLength(1230);
    expect(schedule.rounds).toBe(82);
    expect(schedule.games[0]?.gameId).toBe('s000001');
  });
});
describe('season postseason schema (M2.6 postseason-v2)', () => {
  it('round-trips an empty postseason state', () => {
    const state = roundTrip(seasonPostseasonStateSchema, buildPostseason(SEED));
    expect(state.bracket).toBeNull();
    expect(state.playIn.east.playoffSeeds).toBeNull();
    expect(state.playIn.west.ranking).toBeNull();
    expect(state.tiebreakResolutions).toEqual([]);
    expect(state.finalsHomeCourtDrawSeed).toMatch(/^[0-9a-f]{32}$/);
    expect(state.playIn.east.games.sevenEight.gameId).toBe('pi-east-seven-eight');
    expect(state.playIn.west.games.final.gameId).toBe('pi-west-final');
  });
  it('rejects a wrong postseason version', () => {
    expect(() =>
      seasonPostseasonStateSchema.parse({
        ...buildPostseason(SEED),
        postseasonVersion: 'postseason-v1',
      }),
    ).toThrow();
    expect(() =>
      seasonPostseasonStateSchema.parse({
        ...buildPostseason(SEED),
        tiebreakVersion: 'tiebreaker-v2',
      }),
    ).toThrow();
  });
});
describe('season run schema', () => {
  it('round-trips a complete snapshot', () => {
    const run = roundTrip(seasonRunSchema, buildRun());
    expect(run.rosters).toHaveLength(30);
    expect(run.ownership).toHaveLength(300);
    expect(run.games).toHaveLength(1230);
  });
  it('rejects mismatched version boundaries', () => {
    const run = buildRun();
    expect(() =>
      seasonRunSchema.parse({
        ...run,
        versions: { ...run.versions, seedDerivationVersion: 'season-seeds-v9' },
      }),
    ).toThrow();
  });
});
describe('player version identity', () => {
  it('is deterministic and field-sensitive', async () => {
    const mod = await import('./index.ts');
    const { playerVersionId } = mod;
    const a = playerVersionId('p-1', 'lakers', '1990s', '1996-97');
    const b = playerVersionId('p-1', 'lakers', '1990s', '1996-97');
    expect(a).toBe(b);
    expect(a).toMatch(/^pv-[0-9a-f]{32}$/);
    expect(playerVersionId('p-2', 'lakers', '1990s', '1996-97')).not.toBe(a);
    expect(playerVersionId('p-1', 'celtics', '1990s', '1996-97')).not.toBe(a);
    expect(playerVersionId('p-1', 'lakers', '1980s', '1996-97')).not.toBe(a);
    expect(playerVersionId('p-1', 'lakers', '1990s', '1986-87')).not.toBe(a);
  });
});
describe('season seed derivation', () => {
  it('pins stable derivation vectors for the committed run seed', async () => {
    const mod = await import('./index.ts');
    const { seasonNamespaceSeed, SEASON_SEED_NAMESPACES, playerVersionId } = mod;
    const seed = 'c0ffee2026a1b2c3d4e5f60718293a4b';
    expect(seasonNamespaceSeed(seed, SEASON_SEED_NAMESPACES.draft)).toBe(
      'bf6f373420fee6f04bf1da36074ce784',
    );
    expect(seasonNamespaceSeed(seed, SEASON_SEED_NAMESPACES.aiRosters)).toBe(
      'd5edcf36a61755a2ff9f80582bb5ee46',
    );
    expect(
      seasonNamespaceSeed(seed, SEASON_SEED_NAMESPACES.scheduleGames, 'lakers', 'celtics'),
    ).toBe('c70523e788d2756bde47e3a90fadf0d7');
    expect(seasonNamespaceSeed(seed, SEASON_SEED_NAMESPACES.postseasonTies)).toBe(
      'cc022296a9b3989a9ea1d1943d6e5186',
    );
    expect(seasonNamespaceSeed(seed, SEASON_SEED_NAMESPACES.injuries)).toBe(
      '3c4fc7a600628bba49f5d95c9815f3f6',
    );
    expect(seasonNamespaceSeed(seed, SEASON_SEED_NAMESPACES.trades)).toBe(
      '5a0b6036864e4e3a80a4a8b460544a46',
    );
    expect(seasonNamespaceSeed(seed, SEASON_SEED_NAMESPACES.upgrades)).toBe(
      '4b8c47c4507c7a30616462d624a142f4',
    );
    expect(playerVersionId('p-synth-1', 'lakers', '1990s', '1995-96')).toBe(
      'pv-345baf6811b5d914c163685a20974538',
    );
  });
});
describe('season draft catalog schema (M2.1)', () => {
  function buildCatalog() {
    const candidate = (n: number, positions: string[]) => ({
      playerVersionId: `pv-${String(n).padStart(32, '0')}`,
      playerId: `p-${String(n)}`,
      franchiseId: 'lakers',
      eraId: '1990s',
      seasonKey: '1995-96',
      displayName: `Candidate ${String(n)}`,
      playerExternalId: '101',
      positions: {
        primary: 'SG',
        secondary: [],
        playable: positions,
        normalizationVersion: 'position-v3',
      },
      heightInches: 79,
      weightLbs: 215,
      summaryRatings: { overallRating: 80, offenseRating: 82, defenseRating: 74 },
      detailedRatings: {
        insideScoring: 70,
        closeShot: 68,
        midrange: 66,
        threePoint: 62,
        freeThrow: 74,
        ballHandling: 70,
        passing: 70,
        offensiveIq: 70,
        offensiveRebound: 60,
        defensiveRebound: 65,
        perimeterDefense: 62,
        interiorDefense: 62,
        steal: 60,
        block: 60,
        defensiveIq: 62,
        speed: 70,
        strength: 65,
        vertical: 66,
      },
      tendencies: {
        usageRate: 20,
        passRate: 30,
        shotRate: 25,
        driveRate: 18,
        postUpRate: 5,
        rimFrequency: 30,
        shortMidFrequency: 20,
        longMidFrequency: 14,
        cornerThreeFrequency: 8,
        aboveBreakThreeFrequency: 12,
        threePointRate: 20,
        freeThrowRate: 22,
        turnoverRate: 12,
        isolationRate: 10,
        pickAndRollBallHandlerRate: 25,
        pickAndRollRollManRate: 10,
        spotUpRate: 20,
        transitionRate: 15,
        cutRate: 10,
        foulRate: 2,
        stealAttemptRate: 8,
        blockAttemptRate: 10,
        crashOffensiveGlassRate: 12,
      },
      stamina: {
        rating: 45 + n,
        historicalMpg: (30 + n) / 2,
        derivationVersion: 'season-stamina-v2',
      },
      durability: {
        rating: 45 + n,
        derivationVersion: 'durability-v1',
      },
      anchors: {
        gamesPlayed: 70,
        minutesPerGame: 30,
        pointsPerGame: 12,
        reboundsPerGame: 5,
        offensiveReboundsPerGame: 1,
        defensiveReboundsPerGame: 4,
        assistsPerGame: 3,
        stealsPerGame: 1,
        blocksPerGame: 0.5,
        turnoversPerGame: 1.5,
        fieldGoalPct: 0.45,
        threePointPct: 0.35,
        freeThrowPct: 0.78,
        threePointAttemptRate: 0.2,
        freeThrowAttemptRate: 0.2,
      },
    });
    const candidates = [candidate(1, ['PG']), candidate(2, ['SG']), candidate(3, ['SF'])];
    return {
      schemaVersion: 1,
      catalogVersion: 'season-draft-catalog-v4',
      dataVersion: `m10-${RATINGS_VERSION}`,
      ratingsVersion: RATINGS_VERSION,
      positionNormalizationVersion: 'position-v3',
      playerVersionIdVersion: 'player-version-id-v1',
      staminaVersion: 'season-stamina-v2',
      durabilityVersion: 'durability-v1',
      pools: [
        {
          franchiseId: 'lakers',
          eraId: '1990s',
          playerVersionIds: candidates.map((c) => c.playerVersionId),
        },
      ],
      candidates,
    };
  }
  it('round-trips a valid catalog', () => {
    const catalog = roundTrip(seasonDraftCatalogSchema, buildCatalog());
    expect(catalog.pools).toHaveLength(1);
    expect(catalog.candidates).toHaveLength(3);
    expect(catalog.catalogVersion).toBe('season-draft-catalog-v4');
    expect(catalog.staminaVersion).toBe('season-stamina-v2');
    expect(catalog.durabilityVersion).toBe('durability-v1');
    for (const candidate of catalog.candidates) {
      expect(candidate.stamina.rating).toBeGreaterThanOrEqual(45);
      expect(candidate.stamina.rating).toBeLessThanOrEqual(95);
      expect(candidate.stamina.derivationVersion).toBe('season-stamina-v2');
      expect(candidate.durability.rating).toBeGreaterThanOrEqual(45);
      expect(candidate.durability.rating).toBeLessThanOrEqual(95);
      expect(candidate.durability.derivationVersion).toBe('durability-v1');
    }
  });
  it('rejects wrong catalog and identity versions', () => {
    expect(() =>
      seasonDraftCatalogSchema.parse({ ...buildCatalog(), catalogVersion: 'season-draft-v1' }),
    ).toThrow();
    expect(() =>
      seasonDraftCatalogSchema.parse({ ...buildCatalog(), catalogVersion: 'season-draft-v2' }),
    ).toThrow();
    expect(() =>
      seasonDraftCatalogSchema.parse({ ...buildCatalog(), playerVersionIdVersion: 'pv-v2' }),
    ).toThrow();
    expect(() =>
      seasonDraftCatalogSchema.parse({ ...buildCatalog(), staminaVersion: 'season-stamina-v3' }),
    ).toThrow();
    expect(() =>
      seasonDraftCatalogSchema.parse({ ...buildCatalog(), durabilityVersion: 'durability-v2' }),
    ).toThrow();
  });
});
describe('season draft state schema (M2.3.5 season-draft-v4)', () => {
  const seedPath = ['draft', 'offer', 'p1', '1', '1', 'safe-order', 'sample-order'];
  const cards = [
    { playerVersionId: `pv-${'1'.repeat(32)}`, selectable: true, coverageReason: null },
    { playerVersionId: `pv-${'2'.repeat(32)}`, selectable: true, coverageReason: null },
    { playerVersionId: `pv-${'3'.repeat(32)}`, selectable: true, coverageReason: null },
    { playerVersionId: `pv-${'4'.repeat(32)}`, selectable: true, coverageReason: null },
    {
      playerVersionId: `pv-${'5'.repeat(32)}`,
      selectable: false,
      coverageReason: 'disabled fixture card',
    },
    { playerVersionId: `pv-${'6'.repeat(32)}`, selectable: true, coverageReason: null },
    { playerVersionId: `pv-${'7'.repeat(32)}`, selectable: true, coverageReason: null },
    { playerVersionId: `pv-${'8'.repeat(32)}`, selectable: true, coverageReason: null },
  ];
  const baseState = {
    schemaVersion: 3,
    draftVersion: 'season-draft-v4',
    runId: 'run-1',
    rootSeed: 'a1b2c3d4e5f60718293a4b5c6d7e8f9a',
    league: buildLeague(),
    catalogVersion: 'season-draft-v4',
    participants: [
      { participantId: 'p1', franchiseId: 'lakers' },
      { participantId: 'p2', franchiseId: 'celtics' },
    ],
    firstPickParticipantId: 'p1',
    round: 2,
    currentTurnParticipantId: 'p2',
    status: 'drafting',
    revision: 4,
    currentOffer: {
      participantId: 'p2',
      round: 2,
      pickOrdinal: 2,
      seedPath: ['draft', 'offer', 'p2', '2', '2', 'safe-order', 'sample-order'],
      cards,
    },
    offers: [
      {
        participantId: 'p1',
        round: 1,
        pickOrdinal: 1,
        seedPath,
        cards,
      },
    ],
    picks: [
      {
        participantId: 'p1',
        round: 1,
        pickOrdinal: 1,
        playerVersionId: `pv-${'1'.repeat(32)}`,
        franchiseId: 'lakers',
        eraId: '1990s',
        seedPath,
      },
    ],
    commandLog: [
      {
        status: 'accepted',
        commandId: 'c1',
        revisionBefore: 0,
        revisionAfter: 1,
        stateDigest: '0'.repeat(32),
        command: {
          commandId: 'c1',
          expectedRevision: 0,
          payload: {
            kind: 'create-season-draft',
            runId: 'run-1',
            rootSeed: 'a1b2c3d4e5f60718293a4b5c6d7e8f9a',
            league: buildLeague(),
            humanParticipantIds: ['p1', 'p2'],
            catalogVersion: 'season-draft-v4',
          },
        },
      },
    ],
  };
  it('round-trips a valid drafting state', () => {
    const state = roundTrip(seasonDraftStateSchema, baseState);
    expect(state.participants).toHaveLength(2);
    expect(state.picks).toHaveLength(1);
    expect(state.currentOffer).not.toBeNull();
    expect(state.offers).toHaveLength(1);
    expect(state.schemaVersion).toBe(3);
    expect(state.catalogVersion).toBe('season-draft-v4');
  });
});
describe('season AI contracts (M2.1, M2.4 roster-generation-v5)', () => {
  it('round-trips a schema-14 run with its aiPools and M2.5.5 state', () => {
    const run = roundTrip(seasonRunSchema, buildRun());
    expect(run.schemaVersion).toBe(14);
    expect(run.versions.runSchemaVersion).toBe(14);
    expect(run.versions.rosterGenerationVersion).toBe(SEASON_ROSTER_GENERATION_VERSION);
    expect(run.versions.aiVersion).toBe(SEASON_AI_VERSION);
    expect(run.versions.rosterTargetsVersion).toBe(SEASON_ROSTER_TARGETS_VERSION);
    expect(run.versions.rotationVersion).toBe('season-rotation-v3');
    expect(run.versions.minutePolicyVersion).toBe('minute-policy-v1');
    expect(run.aiPools).toHaveLength(29);
    expect(run.aiPools.every((pool) => pool.selections.length === 10)).toBe(true);
    expect(() =>
      seasonRunSchema.parse({ ...run, aiPools: run.aiPools.slice(0, 28) }),
    ).not.toThrow();
    expect(() => seasonRunSchema.parse({ ...run, aiPools: run.aiPools.slice(0, 27) })).toThrow();
    expect(() => seasonRunSchema.parse({ ...run, aiPools: [] })).toThrow();
    expect(() =>
      seasonRunSchema.parse({
        ...run,
        versions: { ...run.versions, aiVersion: 'season-ai-v1' },
      }),
    ).toThrow();
    expect(() =>
      seasonRunSchema.parse({
        ...run,
        versions: { ...run.versions, rotationVersion: 'season-rotation-v1' },
      }),
    ).toThrow();
    expect(() =>
      seasonRunSchema.parse({
        ...run,
        versions: { ...run.versions, minutePolicyVersion: 'minute-policy-v2' },
      }),
    ).toThrow();
  });
});
describe('season health family (M2.5, season-health-v2)', () => {
  it('round-trips an empty health state and rejects wrong versions', () => {
    const state = roundTrip(seasonHealthStateSchema, buildEmptyHealth());
    expect(state.injuries).toEqual([]);
    expect(state.schemaVersion).toBe(1);
    expect(() =>
      seasonHealthStateSchema.parse({ ...buildEmptyHealth(), healthVersion: 'season-health-v1' }),
    ).toThrow();
    expect(() =>
      seasonHealthStateSchema.parse({ ...buildEmptyHealth(), schemaVersion: 2 }),
    ).toThrow();
  });
});
describe('season influence family (M2.5, season-influence-v2)', () => {
  it('round-trips the initial state (30 franchises at +2)', () => {
    const state = roundTrip(seasonInfluenceStateSchema, buildInitialInfluence());
    expect(Object.keys(state.balances)).toHaveLength(30);
    expect(state.ledger).toHaveLength(30);
    expect(state.ledger[0]?.balanceAfter).toBe(2);
    expect(state.ledger.every((entry) => entry.appliedDelta === entry.requestedDelta)).toBe(true);
    expect(state.windows).toEqual({});
    expect(state.rehabs).toEqual({});
  });
});
describe('season trade family (M2.5, season-trade-v1)', () => {
  function buildOffer() {
    return {
      offerId: `off-${'c'.repeat(32)}`,
      windowIndex: 0,
      seedPath: ['trades', 'window', '0', 'offer', '0'],
      toFranchiseId: 'hawks',
      fromFranchiseId: 'lakers',
      outgoingPlayerVersionIds: [fixturePlayerId(0), fixturePlayerId(1)],
      incomingPlayerVersionIds: [fixturePlayerId(30), fixturePlayerId(31)],
      outgoingHealth: [
        { available: true, activeInjuryIds: [] },
        { available: false, activeInjuryIds: [`inj-${'d'.repeat(32)}`] },
      ],
      incomingHealth: [
        { available: true, activeInjuryIds: [] },
        { available: true, activeInjuryIds: [] },
      ],
      valueBand: { ratioBasisPoints: 950, band: '80-120', qualified: true },
      roleFit: {
        outgoingRoles: ['perimeter-defense', 'interior-defense'],
        incomingRoles: ['primary-creation'],
        notes: 'Fills the creation gap',
      },
      rosterNeedFacts: { outgoingDepth: 4, incomingDepth: 1, notes: 'Thin at guard' },
      projectedRotationChanges: 'Bench 6 moves to the closing five.',
      projectedChemistryDisruption: { removedPairs: 15, newPairs: 17 },
      status: 'open',
    };
  }
  it('round-trips a 2-for-2 offer and rejects shape violations', () => {
    const offer = roundTrip(seasonTradeOfferSchema, buildOffer());
    expect(offer.valueBand.band).toBe('80-120');
    expect(offer.outgoingHealth).toHaveLength(2);
    expect(() =>
      seasonTradeOfferSchema.parse({
        ...buildOffer(),
        incomingPlayerVersionIds: [fixturePlayerId(30)],
      }),
    ).toThrow();
    expect(() =>
      seasonTradeOfferSchema.parse({
        ...buildOffer(),
        outgoingHealth: [{ available: true, activeInjuryIds: [] }],
      }),
    ).toThrow();
    expect(() => seasonTradeOfferSchema.parse({ ...buildOffer(), status: 'pending' })).toThrow();
    expect(() => seasonTradeOfferSchema.parse({ ...buildOffer(), offerId: 'off-x' })).toThrow();
    expect(() =>
      seasonTradeOfferSchema.parse({ ...buildOffer(), projectedRotationChanges: 'x'.repeat(513) }),
    ).toThrow();
  });
});
describe('season commands (M2.5/M2.6, schema 14)', () => {
  const base = {
    schemaVersion: 14,
    commandId: 'cmd-1',
    runId: 'fixture-run-1',
    expectedStateRevision: 3,
    expectedStateDigest: '0'.repeat(32),
  };
  it('validates the base shape on every command', () => {
    const legacyObjective = {
      ...base,
      command: 'select-block-objective',
      blockIndex: 0,
      objectiveId: 'win-six',
    };
    expect(seasonSelectBlockObjectiveCommandSchema.safeParse(legacyObjective).success).toBe(true);
    expect(seasonRunCommandHistorySchema.safeParse(legacyObjective).success).toBe(true);
    expect(seasonRunCommandSchema.safeParse(legacyObjective).success).toBe(false);
    const commands = [
      {
        ...base,
        command: 'spend-influence',
        franchiseId: 'hawks',
        purpose: 'extra-trade-offer',
        windowIndex: 0,
      },
      {
        ...base,
        command: 'accept-trade-offer',
        windowIndex: 0,
        offerId: `off-${'c'.repeat(32)}`,
      },
      {
        ...base,
        command: 'decline-trade-offer',
        windowIndex: 1,
        offerId: `off-${'d'.repeat(32)}`,
      },
      { ...base, command: 'resume-season-block', blockIndex: 1, rotationDigest: '0'.repeat(32) },
      { ...base, command: 'forfeit-interrupted-game', blockIndex: 1, nextGameId: 's000016' },
      { ...base, command: 'start-postseason' },
      { ...base, command: 'advance-postseason' },
      {
        ...base,
        command: 'advance-postseason',
        targetGameId: 'pi-east-seven-eight',
      },
      {
        ...base,
        command: 'submit-postseason-rotation',
        targetGameId: 'pi-east-seven-eight',
        rotation: {
          franchiseId: 'hawks',
          rotation: {
            franchiseId: 'hawks',
            starters: Array.from({ length: 5 }, (_, i) => fixturePlayerId(i)),
            benchOrder: Array.from({ length: 5 }, (_, i) => fixturePlayerId(5 + i)),
            targetMinutes: [
              ...Array.from({ length: 5 }, (_, i) => ({
                playerVersionId: fixturePlayerId(i),
                minutes: 32,
              })),
              ...Array.from({ length: 5 }, (_, i) => ({
                playerVersionId: fixturePlayerId(5 + i),
                minutes: 16,
              })),
            ],
            closingFive: Array.from({ length: 5 }, (_, i) => fixturePlayerId(i)),
            minutePolicy: { policyVersion: 'minute-policy-v1', strategy: 'balanced' },
            rotationVersion: 'season-rotation-v3',
          },
        },
      },
      { ...base, command: 'spectate-postseason-game', targetGameId: 'po-finals-g7' },
      { ...base, command: 'fast-forward-postseason' },
    ];
    const individual = [
      seasonSpendInfluenceCommandSchema,
      seasonAcceptTradeOfferCommandSchema,
      seasonDeclineTradeOfferCommandSchema,
      seasonResumeSeasonBlockCommandSchema,
      seasonForfeitInterruptedGameCommandSchema,
      seasonStartPostseasonCommandSchema,
      seasonAdvancePostseasonCommandSchema,
      seasonAdvancePostseasonCommandSchema,
      seasonSubmitPostseasonRotationCommandSchema,
      seasonSpectatePostseasonGameCommandSchema,
      seasonFastForwardPostseasonCommandSchema,
    ];
    for (let index = 0; index < commands.length; index += 1) {
      const command = commands[index];
      const schema = individual[index];
      if (!schema) throw new Error('command schema pair missing');
      expect(schema.safeParse(command).success).toBe(true);
      expect(seasonRunCommandSchema.safeParse(command).success).toBe(true);
    }
    expect(() =>
      seasonRunCommandSchema.parse({
        command: 'start-postseason',
        runId: 'fixture-run-1',
        expectedStateRevision: 3,
        expectedStateDigest: '0'.repeat(32),
      }),
    ).toThrow();
    expect(() =>
      seasonRunCommandSchema.parse({
        ...base,
        command: 'submit-postseason-rotation',
        targetGameId: 'pi-east-seven-eight',
        rotation: { franchiseId: 'hawks' },
      }),
    ).toThrow();
    expect(() =>
      seasonRunCommandSchema.parse({
        ...base,
        command: 'spectate-postseason-game',
        targetGameId: 's000001',
      }),
    ).toThrow();
    expect(() =>
      seasonRunCommandSchema.parse({
        ...base,
        command: 'select-block-objective',
        blockIndex: 8,
        objectiveId: 'win-six',
      }),
    ).toThrow();
    expect(() =>
      seasonRunCommandSchema.parse({
        ...base,
        command: 'select-block-objective',
        blockIndex: 0,
        objectiveId: 'clutch',
      }),
    ).toThrow();
    expect(() =>
      seasonRunCommandSchema.parse({
        ...base,
        command: 'spend-influence',
        franchiseId: 'hawks',
        purpose: 'risky-rehab',
        windowIndex: 0,
      }),
    ).toThrow();
    expect(() =>
      seasonRunCommandSchema.parse({
        ...base,
        command: 'spend-influence',
        franchiseId: 'hawks',
        purpose: 'extra-trade-offer',
        injuryId: `inj-${'e'.repeat(32)}`,
        windowIndex: 0,
      }),
    ).toThrow();
    expect(() =>
      seasonRunCommandSchema.parse({
        ...base,
        command: 'spend-influence',
        franchiseId: 'hawks',
        purpose: 'extra-trade-offer',
      }),
    ).toThrow();
    expect(() => seasonRunCommandSchema.parse({ ...base, command: 'unknown-command' })).toThrow();
    expect(() =>
      seasonRunCommandSchema.parse({
        ...base,
        command: 'resume-season-block',
        blockIndex: 1,
        rotationDigest: 'bad',
      }),
    ).toThrow();
    expect(() =>
      seasonRunCommandSchema.parse({
        ...base,
        command: 'accept-trade-offer',
        windowIndex: 3,
        offerId: `off-${'c'.repeat(32)}`,
      }),
    ).toThrow();
  });
});
describe('season checkpoint M2.5 facts', () => {
  it('round-trips a candidate checkpoint with health, influence, transactions, and the state chain', () => {
    const checkpoint = roundTrip(seasonCandidateCheckpointSchema, buildCheckpointFixture());
    expect(checkpoint.health.injuries).toEqual([]);
    expect(checkpoint.transactions).toEqual([]);
    expect(Object.keys(checkpoint.influence.balances)).toHaveLength(30);
    expect(checkpoint.challenges?.blockIndex).toBe(0);
    expect(checkpoint.challenges?.results).toHaveLength(3);
    expect(checkpoint.challengeIds).toHaveLength(3);
    expect(checkpoint.expectedStateRevision).toBe(0);
    expect(checkpoint.stateDigest).toBe('0'.repeat(32));
    expect(checkpoint.versions.healthVersion).toBe('season-health-v2');
    expect(checkpoint.versions.tradeTargetsVersion).toBe('trade-targets-v3');
    expect(checkpoint.freeAgency.windows).toEqual([]);
  });
});
describe('season worker wire v9 (stateless)', () => {
  function buildStartRequest() {
    const run = buildRun();
    return {
      schemaVersion: SEASON_WORKER_WIRE_SCHEMA_VERSION,
      type: 'season-block-start',
      requestId: 'req-1',
      runId: run.runId,
      rootSeed: run.rootSeed,
      blockIndex: 0,
      expectedRevision: 0,
      rotationDigest: '0'.repeat(32),
      commandId: 'cmd-1',
      run,
      schedule: buildSchedule(),
      homeCourt: SEASON_NEUTRAL_HOME_COURT,
      humanFranchiseId: null,
      catalogUrl: 'https://example.test/season/draft-catalog.json',
      catalogHash: '0'.repeat(64),
      profileUrl: 'https://example.test/season/era-sim.json',
      profileHash: '0'.repeat(64),
      priorSummaries: [],
      priorEffects: buildEffectsStateFixture(),
      priorHealth: buildEmptyHealth(),
      startGameId: null,
      objectiveId: null,
      priorInfluence: buildInitialInfluence(),
      expectedStateRevision: 0,
      expectedStateDigest: '0'.repeat(32),
    };
  }
  it('rejects wire schema 3 requests and messages', () => {
    const start = buildStartRequest();
    expect(() => seasonWorkerStartRequestSchema.parse({ ...start, schemaVersion: 3 })).toThrow();
    expect(() =>
      seasonWorkerCancelRequestSchema.parse({
        schemaVersion: 3,
        type: 'season-block-cancel',
        requestId: 'req-1',
      }),
    ).toThrow();
  });
  it('round-trips a stateless start request with full prior state', () => {
    const request = roundTrip(seasonWorkerStartRequestSchema, buildStartRequest());
    expect(request.priorHealth.injuries).toEqual([]);
    expect(request.startGameId).toBeNull();
    expect(request.objectiveId).toBeNull();
    expect(request.priorInfluence).not.toBeNull();
    expect(request.expectedStateRevision).toBe(0);
    const withResume = seasonWorkerStartRequestSchema.parse({
      ...buildStartRequest(),
      startGameId: 's000016',
      objectiveId: 'win-six',
      priorSummaries: [buildSummaryFixture()],
    });
    expect(withResume.startGameId).toBe('s000016');
    expect(withResume.objectiveId).toBe('win-six');
    expect(withResume.priorSummaries).toHaveLength(1);
    expect(() =>
      seasonWorkerStartRequestSchema.parse({
        ...buildStartRequest(),
        priorEffects: undefined,
      }),
    ).toThrow();
    expect(() =>
      seasonWorkerStartRequestSchema.parse({
        ...buildStartRequest(),
        startGameId: 'not-a-game',
      }),
    ).toThrow();
  });
  it('round-trips complete messages with committed and interrupted results', () => {
    const committed = roundTrip(seasonWorkerCompleteMessageSchema, {
      schemaVersion: SEASON_WORKER_WIRE_SCHEMA_VERSION,
      type: 'season-block-complete',
      requestId: 'req-1',
      result: { status: 'committed', checkpoint: buildCheckpointFixture() },
    });
    expect(committed.result.status).toBe('committed');
    const interrupted = roundTrip(seasonWorkerCompleteMessageSchema, {
      schemaVersion: SEASON_WORKER_WIRE_SCHEMA_VERSION,
      type: 'season-block-complete',
      requestId: 'req-1',
      result: { status: 'interrupted', pending: buildPendingBlockFixture() },
    });
    expect(interrupted.result.status).toBe('interrupted');
    expect(() =>
      seasonWorkerCompleteMessageSchema.parse({
        schemaVersion: SEASON_WORKER_WIRE_SCHEMA_VERSION,
        type: 'season-block-complete',
        requestId: 'req-1',
        result: { status: 'committed', pending: buildPendingBlockFixture() },
      }),
    ).toThrow();
  });
});
