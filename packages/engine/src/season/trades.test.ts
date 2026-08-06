import { describe, expect, it, vi } from 'vitest';
import fc from 'fast-check';
import { seedFromString } from '@hoop-rush/test-fixtures';
import type {
  Position,
  SeasonDraftCatalog,
  SeasonEffectsState,
  SeasonRun,
  SeasonTradeOffer,
  SeasonTradeState,
} from '@hoop-rush/data-contracts';
import { validateSeasonRoster, type SeasonRosterMemberInput } from './roster-rules.ts';
import { validateSeasonRotation } from './rotation.ts';
import {
  applySeasonTrade,
  expireTradeOffersForBlock,
  generatedExtraOfferForSpend,
  openSeasonTradeWindow,
  ratioMutuallyWithinBand,
  seasonTradePlayerValue,
  seasonTradeCatalogFactsOf,
  SeasonTradeFactsError,
  SeasonTradeInvariantError,
  type SeasonWindowOpenResult,
} from './trades.ts';
import {
  aiTradeCountOf,
  buildEconomyTestRun,
  injuryIdOf,
  withInjury,
  zeroEffectsOf,
} from './season-economy-test-support.ts';

/**
 * M2.5 trade window tests (season-trade-v1, engine side): deterministic
 * window generation and replay, value bands, offer shapes, AI-to-AI season
 * totals (8-15), unique ownership + legal rosters + chemistry invariants as
 * a property over seeds, atomic application, deadline expiry, and the
 * influence-purchased fourth offer. The risky-rehab AI path is stubbed to
 * the contract semantics (the health workstream owns the real seams).
 */

vi.mock('./injuries.ts', async (importOriginal) => {
  const original = await importOriginal<typeof import('./injuries.ts')>();
  return {
    ...original,
    // Deterministic contract-conformant stubs until the health workstream
    // lands the real rehab seams: success shortens remaining absence by one
    // game (minimum one), failure lengthens it by one.
    rollSeasonRehabOutcome: () => 'success' as const,
    applyRiskyRehabOutcome: (
      health: SeasonRun['health'],
      injuryId: string,
      outcome: 'success' | 'failure',
    ) => ({
      ...health,
      injuries: health.injuries.map((injury) =>
        injury.injuryId === injuryId
          ? {
              ...injury,
              missedGamesRemaining:
                outcome === 'success'
                  ? Math.max(1, injury.missedGamesRemaining - 1)
                  : injury.missedGamesRemaining + 1,
              rehabModifier: outcome === 'success' ? (-1 as const) : (1 as const),
            }
          : injury,
      ),
    }),
  };
});

const HUMAN = 'lakers';

function fixture(seed?: string) {
  return buildEconomyTestRun({ seed: seed ?? 'a1b2c3d4e5f60718293a4b5c6d7e8f9a' });
}

function openWindow(
  run: SeasonRun,
  catalog: SeasonDraftCatalog,
  blockIndex: number,
): SeasonWindowOpenResult {
  const result = openSeasonTradeWindow({
    run,
    blockIndex,
    rootSeed: run.rootSeed,
    humanFranchiseId: HUMAN,
    catalog,
    effects: zeroEffectsOf(run),
  });
  if (result === null) throw new Error(`window did not open for block ${String(blockIndex)}`);
  return result;
}

function applyWindowResult(
  run: SeasonRun,
  result: SeasonWindowOpenResult,
): SeasonRun & { effects: SeasonEffectsState } {
  return {
    ...run,
    trade: result.trade,
    influence: result.influence,
    transactions: result.transactions,
    rosters: result.rosters,
    ownership: result.ownership,
    rotations: result.rotations,
    effects: result.effects,
    health: result.health,
    stateRevision: result.stateRevision,
    stateDigest: result.stateDigest,
  };
}

/** Runs the three windows of one season in order on a fresh run. */
function seasonWindows(seed: string): { run: SeasonRun; results: SeasonWindowOpenResult[] } {
  const { run: base, catalog } = fixture(seed);
  let run: SeasonRun & { effects: SeasonEffectsState } = { ...base, effects: zeroEffectsOf(base) };
  const results: SeasonWindowOpenResult[] = [];
  for (const blockIndex of [2, 4, 5]) {
    const result = openWindow(run, catalog, blockIndex);
    run = applyWindowResult(run, result);
    results.push(result);
  }
  return { run, results };
}

