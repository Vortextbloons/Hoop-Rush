import { describe, expect, it } from 'vitest';
import {
  chemistryFootnote,
  humanizeTradeRejection,
  packageConsequenceFacts,
  tradeTalksLabel,
  inquiryCounterLabel,
} from './season-presentation';

describe('tradeTalksLabel', () => {
  it('shows talks left', () => {
    expect(tradeTalksLabel(3, 1)).toBe('2 talks left');
    expect(tradeTalksLabel(3, 2)).toBe('1 talk left');
  });
  it('shows no-talks with purchase hint', () => {
    expect(tradeTalksLabel(3, 3)).toBe('No talks left — +1 for 1◆ or wait.');
  });
  it('keeps diagnostics helper for logs', () => {
    expect(inquiryCounterLabel(3, 1, false, false)).toContain('1/3 used');
  });
});

describe('humanizeTradeRejection', () => {
  it('maps protected to Off limits', () => {
    expect(
      humanizeTradeRejection('trade-protected-player: pv-abc protected', {
        playerNameOf: () => 'Star',
        franchiseNameOf: (id) => id,
      }),
    ).toBe('Off limits.');
  });
  it('maps close-needs-more-value', () => {
    expect(humanizeTradeRejection('close-needs-more-value')).toBe('They want more value.');
  });
  it('maps duplicate to Already sent', () => {
    expect(humanizeTradeRejection('trade-duplicate-proposal fingerprint abc|def')).toBe(
      'Already sent this exact deal.',
    );
  });
  it('hides ids and fingerprints', () => {
    const out = humanizeTradeRejection(
      'Something failed for prop-abcdef1234567890abcdef1234567890 at revision 12',
      {},
    );
    expect(out).not.toContain('prop-abcdef');
    expect(out).not.toContain('revision 12');
  });
  it('returns null for null', () => {
    expect(humanizeTradeRejection(null)).toBeNull();
  });
  it('names the over-ask with magnitude for a blown 1-for-1', () => {
    expect(
      humanizeTradeRejection('trade-wrong-fit: ratio 1284 outside band', {
        tradeFit: {
          outgoingCount: 1,
          incomingCount: 1,
          toFranchiseName: 'Celtics',
          attemptNumber: 0,
        },
      }),
    ).toBe(
      "Celtics turned it down — you're asking for about 28% more than you're sending. Balance the value and try again.",
    );
  });
  it('softens to nearly-yes when close to the band', () => {
    expect(
      humanizeTradeRejection('trade-wrong-fit: ratio 1180 outside band', {
        tradeFit: { outgoingCount: 1, incomingCount: 1, toFranchiseName: 'Celtics' },
      }),
    ).toContain('nearly said yes');
  });
  it('bluntens repeat rejections without inventing facts', () => {
    const out = humanizeTradeRejection('trade-wrong-fit: ratio 1284 outside band', {
      tradeFit: {
        outgoingCount: 1,
        incomingCount: 1,
        toFranchiseName: 'Celtics',
        attemptNumber: 2,
      },
    });
    expect(out).toContain('Still no from Celtics');
    expect(out).toContain('28%');
    expect(out).not.toContain('1284');
  });
  it('falls back to a mix message without fit context', () => {
    expect(humanizeTradeRejection('trade-wrong-fit: something off')).toBe(
      "They passed — the mix isn't right for their roster. Shuffle the pieces and try again.",
    );
  });
  it('routes under-band fits to your own staff, not the partner', () => {
    expect(
      humanizeTradeRejection('trade-wrong-fit: ratio 820 outside band', {
        tradeFit: { outgoingCount: 1, incomingCount: 1 },
      }),
    ).toContain('Your staff pumped the brakes');
  });
  it('routes overpay rejections to your own staff with magnitude', () => {
    const out = humanizeTradeRejection('trade-insufficient-talent: ratio 700 < 800', {});
    expect(out).toContain('Your staff pumped the brakes');
    expect(out).toContain('30%');
    expect(out).not.toContain('700');
  });
});

describe('packageConsequenceFacts', () => {
  it('validates roster sizes 10-15 live', () => {
    const facts = packageConsequenceFacts({
      fromRosterSize: 12,
      toRosterSize: 12,
      outgoingIds: ['a'],
      incomingIds: ['b'],
      outgoingAvailable: [true],
      incomingAvailable: [true],
      influenceAmount: 0,
      influenceFromSender: null,
      humanFranchiseId: 'lakers',
      toFranchiseId: 'celtics',
    });
    expect(facts.fromAfter).toBe(12);
    expect(facts.toAfter).toBe(12);
    expect(facts.legal).toBe(true);
  });
  it('flags illegal roster sizes', () => {
    const facts = packageConsequenceFacts({
      fromRosterSize: 10,
      toRosterSize: 15,
      outgoingIds: ['a', 'b'],
      incomingIds: ['c'],
      outgoingAvailable: [true, true],
      incomingAvailable: [true],
      influenceAmount: 0,
      influenceFromSender: null,
      humanFranchiseId: 'lakers',
      toFranchiseId: 'celtics',
    });
    expect(facts.fromAfter).toBe(9);
    expect(facts.legal).toBe(false);
  });
  it('simplifies influence note without math', () => {
    const facts = packageConsequenceFacts({
      fromRosterSize: 12,
      toRosterSize: 12,
      outgoingIds: ['a'],
      incomingIds: ['b'],
      outgoingAvailable: [true],
      incomingAvailable: [true],
      influenceAmount: 1,
      influenceFromSender: 'lakers',
      humanFranchiseId: 'lakers',
      toFranchiseId: 'celtics',
    });
    expect(facts.influenceNote).not.toContain('5%');
    expect(facts.influenceNote).not.toContain('Floor');
    expect(facts.influenceNote).toContain('you');
  });
  it('simplifies chemistry footnote', () => {
    expect(chemistryFootnote(9, 9)).toBe('New teammates start neutral.');
  });
});
