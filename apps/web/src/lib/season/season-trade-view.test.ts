import { describe, expect, it } from 'vitest';
import type { SeasonRun, SeasonTradeOffer, SeasonTradeState } from '@hoop-rush/data-contracts';
import {
  openWindowOf,
  tradeOfferViewModel,
  tradeResolvedAt,
  windowBlockIndexOf,
} from './season-trade-view';

/**
 * M2.5 trade view-model tests (season-trade-v1): the open-window
 * derivation, offer presentation (names, value band, role fit, roster need,
 * rotation projection, chemistry disruption), and resolution labels. Runs
 * are minimal roster-bearing shapes; the view model only reads player
 * display names.
 */

const OFFER_ID = 'off-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

function offer(overrides: Partial<SeasonTradeOffer> = {}): SeasonTradeOffer {
  return {
    offerId: OFFER_ID,
    windowIndex: 0,
    seedPath: ['test', 'trades'],
    toFranchiseId: 'lakers',
    fromFranchiseId: 'celtics',
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
      franchiseId: 'lakers',
      players: [
        {
          playerVersionId: 'pv-00000000000000000000000000000000',
          playerId: 'p-1',
          franchiseId: 'lakers',
          eraId: '1990s',
          seasonKey: '1995-96',
          displayName: 'Magic',
        },
      ],
    },
    {
      franchiseId: 'celtics',
      players: [
        {
          playerVersionId: 'pv-11111111111111111111111111111111',
          playerId: 'p-2',
          franchiseId: 'celtics',
          eraId: '1980s',
          seasonKey: '1985-86',
          displayName: 'Larry',
        },
      ],
    },
  ];
  return {
    rosters,
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
      tradeVersion: 'season-trade-v1',
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
      tradeVersion: 'season-trade-v1',
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
    expect(vm.valueBandLabel).toContain('96%');
    expect(vm.valueBandLabel).toContain('85-115');
    expect(vm.roleFitNotes).toContain('two-guard');
    expect(vm.rosterNeedNotes).toContain('guard depth');
    expect(vm.rotationProjection).toContain('32 minutes');
    expect(vm.chemistryDisruption).toEqual({ removedPairs: 9, newPairs: 9 });
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
    expect(vm.valueBandLabel).toContain('2-for-2');
    expect(vm.valueBandLabel).toContain('outside band');
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