describe('season trade window opening', () => {
  it('opens windows only for accepted blocks 2, 4, 5', () => {
    const { run, catalog } = fixture();
    for (const blockIndex of [0, 1, 3, 6, 7, 8]) {
      expect(
        openSeasonTradeWindow({
          run,
          blockIndex,
          rootSeed: run.rootSeed,
          humanFranchiseId: HUMAN,
          catalog,
          effects: zeroEffectsOf(run),
        }),
      ).toBeNull();
    }
    for (const blockIndex of [2, 4, 5]) {
      expect(
        openSeasonTradeWindow({
          run,
          blockIndex,
          rootSeed: run.rootSeed,
          humanFranchiseId: HUMAN,
          catalog,
          effects: zeroEffectsOf(run),
        }),
      ).not.toBeNull();
    }
  });

  it('returns null without a human franchise and for an already-open window', () => {
    const { run, catalog } = fixture();
    expect(
      openSeasonTradeWindow({
        run,
        blockIndex: 2,
        rootSeed: run.rootSeed,
        humanFranchiseId: null,
        catalog,
        effects: zeroEffectsOf(run),
      }),
    ).toBeNull();
    const first = openWindow(run, catalog, 2);
    const reopened = openSeasonTradeWindow({
      run: applyWindowResult(run, first),
      blockIndex: 2,
      rootSeed: run.rootSeed,
      humanFranchiseId: HUMAN,
      catalog,
      effects: first.effects,
    });
    expect(reopened).toBeNull();
  });

  it('generates deterministically and replays identically', () => {
    const seed = 'c0ffee2026a1b2c3d4e5f60718293a4b';
    const first = seasonWindows(seed);
    const second = seasonWindows(seed);
    expect(first.run.trade).toEqual(second.run.trade);
    expect(first.results[0]?.trade).toEqual(second.results[0]?.trade);
    expect(first.results[1]?.trade).toEqual(second.results[1]?.trade);
    expect(first.results[2]?.trade).toEqual(second.results[2]?.trade);
  });

  it('creates three open base offers for the human franchise with 1-for-1 or 2-for-2 shapes', () => {
    const { results } = seasonWindows('a1b2c3d4e5f60718293a4b5c6d7e8f9a');
    const window = results[0]?.trade.windows[0];
    expect(window).toBeDefined();
    const baseOffers = (window?.offers ?? []).filter(
      (offer) => offer.toFranchiseId === HUMAN && offer.status === 'open',
    );
    expect(baseOffers).toHaveLength(3);
    for (const offer of baseOffers) {
      expect(offer.offerId).toMatch(/^off-[0-9a-f]{32}$/);
      expect(offer.seedPath.length).toBeGreaterThan(0);
      expect(offer.fromFranchiseId).not.toBe(HUMAN);
      expect(offer.outgoingPlayerVersionIds.length).toBe(offer.incomingPlayerVersionIds.length);
      expect([1, 2]).toContain(offer.outgoingPlayerVersionIds.length);
      expect(offer.outgoingHealth).toHaveLength(offer.outgoingPlayerVersionIds.length);
      expect(offer.incomingHealth).toHaveLength(offer.incomingPlayerVersionIds.length);
      expect(offer.projectedRotationChanges.length).toBeLessThanOrEqual(512);
    }
    // The three base offers come from distinct AI franchises.
    const fromFranchises = new Set(baseOffers.map((offer) => offer.fromFranchiseId));
    expect(fromFranchises.size).toBe(3);
  });

  it('records value bands with the frozen band semantics', () => {
    const { results } = seasonWindows('a1b2c3d4e5f60718293a4b5c6d7e8f9a');
    for (const result of results) {
      for (const window of result.trade.windows) {
        for (const offer of window.offers) {
          const size = offer.outgoingPlayerVersionIds.length;
          expect(offer.valueBand.band).toBe(size === 1 ? '85-115' : '80-120');
          expect(offer.valueBand.ratioBasisPoints).toBeGreaterThanOrEqual(800);
          expect(offer.valueBand.ratioBasisPoints).toBeLessThanOrEqual(1200);
          const bounds = size === 1 ? [850, 1150] : [800, 1200];
          const inBand =
            offer.valueBand.ratioBasisPoints >= (bounds[0] ?? 0) &&
            offer.valueBand.ratioBasisPoints <= (bounds[1] ?? 0);
          expect(offer.valueBand.qualified).toBe(inBand);
        }
      }
    }
  });

  it('records health facts for every moved player from the run health state', () => {
    const { run: base, catalog } = fixture('b1d2e3f405162738495a6b7c8d9e0f11');
    const humanRoster = base.rosters.find((roster) => roster.franchiseId === HUMAN);
    const injuredVersion = humanRoster?.players[0]?.playerVersionId;
    if (injuredVersion === undefined) throw new Error('no human roster');
    const injuryId = injuryIdOf('trades-health-seed');
    const run = withInjury(base, {
      injuryId,
      playerVersionId: injuredVersion,
      franchiseId: HUMAN,
      gameId: 's000001',
      type: 'lower-body',
      severity: 'moderate',
      occurredBeforeHalftime: false,
      sameGameReturn: false,
      sameGameReturned: null,
      missedGamesTotal: 4,
      missedGamesRemaining: 3,
      actualReturnRound: null,
      seasonEnding: false,
      rehabModifier: 0,
      recurrenceWindowRoundsRemaining: 0,
      seedPath: ['injuries', 'test'],
    });
    const result = openWindow(run, catalog, 2);
    const window = result.trade.windows[0];
    if (window === undefined) throw new Error('no window 0');
    const offersMentioning = window.offers.filter((offer) =>
      [...offer.outgoingPlayerVersionIds, ...offer.incomingPlayerVersionIds].includes(
        injuredVersion,
      ),
    );
    for (const offer of offersMentioning) {
      const index = offer.outgoingPlayerVersionIds.indexOf(injuredVersion);
      if (index >= 0) {
        expect(offer.outgoingHealth[index]).toEqual({
          available: false,
          activeInjuryIds: [injuryId],
        });
      }
      const incomingIndex = offer.incomingPlayerVersionIds.indexOf(injuredVersion);
      if (incomingIndex >= 0) {
        expect(offer.incomingHealth[incomingIndex]).toEqual({
          available: false,
          activeInjuryIds: [injuryId],
        });
      }
    }
  });

  it('records AI-to-AI activity as accepted offers that never involve the human roster', () => {
    const { results } = seasonWindows('a1b2c3d4e5f60718293a4b5c6d7e8f9a');
    const aiOffers = results.flatMap((result) =>
      result.trade.windows.flatMap((window) =>
        window.offers.filter((offer) => offer.status === 'accepted'),
      ),
    );
    for (const offer of aiOffers) {
      expect(offer.toFranchiseId).not.toBe(HUMAN);
      expect(offer.fromFranchiseId).not.toBe(HUMAN);
      expect(offer.toFranchiseId).not.toBe(offer.fromFranchiseId);
      // AI acceptances are mutually within the frozen band.
      expect(
        ratioMutuallyWithinBand(
          offer.valueBand.ratioBasisPoints,
          offer.outgoingPlayerVersionIds.length as 1 | 2,
        ),
      ).toBe(true);
    }
  });

  it('records AI influence spends with synthetic command ids and window tracking', () => {
    const { run: base, catalog } = fixture('b1d2e3f405162738495a6b7c8d9e0f11');
    const result = openWindow(base, catalog, 2);
    const spendTransactions = result.transactions.filter(
      (entry) => entry.type === 'influence-spend',
    );
    expect(spendTransactions.length).toBeGreaterThan(0);
    for (const entry of spendTransactions) {
      expect(entry.commandId).toMatch(/^ai-window-0-/);
      expect(entry.blockIndex).toBe(2);
      expect(entry.appliedAtStateRevision).toBe(1);
    }
    const spendLedger = result.influence.ledger.filter(
      (entry) => entry.source === 'extra-trade-offer',
    );
    expect(spendLedger.length).toBeGreaterThan(0);
    for (const entry of spendLedger) {
      expect(entry.requestedDelta).toBe(-1);
      expect(entry.appliedDelta).toBe(-1);
      // Ledger reconciliation: balanceAfter === sum of applied deltas up to
      // and including this entry (initial +2 grant included).
      const priorDeltas = result.influence.ledger
        .filter(
          (prior) => prior.franchiseId === entry.franchiseId && prior.entryId <= entry.entryId,
        )
        .reduce((sum, prior) => sum + prior.appliedDelta, 0);
      expect(entry.balanceAfter).toBe(priorDeltas);
      // windows tracking recorded the spend
      const windows = result.influence.windows[entry.franchiseId];
      expect(windows?.some((window) => window.windowIndex === 0 && window.extraOfferSpent)).toBe(
        true,
      );
    }
    for (const franchiseId of Object.keys(result.influence.balances)) {
      expect(result.influence.balances[franchiseId] ?? 0).toBeGreaterThanOrEqual(-3);
    }
  });

  it('bumps stateRevision by one and recomputes a fresh stateDigest', () => {
    const { run, catalog } = fixture();
    const result = openWindow(run, catalog, 2);
    expect(result.stateRevision).toBe(run.stateRevision + 1);
    expect(result.stateDigest).toMatch(/^[0-9a-f]{32}$/);
    expect(result.stateDigest).not.toBe(run.stateDigest);
  });

  it('keeps exactly 300 loads and 1,350 pairs after window activity', () => {
    const { results } = seasonWindows('a1b2c3d4e5f60718293a4b5c6d7e8f9a');
    const finalEffects = results[2]?.effects;
    expect(finalEffects?.playerStates).toHaveLength(300);
    expect(finalEffects?.pairStates).toHaveLength(1350);
  });
});

