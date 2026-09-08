import { describe, expect, it } from 'vitest';
import type { CollectionCatalogCard } from '@hoop-rush/data-contracts';
import { buildCollectionFixtureCard } from '@hoop-rush/test-fixtures';
import {
  balanceDraftMinutes,
  blockedCardIds,
  buildAutoDraft,
  checkDraft,
  draftFromTeam,
  draftRoster,
  emptyDraft,
  firstValidationMessage,
  minutesTotal,
  slotEligibility,
} from './collection-team-utils.ts';

function card(
  playerId: string,
  positions: CollectionCatalogCard['positions'],
  overall = 60,
): CollectionCatalogCard {
  return buildCollectionFixtureCard(playerId, {
    playerId: playerId as CollectionCatalogCard['playerId'],
    positions,
    summarySource: { overallRating: overall, offenseRating: overall, defenseRating: overall },
  });
}

const ROSTER = [
  card('t-pg', ['PG'], 70),
  card('t-sg', ['SG'], 68),
  card('t-sf', ['SF'], 66),
  card('t-pf', ['PF'], 64),
  card('t-c', ['C'], 62),
  card('t-b1', ['PG', 'SG'], 61),
  card('t-b2', ['SF', 'PF'], 60),
];
const BY_ID = new Map(ROSTER.map((entry) => [entry.cardId, entry]));
const OWNED = new Set(BY_ID.keys());
const resolve = (cardId: string) => BY_ID.get(cardId);

describe('collection team utils', () => {
  it('builds a valid auto draft from ownership', () => {
    const draft = buildAutoDraft([...OWNED], resolve);
    expect(draftRoster(draft)).toHaveLength(7);
    const check = checkDraft(draft, resolve, OWNED);
    expect(check.ok).toBe(true);
    expect(firstValidationMessage(check, draft)).toBeNull();
    expect(minutesTotal(draft)).toBe(240);
  });

  it('reports one actionable message for an empty draft', () => {
    const draft = emptyDraft();
    const message = firstValidationMessage(checkDraft(draft, resolve, OWNED), draft);
    expect(message).toContain('five');
  });

  it('flags minute totals and duplicate canonical players', () => {
    const draft = buildAutoDraft([...OWNED], resolve);
    const short = {
      ...draft,
      minutes: Object.fromEntries(draftRoster(draft).map((cardId) => [cardId, 10])),
    };
    expect(firstValidationMessage(checkDraft(short, resolve, OWNED), short)).toContain('240');

    const alt = card('t-pg-alt', ['SG'], 65);
    (alt as { playerId: string }).playerId = 't-pg';
    const withDup = {
      ...draft,
      bench: [...draft.bench, alt.cardId],
      minutes: { ...draft.minutes, [alt.cardId]: 0 },
    };
    const byIdWithAlt = new Map([...BY_ID, [alt.cardId, alt]]);
    const resolveWithAlt = (cardId: string) => byIdWithAlt.get(cardId);
    const blocked = blockedCardIds(draft, resolveWithAlt, [alt.cardId]);
    expect(blocked.get(alt.cardId)).toContain('Another version');
    expect(
      firstValidationMessage(
        checkDraft(withDup, (cardId) => byIdWithAlt.get(cardId), new Set([...OWNED, alt.cardId])),
        withDup,
      ),
    ).toContain('same player');
  });

  it('balances minutes to exactly 240 starter-heavy', () => {
    const draft = buildAutoDraft([...OWNED], resolve);
    const zeroed = { ...draft, minutes: {} };
    const balanced = balanceDraftMinutes(zeroed);
    expect(minutesTotal(balanced)).toBe(240);
    expect(firstValidationMessage(checkDraft(balanced, resolve, OWNED), balanced)).toBeNull();
  });

  it('computes slot eligibility from positions', () => {
    expect(slotEligibility(['PG'], 0)).toBe(true);
    expect(slotEligibility(['PG'], 4)).toBe(false);
    expect(slotEligibility(['C'], 4)).toBe(true);
    expect(slotEligibility(['SF', 'PF'], 2)).toBe(true);
    expect(slotEligibility(['SF', 'PF'], 0)).toBe(false);
  });

  it('round-trips a committed team through the draft', () => {
    const draft = buildAutoDraft([...OWNED], resolve);
    const again = draftFromTeam({
      teamVersion: 'collection-team-v1',
      starters: draft.starters.filter((cardId): cardId is string => cardId !== null),
      bench: [...draft.bench],
      targetMinutes: draftRoster(draft).map((cardId) => ({
        cardId,
        minutes: draft.minutes[cardId] ?? 0,
      })),
    });
    expect(again).toEqual(draft);
  });
});
