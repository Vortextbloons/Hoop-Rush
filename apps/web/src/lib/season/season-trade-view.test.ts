import { describe, expect, it } from 'vitest';
import type { SeasonRun, SeasonTradeOffer, SeasonTradeState } from '@hoop-rush/data-contracts';
import {
  franchiseIdSchema,
  eraIdSchema,
  seasonKeySchema,
  playerIdSchema,
} from '@hoop-rush/data-contracts';
import {
  humanTradeOffersOf,
  openWindowOf,
  tradeOfferViewModel,
  tradeResolvedAt,
  windowBlockIndexOf,
} from './season-trade-view';
const OFFER_ID = 'off-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
function offer(overrides: Partial<SeasonTradeOffer> = {}): SeasonTradeOffer {
  return {
    offerId: OFFER_ID,
    windowIndex: 0,
    seedPath: ['test', 'trades'],
    toFranchiseId: franchiseIdSchema.parse('lakers'),
    fromFranchiseId: franchiseIdSchema.parse('celtics'),
    outgoingPlayerVersionIds: ['pv-00000000000000000000000000000000'],
    incomingPlayerVersionIds: ['pv-11111111111111111111111111111111'],
    outgoingHealth: [{ available: true, activeInjuryIds: [] }],
    incomingHealth: [
      { available: false, activeInjuryIds: ['inj-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'] },
    ],
    valueBand: { ratioBasisPoints: 960, band: '85-115', qualified: true },
    roleFit: {
      outgoingRoles: ['PG'],
      incomingRoles: ['SG'],
      notes: 'Replaces the starting point guard with a two-guard.',
    },
    rosterNeedFacts: { outgoingDepth: 3, incomingDepth: 2, notes: 'Adds guard depth.' },
    projectedRotationChanges: 'X moves to 32 minutes; Y drops to 18.',
    projectedChemistryDisruption: { removedPairs: 9, newPairs: 9 },
    status: 'open',
    ...overrides,
  };
}
function runWithRosters(): SeasonRun {
  const rosters = [
    {
      franchiseId: franchiseIdSchema.parse('lakers'),
      players: [
        {
          playerVersionId: 'pv-00000000000000000000000000000000',
          playerId: playerIdSchema.parse('p-1'),
          franchiseId: franchiseIdSchema.parse('lakers'),
          eraId: eraIdSchema.parse('1990s'),
          seasonKey: seasonKeySchema.parse('1995-96'),
          displayName: 'Magic',
        },
      ],
    },
    {
      franchiseId: franchiseIdSchema.parse('celtics'),
      players: [
        {
          playerVersionId: 'pv-11111111111111111111111111111111',
          playerId: playerIdSchema.parse('p-2'),
          franchiseId: franchiseIdSchema.parse('celtics'),
          eraId: eraIdSchema.parse('1980s'),
          seasonKey: seasonKeySchema.parse('1985-86'),
          displayName: 'Larry',
        },
      ],
    },
  ];
  return {
    rosters,
    rotations: [
      {
        franchiseId: franchiseIdSchema.parse('lakers'),
        starters: Array.from({ length: 5 }, () => 'pv-00000000000000000000000000000000'),
        benchOrder: Array.from({ length: 5 }, () => 'pv-00000000000000000000000000000000'),
        targetMinutes: [
          { playerVersionId: 'pv-00000000000000000000000000000000', minutes: 32 },
          ...Array.from({ length: 9 }, (_, index) => ({
            playerVersionId: `pv-fill-${String(index)}`,
            minutes: 23,
          })),
        ],
        closingFive: Array.from({ length: 5 }, () => 'pv-00000000000000000000000000000000'),
        rotationVersion: 'season-rotation-v3',
        minutePolicy: { policyVersion: 'minute-policy-v1', strategy: 'balanced' },
      },
    ],
  } as unknown as SeasonRun;
}
describe('windowBlockIndexOf', () => {
  it('maps windows to the accepted blocks that open them', () => {
    expect(windowBlockIndexOf(0)).toBe(2);
    expect(windowBlockIndexOf(1)).toBe(4);
    expect(windowBlockIndexOf(2)).toBe(5);
    expect(windowBlockIndexOf(3)).toBeNull();
  });
});
describe('openWindowOf', () => {
  it('returns the first open window', () => {
    const trade: SeasonTradeState = {
      schemaVersion: 1,
      tradeVersion: 'season-trade-v3',
      windows: [
        { windowIndex: 0, blockIndex: 2, status: 'closed', offers: [] },
        { windowIndex: 1, blockIndex: 4, status: 'open', offers: [] },
      ],
    };
    expect(openWindowOf(trade)?.windowIndex).toBe(1);
  });
  it('returns null for no trade state or no open window', () => {
    expect(openWindowOf(null)).toBeNull();
    const closed: SeasonTradeState = {
      schemaVersion: 1,
      tradeVersion: 'season-trade-v3',
      windows: [{ windowIndex: 0, blockIndex: 2, status: 'closed', offers: [] }],
    };
    expect(openWindowOf(closed)).toBeNull();
  });
});
describe('tradeOfferViewModel', () => {
  it('renders players, value band, rationale, and chemistry facts', () => {
    const vm = tradeOfferViewModel(offer(), runWithRosters(), null, (franchiseId: string) =>
      franchiseId === 'celtics' ? 'Boston Celtics' : franchiseId,
    );
    expect(vm.fromFranchiseName).toBe('Boston Celtics');
    expect(vm.outgoingPlayers[0]?.displayName).toBe('Magic');
    expect(vm.incomingPlayers[0]?.displayName).toBe('Larry');
    expect(vm.incomingPlayers[0]?.available).toBe(false);
    expect(vm.valueInsight.body).toContain('96%');
    expect(vm.roleFitInsight.body).toContain('Magic');
    expect(vm.roleFitInsight.body).toContain('Larry');
    expect(vm.rosterNeedInsight.body).toContain('2');
    expect(vm.rotationInsight.body).toContain('32 min');
    expect(vm.chemistryInsight.body).toContain('9');
    expect(vm.statusLabel).toBe('Open');
  });
  it('marks an unqualified band and a 2-for-2 window', () => {
    const twoForTwo = offer({
      outgoingPlayerVersionIds: [
        'pv-00000000000000000000000000000000',
        'pv-22222222222222222222222222222222',
      ],
      incomingPlayerVersionIds: [
        'pv-11111111111111111111111111111111',
        'pv-33333333333333333333333333333333',
      ],
      outgoingHealth: [
        { available: true, activeInjuryIds: [] },
        { available: true, activeInjuryIds: [] },
      ],
      incomingHealth: [
        { available: true, activeInjuryIds: [] },
        { available: true, activeInjuryIds: [] },
      ],
      valueBand: { ratioBasisPoints: 820, band: '80-120', qualified: false },
    });
    const vm = tradeOfferViewModel(twoForTwo, runWithRosters(), null, (id: string) => id);
    expect(vm.tradeSizeLabel).toBe('2-for-2');
    expect(vm.valueInsight.tone).toBe('caution');
    expect(vm.valueInsight.body).toContain('unusual');
  });
});
describe('humanTradeOffersOf', () => {
  it('returns only human-targeted offers in the open window', () => {
    const trade: SeasonTradeState = {
      schemaVersion: 1,
      tradeVersion: 'season-trade-v3',
      windows: [
        {
          windowIndex: 0,
          blockIndex: 2,
          status: 'open',
          offers: [
            offer({ offerId: 'off-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' }),
            offer({
              offerId: 'off-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
              toFranchiseId: franchiseIdSchema.parse('celtics'),
              fromFranchiseId: franchiseIdSchema.parse('lakers'),
              status: 'accepted',
            }),
          ],
        },
      ],
    };
    const human = humanTradeOffersOf(trade, 'lakers');
    expect(human).toHaveLength(1);
    expect(human[0]?.offerId).toBe('off-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
  });
});
describe('tradeResolvedAt', () => {
  it('describes open, accepted, declined, and expired offers', () => {
    expect(tradeResolvedAt(offer()).status).toBe('open');
    expect(tradeResolvedAt(offer({ status: 'accepted' })).label).toBe('Accepted');
    expect(tradeResolvedAt(offer({ status: 'declined' })).label).toBe('Declined');
    const expired = tradeResolvedAt(offer({ status: 'expired' }));
    expect(expired.label).toBe('Expired when block 3 locked');
    expect(expired.resolvedByBlockIndex).toBe(2);
  });
});