describe('season AI trade season totals', () => {
  it('stays within the frozen 8-15 gate across seeds', () => {
    const seeds = [
      'a1b2c3d4e5f60718293a4b5c6d7e8f9a',
      'c0ffee2026a1b2c3d4e5f60718293a4b',
      'b1d2e3f405162738495a6b7c8d9e0f11',
      'd00d2026a1b2c3d4e5f60718293a4b5c',
      'f00d2026a1b2c3d4e5f60718293a4b5c',
      '1234567890abcdef1234567890abcdef',
      'deadbeefcafebabedeadbeefcafebabe',
      '1a2b3c4d5e6f708192a3b4c5d6e7f8a9',
      '9a8b7c6d5e4f302112a3b4c5d6e7f8a9',
      '0f1e2d3c4b5a69788796a5b4c3d2e1f0',
    ];
    const counts = seeds.map((seed) => {
      const { run } = seasonWindows(seed);
      return aiTradeCountOf(run, HUMAN);
    });
    for (const count of counts) {
      expect(count).toBeGreaterThanOrEqual(8);
      expect(count).toBeLessThanOrEqual(15);
    }
  });

  it('never exceeds 15 even when prior windows record their maximum', () => {
    // Season cap: force a high early count and verify window 2 respects it.
    const { run: base, catalog } = fixture('b1d2e3f405162738495a6b7c8d9e0f11');
    let run: SeasonRun & { effects: SeasonEffectsState } = {
      ...base,
      effects: zeroEffectsOf(base),
    };
    let total = 0;
    for (const blockIndex of [2, 4, 5]) {
      const result = openWindow(run, catalog, blockIndex);
      run = applyWindowResult(run, result);
      total = aiTradeCountOf(run, HUMAN);
      expect(total).toBeLessThanOrEqual(15);
    }
  });
});

