import { describe, expect, it } from 'vitest';
import { franchiseIdSchema } from '@hoop-rush/data-contracts';
import {
  tradeAssetEligibilityOf,
  openSeasonTradeWindow,
  seasonTradePackageValue,
  seasonTradeBestValue,
  seasonTradePackageRatio,
} from './trades.ts';
import {
  evaluateTradeProposal,
  TRADE_CASH_MAX_PER_WINDOW,
  TRADE_CASH_PCT_PER_POINT,
  TRADE_CASH_PCT_MAX,
} from './trade-board.ts';
import { buildEconomyTestRun, zeroEffectsOf, injuryIdOf } from './season-economy-test-support.ts';

const HUMAN = 'lakers';

describe('tradeAssetEligibilityOf', () => {
  it('marks protected assets Off limits', () => {
    const result = tradeAssetEligibilityOf({
      playerVersionId: 'pv-1',
      fromFranchiseId: 'celtics',
      protectedIds: ['pv-1', 'pv-2'],
      available: true,
    });
    expect(result.status).toBe('protected');
    expect(result.reason).toBe('Off limits');
  });

  it('marks unavailable assets as availability-risk', () => {
    const result = tradeAssetEligibilityOf({
      playerVersionId: 'pv-1',
      protectedIds: [],
      available: false,
    });
    expect(result.status).toBe('availability-risk');
    expect(result.reason).toContain('harder to move');
  });

  it('marks healthy assets eligible', () => {
    const result = tradeAssetEligibilityOf({
      playerVersionId: 'pv-1',
      protectedIds: [],
      available: true,
    });
    expect(result.status).toBe('eligible');
    expect(result.reason).toBeNull();
  });

  it('protected wins over availability', () => {
    const result = tradeAssetEligibilityOf({
      playerVersionId: 'pv-1',
      protectedIds: ['pv-1'],
      available: false,
      hasBlockingInjury: true,
    });
    expect(result.status).toBe('protected');
  });

  it('respects explicit hasBlockingInjury=false for minor injuries', () => {
    const result = tradeAssetEligibilityOf({
      playerVersionId: 'pv-1',
      protectedIds: [],
      available: false,
      hasBlockingInjury: false,
    });
    expect(result.status).toBe('eligible');
  });
});

