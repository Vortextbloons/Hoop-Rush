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