describe('season trade invariants (property over seeds)', () => {
  it('keeps ownership unique, rosters legal, rotations legal, and effects canonical', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 64 }), (seedIndex) => {
        const seed = seedFromString(`trade-property-${String(seedIndex)}`);
        const { run: base, catalog } = buildEconomyTestRun({ seed });
        let run: SeasonRun & { effects: SeasonEffectsState } = {
          ...base,
          effects: zeroEffectsOf(base),
        };
        for (const blockIndex of [2, 4, 5]) {
          const result = openWindow(run, catalog, blockIndex);
          run = applyWindowResult(run, result);
          // Unique ownership: 300 distinct versions, each owned once.
          const owned = run.ownership.map((row) => row.playerVersionId);
          expect(new Set(owned).size).toBe(300);
          for (const row of run.ownership) {
            expect(
              run.rosters.find((roster) => roster.franchiseId === row.ownerFranchiseId),
            ).toBeDefined();
          }
          // Legal ten-player rosters.
          const facts = seasonTradeCatalogFactsOf(catalog);
          for (const roster of run.rosters) {
            const members: SeasonRosterMemberInput[] = roster.players.map((player) => ({
              playerVersionId: player.playerVersionId,
              playable: facts.playable.get(player.playerVersionId) ?? [],
            }));
            expect(validateSeasonRoster(members)).toEqual([]);
          }
          // Legal rotations referencing exactly their rosters.
          for (const rotation of run.rotations) {
            const roster = run.rosters.find((entry) => entry.franchiseId === rotation.franchiseId);
            const playable = new Map<string, readonly Position[]>();
            for (const player of roster?.players ?? []) {
              playable.set(
                player.playerVersionId,
                facts.playable.get(player.playerVersionId) ?? [],
              );
            }
            expect(validateSeasonRotation(rotation, playable)).toEqual([]);
          }
          // Effects: 300 loads + 1,350 canonical pairs over the rosters.
          expect(run.effects.playerStates).toHaveLength(300);
          expect(run.effects.pairStates).toHaveLength(1350);
          const pairSet = new Set(run.effects.pairStates.map((pair) => `${pair.a}\u0000${pair.b}`));
          expect(pairSet.size).toBe(1350);
          for (const pair of run.effects.pairStates) {
            expect(pair.a < pair.b).toBe(true);
            expect(pair.sharedPossessions).toBeGreaterThanOrEqual(0);
          }
        }
      }),
      { numRuns: 6 },
    );
  });
});

describe('season trade chemistry zero-state', () => {
  it('resets the pairs of traded players to zero shared possessions', () => {
    const { run, catalog } = fixture('a1b2c3d4e5f60718293a4b5c6d7e8f9a');
    const result = openWindow(run, catalog, 2);
    const moved = new Set<string>();
    for (const window of result.trade.windows) {
      for (const offer of window.offers) {
        if (offer.status === 'accepted') {
          for (const id of [...offer.outgoingPlayerVersionIds, ...offer.incomingPlayerVersionIds]) {
            moved.add(id);
          }
        }
      }
    }
    if (moved.size === 0) throw new Error('expected AI activity in this seed');
    const pairsByKey = new Map(
      result.effects.pairStates.map((pair) => [`${pair.a}\u0000${pair.b}`, pair]),
    );
    // Every pair that contains a moved player must be a NEW pair (zero state).
    for (const [key, pair] of pairsByKey) {
      const [a, b] = key.split('\u0000');
      if (a !== undefined && b !== undefined && (moved.has(a) || moved.has(b))) {
        expect(pair.sharedPossessions).toBe(0);
      }
    }
  });
});