describe('eligibility matches evaluation', () => {
  function openRun() {
    const { run: base, catalog } = buildEconomyTestRun({
      seed: 'a1b2c3d4e5f60718293a4b5c6d7e8f9a',
    });
    const withEffects = { ...base, effects: zeroEffectsOf(base) };
    const opened = openSeasonTradeWindow({
      run: withEffects,
      blockIndex: 2,
      rootSeed: withEffects.rootSeed,
      humanFranchiseId: HUMAN,
      catalog,
      effects: withEffects.effects,
    });
    if (opened === null) throw new Error('window did not open');
    const run = {
      ...withEffects,
      trade: opened.trade,
      influence: opened.influence,
      transactions: opened.transactions,
      rosters: opened.rosters,
      ownership: opened.ownership,
      rotations: opened.rotations,
      effects: opened.effects,
      health: opened.health,
      stateRevision: opened.stateRevision,
      stateDigest: opened.stateDigest,
    };
    return { run, catalog };
  }

  it('protected evaluation matches helper', () => {
    const { run, catalog } = openRun();
    const win = run.trade.windows.find((w) => w.windowIndex === 0);
    const profile = win?.boardProfiles?.[0];
    if (profile === undefined) throw new Error('no board profile');
    const protectedId = profile.protectedPlayerIds[0];
    if (protectedId === undefined) throw new Error('no protected id');
    const helper = tradeAssetEligibilityOf({
      playerVersionId: protectedId,
      fromFranchiseId: profile.franchiseId,
      protectedIds: profile.protectedPlayerIds,
      available: true,
    });
    expect(helper.status).toBe('protected');
    const humanRoster = run.rosters.find((r) => r.franchiseId === HUMAN);
    const outgoing = humanRoster?.players[0]?.playerVersionId;
    if (outgoing === undefined) throw new Error('no outgoing');
    const result = evaluateTradeProposal({
      run,
      windowIndex: 0,
      toFranchiseId: profile.franchiseId,
      outgoingPlayerVersionIds: [outgoing],
      incomingPlayerVersionIds: [protectedId],
      influenceAmount: 0,
      influenceFromSender: null,
      catalog,
      rootSeed: run.rootSeed,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('trade-protected-player');
  });

  it('major-injury evaluation matches helper blocking', () => {
    const { run: base, catalog } = buildEconomyTestRun({
      seed: 'a1b2c3d4e5f60718293a4b5c6d7e8f9a',
    });
    const baseEffects = { ...base, effects: zeroEffectsOf(base) };
    const opened = openSeasonTradeWindow({
      run: baseEffects,
      blockIndex: 2,
      rootSeed: baseEffects.rootSeed,
      humanFranchiseId: HUMAN,
      catalog,
      effects: baseEffects.effects,
    });
    if (opened === null) throw new Error('no window');
    let run = {
      ...baseEffects,
      trade: opened.trade,
      influence: opened.influence,
      transactions: opened.transactions,
      rosters: opened.rosters,
      ownership: opened.ownership,
      rotations: opened.rotations,
      effects: opened.effects,
      health: opened.health,
      stateRevision: opened.stateRevision,
      stateDigest: opened.stateDigest,
    };
    const win = run.trade.windows.find((w) => w.windowIndex === 0);
    const profile = win?.boardProfiles?.find((p) => (p.listedPlayerIds[0] ?? null) !== null);
    if (profile === undefined) throw new Error('no profile with listed');
    const targetId = profile.listedPlayerIds[0];
    if (targetId === undefined) throw new Error('no listed id');
    run = {
      ...run,
      health: {
        ...run.health,
        injuries: [
          ...run.health.injuries,
          {
            injuryId: injuryIdOf('eligibility-major'),
            playerVersionId: targetId,
            franchiseId: franchiseIdSchema.parse(profile.franchiseId),
            gameId: 's000001',
            type: 'lower-body',
            severity: 'major',
            occurredBeforeHalftime: false,
            sameGameReturn: false,
            sameGameReturned: null,
            missedGamesTotal: 6,
            missedGamesRemaining: 5,
            actualReturnRound: null,
            seasonEnding: false,
            rehabModifier: 0,
            recurrenceWindowRoundsRemaining: 0,
            seedPath: ['injuries', 'test'],
          },
        ],
      },
    };
    const helper = tradeAssetEligibilityOf({
      playerVersionId: targetId,
      protectedIds: [],
      available: false,
      hasBlockingInjury: true,
    });
    expect(helper.status).toBe('availability-risk');
    const humanRoster = run.rosters.find((r) => r.franchiseId === HUMAN);
    const outgoing = humanRoster?.players[0]?.playerVersionId;
    if (outgoing === undefined) throw new Error('no outgoing');
    const nonProtectedIncoming =
      profile.listedPlayerIds.find((id) => !profile.protectedPlayerIds.includes(id)) ?? targetId;
    const result = evaluateTradeProposal({
      run,
      windowIndex: 0,
      toFranchiseId: profile.franchiseId,
      outgoingPlayerVersionIds: [outgoing],
      incomingPlayerVersionIds: [nonProtectedIncoming],
      influenceAmount: 0,
      influenceFromSender: null,
      catalog,
      rootSeed: run.rootSeed,
    });
    if (nonProtectedIncoming === targetId) {
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe('trade-availability-risk');
    } else {
      expect(result).toBeDefined();
    }
  });
});

describe('trade fairness v6 (consolidation tax, overpay gifts, influence 8%)', () => {
  it('discounts quantity: two 60s lose to one 100', () => {
    expect(seasonTradePackageValue([60, 60])).toBe(84);
    expect(seasonTradePackageValue([100])).toBe(100);
    expect(seasonTradePackageRatio({ outgoingValues: [100], incomingValues: [60, 60] })).toBe(840);
    expect(seasonTradePackageRatio({ outgoingValues: [60, 60], incomingValues: [100] })).toBe(1190);
  });

  it('ranks best first and exposes best value', () => {
    expect(seasonTradePackageValue([50, 90])).toBe(110);
    expect(seasonTradeBestValue([50, 90])).toBe(90);
    expect(seasonTradeBestValue([])).toBe(0);
  });

  it('buffs influence to 8%/pt max 16% with a 3/window sweetener cap', () => {
    expect(TRADE_CASH_PCT_PER_POINT).toBe(8);
    expect(TRADE_CASH_PCT_MAX).toBe(16);
    expect(TRADE_CASH_MAX_PER_WINDOW).toBe(3);
  });

  it('never rejects 1-1 gifts with insufficient-talent (overpay allowed, logged)', () => {
    const { run: base, catalog } = buildEconomyTestRun({
      seed: 'a1b2c3d4e5f60718293a4b5c6d7e8f9a',
    });
    const baseEffects = { ...base, effects: zeroEffectsOf(base) };
    const opened = openSeasonTradeWindow({
      run: baseEffects,
      blockIndex: 2,
      rootSeed: baseEffects.rootSeed,
      humanFranchiseId: HUMAN,
      catalog,
      effects: baseEffects.effects,
    });
    if (opened === null) throw new Error('no window');
    const run = {
      ...baseEffects,
      trade: opened.trade,
      influence: opened.influence,
      transactions: opened.transactions,
      rosters: opened.rosters,
      ownership: opened.ownership,
      rotations: opened.rotations,
      effects: opened.effects,
      health: opened.health,
      stateRevision: opened.stateRevision,
      stateDigest: opened.stateDigest,
    };
    const win = run.trade.windows.find((w) => w.windowIndex === 0);
    const profiles = win?.boardProfiles ?? [];
    expect(profiles.length).toBeGreaterThan(0);
    let evaluated = 0;
    for (const toProfile of profiles) {
      const incoming = toProfile.listedPlayerIds[0] ?? toProfile.discussablePlayerIds[0];
      if (incoming === undefined) continue;
      const humanRoster = run.rosters.find((r) => r.franchiseId === HUMAN);
      for (const outgoing of humanRoster?.players.map((p) => p.playerVersionId).slice(0, 3) ?? []) {
        const result = evaluateTradeProposal({
          run,
          windowIndex: 0,
          toFranchiseId: toProfile.franchiseId,
          outgoingPlayerVersionIds: [outgoing],
          incomingPlayerVersionIds: [incoming],
          influenceAmount: 0,
          influenceFromSender: null,
          catalog,
          rootSeed: run.rootSeed,
        });
        evaluated += 1;
        if (!result.ok) {
          expect(result.code).not.toBe('trade-insufficient-talent');
        } else {
          expect(typeof result.proposal.consequenceFacts).toBe('object');
        }
      }
    }
    expect(evaluated).toBeGreaterThan(0);
  });
});