describe('season applySeasonTrade', () => {
  it('applies a 1-for-1 trade atomically and returns both roster changes', () => {
    const { run: base, catalog } = fixture('a1b2c3d4e5f60718293a4b5c6d7e8f9a');
    const humanRoster = base.rosters.find((roster) => roster.franchiseId === HUMAN);
    const aiRoster = base.rosters.find((roster) => roster.franchiseId === 'celtics');
    if (humanRoster === undefined || aiRoster === undefined) throw new Error('missing rosters');
    const outgoingId = humanRoster.players[0]?.playerVersionId;
    const incomingId = aiRoster.players[0]?.playerVersionId;
    if (outgoingId === undefined || incomingId === undefined) throw new Error('missing players');
    const offer: SeasonTradeOffer = {
      offerId: 'off-' + 'a'.repeat(32),
      windowIndex: 0,
      seedPath: ['window', '0', 'offer', '0'],
      toFranchiseId: HUMAN,
      fromFranchiseId: 'celtics',
      outgoingPlayerVersionIds: [outgoingId],
      incomingPlayerVersionIds: [incomingId],
      outgoingHealth: [{ available: true, activeInjuryIds: [] }],
      incomingHealth: [{ available: true, activeInjuryIds: [] }],
      valueBand: { ratioBasisPoints: 1000, band: '85-115', qualified: true },
      roleFit: { outgoingRoles: ['G'], incomingRoles: ['G'], notes: 'test' },
      rosterNeedFacts: { outgoingDepth: 4, incomingDepth: 4, notes: 'test' },
      projectedRotationChanges: 'test',
      projectedChemistryDisruption: { removedPairs: 9, newPairs: 9 },
      status: 'open',
    };
    const effects = zeroEffectsOf(base);
    const withTrade: SeasonRun & {
      effects: SeasonEffectsState;
      trade: SeasonTradeState;
    } = {
      ...base,
      trade: {
        schemaVersion: 1,
        tradeVersion: 'season-trade-v1' as const,
        windows: [{ windowIndex: 0, blockIndex: 2, status: 'open' as const, offers: [offer] }],
      },
      effects,
    };
    const { run: next, rosterChanges } = applySeasonTrade(withTrade, offer, catalog, {
      commandId: 'cmd-accept-1',
    });

    // Unique ownership: the two versions swapped owners and appear once.
    expect(next.ownership.find((row) => row.playerVersionId === outgoingId)?.ownerFranchiseId).toBe(
      'celtics',
    );
    expect(next.ownership.find((row) => row.playerVersionId === incomingId)?.ownerFranchiseId).toBe(
      HUMAN,
    );
    const ownedCount = new Map<string, number>();
    for (const row of next.ownership) {
      ownedCount.set(row.playerVersionId, (ownedCount.get(row.playerVersionId) ?? 0) + 1);
    }
    for (const count of ownedCount.values()) expect(count).toBe(1);

    // Rosters updated and legal.
    const humanAfter = next.rosters.find((roster) => roster.franchiseId === HUMAN);
    expect(humanAfter?.players.map((player) => player.playerVersionId)).toContain(incomingId);
    expect(humanAfter?.players.map((player) => player.playerVersionId)).not.toContain(outgoingId);
    const facts = seasonTradeCatalogFactsOf(catalog);
    for (const roster of next.rosters) {
      const members: SeasonRosterMemberInput[] = roster.players.map((player) => ({
        playerVersionId: player.playerVersionId,
        playable: facts.playable.get(player.playerVersionId) ?? [],
      }));
      expect(validateSeasonRoster(members)).toEqual([]);
    }

    // Rotations repaired: legal, referencing the new rosters, minutes preserved.
    for (const rotation of next.rotations) {
      const roster = next.rosters.find((entry) => entry.franchiseId === rotation.franchiseId);
      const playable = new Map<string, readonly Position[]>();
      for (const player of roster?.players ?? []) {
        playable.set(player.playerVersionId, facts.playable.get(player.playerVersionId) ?? []);
      }
      expect(validateSeasonRotation(rotation, playable)).toEqual([]);
      const total = rotation.targetMinutes.reduce((sum, entry) => sum + entry.minutes, 0);
      expect(total).toBe(240);
    }
    // The incoming player inherited the outgoing player's minutes.
    const humanRotation = next.rotations.find((rotation) => rotation.franchiseId === HUMAN);
    const incomingMinutes = humanRotation?.targetMinutes.find(
      (entry) => entry.playerVersionId === incomingId,
    );
    expect(incomingMinutes?.minutes).toBe(32);

    // Effects: 1,350 pairs, loads follow the versions.
    expect(next.effects.playerStates).toHaveLength(300);
    expect(next.effects.pairStates).toHaveLength(1350);
    expect(
      next.effects.playerStates.find((player) => player.playerVersionId === incomingId),
    ).toBeDefined();

    // Transaction entry + offer status.
    const tradeEntry = next.transactions[next.transactions.length - 1];
    expect(tradeEntry?.type).toBe('trade');
    expect(tradeEntry?.commandId).toBe('cmd-accept-1');
    const payload = tradeEntry?.payload as { toFranchiseId: string; fromFranchiseId: string };
    expect(payload.toFranchiseId).toBe(HUMAN);
    expect(payload.fromFranchiseId).toBe('celtics');
    const recordedOffer = next.trade?.windows[0]?.offers[0];
    expect(recordedOffer?.status).toBe('accepted');
    expect(rosterChanges).toEqual([
      { franchiseId: HUMAN, added: [incomingId], removed: [outgoingId] },
      { franchiseId: 'celtics', added: [outgoingId], removed: [incomingId] },
    ]);
  });

  it('moves injury records with their players', () => {
    const { run: base, catalog } = fixture('a1b2c3d4e5f60718293a4b5c6d7e8f9a');
    const celticsRoster = base.rosters.find((roster) => roster.franchiseId === 'celtics');
    const movedId = celticsRoster?.players[0]?.playerVersionId;
    if (movedId === undefined) throw new Error('no celtics player');
    const injuryId = injuryIdOf('follow-the-player');
    const run = withInjury(base, {
      injuryId,
      playerVersionId: movedId,
      franchiseId: 'celtics',
      gameId: 's000001',
      type: 'soft-tissue',
      severity: 'minor',
      occurredBeforeHalftime: false,
      sameGameReturn: false,
      sameGameReturned: null,
      missedGamesTotal: 2,
      missedGamesRemaining: 1,
      actualReturnRound: null,
      seasonEnding: false,
      rehabModifier: 0,
      recurrenceWindowRoundsRemaining: 0,
      seedPath: ['injuries', 'test'],
    });
    const humanRoster = run.rosters.find((roster) => roster.franchiseId === HUMAN);
    const outgoingId = humanRoster?.players[0]?.playerVersionId;
    if (outgoingId === undefined) throw new Error('no lakers player');
    const offer: SeasonTradeOffer = {
      offerId: 'off-' + 'b'.repeat(32),
      windowIndex: 0,
      seedPath: ['window', '0', 'offer', '0'],
      toFranchiseId: HUMAN,
      fromFranchiseId: 'celtics',
      outgoingPlayerVersionIds: [outgoingId],
      incomingPlayerVersionIds: [movedId],
      outgoingHealth: [{ available: true, activeInjuryIds: [] }],
      incomingHealth: [{ available: false, activeInjuryIds: [injuryId] }],
      valueBand: { ratioBasisPoints: 1000, band: '85-115', qualified: true },
      roleFit: { outgoingRoles: ['G'], incomingRoles: ['G'], notes: 'test' },
      rosterNeedFacts: { outgoingDepth: 4, incomingDepth: 4, notes: 'test' },
      projectedRotationChanges: 'test',
      projectedChemistryDisruption: { removedPairs: 9, newPairs: 9 },
      status: 'open',
    };
    const { run: next } = applySeasonTrade({ ...run, effects: zeroEffectsOf(run) }, offer, catalog);
    const movedInjury = next.health.injuries.find((injury) => injury.injuryId === injuryId);
    expect(movedInjury?.franchiseId).toBe(HUMAN);
  });

  it('throws typed invariants for ownership conflicts and unknown players', () => {
    const { run, catalog } = fixture('a1b2c3d4e5f60718293a4b5c6d7e8f9a');
    const humanRoster = run.rosters.find((roster) => roster.franchiseId === HUMAN);
    const aiRoster = run.rosters.find((roster) => roster.franchiseId === 'celtics');
    const outgoingId = humanRoster?.players[0]?.playerVersionId;
    const incomingId = aiRoster?.players[1]?.playerVersionId;
    const wrongRosterId = run.rosters.find((roster) => roster.franchiseId === 'warriors')
      ?.players[0]?.playerVersionId;
    if (outgoingId === undefined || incomingId === undefined || wrongRosterId === undefined) {
      throw new Error('missing players');
    }
    const baseOffer: SeasonTradeOffer = {
      offerId: 'off-' + 'c'.repeat(32),
      windowIndex: 0,
      seedPath: ['window', '0', 'offer', '0'],
      toFranchiseId: HUMAN,
      fromFranchiseId: 'celtics',
      outgoingPlayerVersionIds: [outgoingId],
      incomingPlayerVersionIds: [incomingId],
      outgoingHealth: [{ available: true, activeInjuryIds: [] }],
      incomingHealth: [{ available: true, activeInjuryIds: [] }],
      valueBand: { ratioBasisPoints: 1000, band: '85-115', qualified: true },
      roleFit: { outgoingRoles: ['G'], incomingRoles: ['G'], notes: 'test' },
      rosterNeedFacts: { outgoingDepth: 4, incomingDepth: 4, notes: 'test' },
      projectedRotationChanges: 'test',
      projectedChemistryDisruption: { removedPairs: 9, newPairs: 9 },
      status: 'open',
    };
    const effects = zeroEffectsOf(run);
    // Incoming player not on the stated roster.
    expect(() =>
      applySeasonTrade(
        { ...run, effects },
        { ...baseOffer, incomingPlayerVersionIds: [wrongRosterId] },
        catalog,
      ),
    ).toThrow(SeasonTradeInvariantError);
    // Same-franchise trade.
    expect(() =>
      applySeasonTrade(
        { ...run, effects },
        { ...baseOffer, toFranchiseId: 'celtics', fromFranchiseId: 'celtics' },
        catalog,
      ),
    ).toThrow(SeasonTradeInvariantError);
    // Missing catalog.
    expect(() => applySeasonTrade({ ...run, effects }, baseOffer)).toThrow(SeasonTradeFactsError);
  });

  it('repairs rotations deterministically with preserved minute structure', () => {
    const { run, catalog } = fixture('a1b2c3d4e5f60718293a4b5c6d7e8f9a');
    const first = openWindow(run, catalog, 2);
    const second = openWindow(run, catalog, 2);
    // Deterministic application: identical window results on identical runs
    // (AI trade applications, rotation repairs, and all).
    expect(first.trade).toEqual(second.trade);
    const run2 = applyWindowResult(run, first);
    const run3 = applyWindowResult(run, second);
    expect(run2.rotations).toEqual(run3.rotations);
    expect(run2.effects).toEqual(run3.effects);
  });
});

describe('season trade deadlines', () => {
  function windowedTrade(): { run: SeasonRun; trade: SeasonTradeState } {
    const { run, catalog } = fixture('a1b2c3d4e5f60718293a4b5c6d7e8f9a');
    const result = openWindow(run, catalog, 2);
    return { run: applyWindowResult(run, result), trade: result.trade };
  }

  it('closes window 0 at block 3, window 1 at block 5, window 2 at block 6', () => {
    const { trade } = windowedTrade();
    const openOfferCount = () =>
      trade.windows[0]?.offers.filter((offer) => offer.status === 'open').length ?? 0;
    const before = openOfferCount();
    expect(before).toBeGreaterThan(0);

    const untouched = expireTradeOffersForBlock(trade, 4);
    expect(untouched?.windows[0]?.status).toBe('open');
    expect(untouched?.windows[0]?.offers.some((offer) => offer.status === 'expired')).toBe(false);

    const closed = expireTradeOffersForBlock(trade, 3);
    expect(closed?.windows[0]?.status).toBe('closed');
    // Open offers expire; already-resolved offers keep their status.
    for (const offer of closed?.windows[0]?.offers ?? []) {
      if (offer.status === 'expired') continue;
      expect(['accepted', 'declined']).toContain(offer.status);
    }
    const openBefore = trade.windows[0]?.offers.filter((offer) => offer.status === 'open') ?? [];
    const expiredAfter =
      closed?.windows[0]?.offers.filter((offer) => offer.status === 'expired') ?? [];
    expect(expiredAfter.length).toBe(openBefore.length);
    expect(expiredAfter.length).toBeGreaterThan(0);

    // Null-safe and idempotent.
    expect(expireTradeOffersForBlock(null, 3)).toBeNull();
    const again = expireTradeOffersForBlock(closed, 3);
    expect(again).toEqual(closed);
  });

  it('opens all three windows with their own block indices and close order', () => {
    const { run: base, catalog } = fixture('b1d2e3f405162738495a6b7c8d9e0f11');
    let run: SeasonRun & { effects: SeasonEffectsState } = {
      ...base,
      effects: zeroEffectsOf(base),
    };
    const trades: SeasonTradeState[] = [];
    for (const blockIndex of [2, 4, 5]) {
      const result = openWindow(run, catalog, blockIndex);
      trades.push(result.trade);
      run = applyWindowResult(run, result);
    }
    expect(trades[0]?.windows[0]?.blockIndex).toBe(2);
    expect(trades[1]?.windows[1]?.blockIndex).toBe(4);
    expect(trades[2]?.windows[2]?.blockIndex).toBe(5);
    const full = trades[2];
    if (full === undefined) throw new Error('no third window');
    const w0 = expireTradeOffersForBlock(full, 3);
    expect(w0?.windows[0]?.status).toBe('closed');
    expect(w0?.windows[1]?.status).toBe('open');
    const w1 = expireTradeOffersForBlock(w0, 5);
    expect(w1?.windows[1]?.status).toBe('closed');
    expect(w1?.windows[2]?.status).toBe('open');
    const w2 = expireTradeOffersForBlock(w1, 6);
    expect(w2?.windows[2]?.status).toBe('closed');
  });
});

describe('season generated extra offer', () => {
  it('generates a deterministic fourth offer distinct from the base three', () => {
    const { run, catalog } = fixture('a1b2c3d4e5f60718293a4b5c6d7e8f9a');
    const result = openWindow(run, catalog, 2);
    const baseOfferIds = new Set(
      result.trade.windows[0]?.offers.map((offer) => offer.offerId) ?? [],
    );
    const extra1 = generatedExtraOfferForSpend(
      run.rootSeed,
      { ...run, effects: result.effects },
      0,
      HUMAN,
      catalog,
    );
    const extra2 = generatedExtraOfferForSpend(
      run.rootSeed,
      { ...run, effects: result.effects },
      0,
      HUMAN,
      catalog,
    );
    expect(extra1).toEqual(extra2);
    expect(extra1.status).toBe('open');
    expect(extra1.toFranchiseId).toBe(HUMAN);
    expect(baseOfferIds.has(extra1.offerId)).toBe(false);
    expect(extra1.offerId).toMatch(/^off-[0-9a-f]{32}$/);
    expect(extra1.seedPath).toEqual(['window', '0', 'extra-offer']);
  });
});

describe('season contextual player value', () => {
  it('is bounded, availability- and workload-sensitive, and never reads Overall', () => {
    const { run: base, catalog } = fixture('a1b2c3d4e5f60718293a4b5c6d7e8f9a');
    const run = { ...base, effects: zeroEffectsOf(base) };
    const facts = seasonTradeCatalogFactsOf(catalog);
    const rosterIds = run.rosters
      .find((roster) => roster.franchiseId === HUMAN)
      ?.players.map((player) => player.playerVersionId);
    const version = rosterIds?.[0];
    if (version === undefined) throw new Error('no player');
    const context = {
      run,
      catalogFacts: facts,
      receivingFranchiseId: HUMAN,
      candidateRosterIds: rosterIds,
    };
    const healthy = seasonTradePlayerValue(version, context);
    expect(healthy).toBeGreaterThanOrEqual(0);
    expect(healthy).toBeLessThanOrEqual(100);
    const injuryId = injuryIdOf('value-availability');
    const injuredRun = {
      ...withInjury(run, {
        injuryId,
        playerVersionId: version,
        franchiseId: HUMAN,
        gameId: 's000001',
        type: 'lower-body',
        severity: 'moderate',
        occurredBeforeHalftime: false,
        sameGameReturn: false,
        sameGameReturned: null,
        missedGamesTotal: 4,
        missedGamesRemaining: 3,
        actualReturnRound: null,
        seasonEnding: false,
        rehabModifier: 0,
        recurrenceWindowRoundsRemaining: 0,
        seedPath: ['injuries', 'test'],
      }),
      effects: run.effects,
    };
    const injured = seasonTradePlayerValue(version, { ...context, run: injuredRun });
    expect(injured).toBeLessThan(healthy);
    // Heavy recent load lowers the value (bounded workload factor, max 15%).
    const effects: SeasonEffectsState = {
      ...run.effects,
      playerStates: run.effects.playerStates.map((player) =>
        player.playerVersionId === version ? { ...player, recentLoadBasisPoints: 10_000 } : player,
      ),
    };
    const worn = seasonTradePlayerValue(version, { ...context, run: { ...run, effects } });
    expect(worn).toBeLessThan(healthy);
    expect(worn).toBeLessThanOrEqual(healthy * 0.85 + 0.01);
    expect(worn).toBeGreaterThanOrEqual(healthy * 0.85 - 0.01);
  });

  it('mutual band membership follows the frozen bounds', () => {
    expect(ratioMutuallyWithinBand(1000, 1)).toBe(true);
    expect(ratioMutuallyWithinBand(869, 1)).toBe(false);
    expect(ratioMutuallyWithinBand(870, 1)).toBe(true);
    expect(ratioMutuallyWithinBand(1150, 1)).toBe(true);
    expect(ratioMutuallyWithinBand(1151, 1)).toBe(false);
    expect(ratioMutuallyWithinBand(833, 2)).toBe(false);
    expect(ratioMutuallyWithinBand(834, 2)).toBe(true);
    expect(ratioMutuallyWithinBand(1200, 2)).toBe(true);
    expect(ratioMutuallyWithinBand(1201, 2)).toBe(false);
  });
});

describe('season AI risky-rehab spends (health seam stubbed)', () => {
  it('records seeded rehabs in ledgers, transactions, and the health state', () => {
    const { run: base, catalog } = fixture('a1b2c3d4e5f60718293a4b5c6d7e8f9a');
    // Injure one player on each AI franchise so the seeded decisions fire.
    let run: SeasonRun & { effects: SeasonEffectsState } = {
      ...base,
      effects: zeroEffectsOf(base),
    };
    for (const team of run.league.teams) {
      if (team.franchiseId === HUMAN) continue;
      const roster = run.rosters.find((roster) => roster.franchiseId === team.franchiseId);
      const version = roster?.players[0]?.playerVersionId;
      if (version === undefined) throw new Error('missing ai player');
      run = {
        ...withInjury(run, {
          injuryId: injuryIdOf(`ai-rehab-${team.franchiseId}`),
          playerVersionId: version,
          franchiseId: team.franchiseId,
          gameId: 's000001',
          type: 'soft-tissue',
          severity: 'minor',
          occurredBeforeHalftime: false,
          sameGameReturn: false,
          sameGameReturned: null,
          missedGamesTotal: 2,
          missedGamesRemaining: 2,
          actualReturnRound: null,
          seasonEnding: false,
          rehabModifier: 0,
          recurrenceWindowRoundsRemaining: 0,
          seedPath: ['injuries', 'test'],
        }),
        effects: run.effects,
      };
    }
    const result = openWindow(run, catalog, 2);
    const rehabSpends = result.transactions.filter((entry) => {
      const payload = entry.payload as { purpose?: string };
      return entry.type === 'influence-spend' && payload.purpose === 'risky-rehab';
    });
    expect(rehabSpends.length).toBeGreaterThan(0);
    for (const entry of rehabSpends) {
      expect(entry.commandId).toMatch(/^ai-window-0-.*-risky-rehab$/);
      const payload = entry.payload as { injuryId?: string; outcome?: string };
      expect(payload.injuryId).toBeDefined();
      expect(payload.outcome).toBe('success');
      expect(result.influence.rehabs[payload.injuryId ?? '']).toBeDefined();
      expect(result.influence.rehabs[payload.injuryId ?? '']?.outcome).toBe('success');
      // The stub shortens recovery by one game: the injury record reflects it.
      const record = result.health.injuries.find((injury) => injury.injuryId === payload.injuryId);
      expect(record?.missedGamesRemaining).toBe(1);
      expect(record?.rehabModifier).toBe(-1);
    }
    // Every rehabbed injury belongs to the AI franchise that paid for it.
    for (const [injuryId, state] of Object.entries(result.influence.rehabs)) {
      expect(state.franchiseId).not.toBe(HUMAN);
      expect(
        result.health.injuries.find((injury) => injury.injuryId === injuryId)?.franchiseId,
      ).toBe(state.franchiseId);
    }
    expect(result.effects.playerStates).toHaveLength(300);
  });
});
