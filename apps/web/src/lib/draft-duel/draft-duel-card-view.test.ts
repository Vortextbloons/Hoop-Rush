import { describe, expect, it } from 'vitest';
import { OVERALL_BANDS, draftDuelCardSchema, type DraftDuelCard } from '@hoop-rush/data-contracts';
import { draftDuelBandLabel, draftDuelCardView } from './draft-duel-card-view.ts';

function cardFixture(overrides: Partial<DraftDuelCard> = {}): DraftDuelCard {
  return draftDuelCardSchema.parse({
    cardId: 'card-00000000000000000000000000000001',
    playerId: 'alpha-1980',
    playerVersionId: 'pv-00000000000000000000000000000001',
    displayName: 'Alpha Player',
    seasonKey: '1980-81',
    franchiseId: 'lakers',
    eraId: '1980s',
    positions: ['PG', 'SG'],
    overall: 88,
    bandIndex: 3,
    ...overrides,
  });
}

describe('draftDuelCardView', () => {
  it('exposes overall, band label, and elite flag in ratings mode', () => {
    const view = draftDuelCardView(cardFixture({ overall: 97, bandIndex: 0 }), 'ratings');
    expect(view.overall).toBe(97);
    expect(view.bandLabel).toBe('97-99');
    expect(view.elite).toBe(true);
    expect(view.strengthHidden).toBe(false);
  });

  it('leaves sub-95 cards unflagged while still reporting their band', () => {
    const view = draftDuelCardView(cardFixture({ overall: 88, bandIndex: 3 }), 'ratings');
    expect(view.overall).toBe(88);
    expect(view.bandLabel).toBe('86-89');
    expect(view.elite).toBe(false);
    expect(view.strengthHidden).toBe(false);
  });

  it('hides every strength field in ball-knowledge mode', () => {
    const view = draftDuelCardView(cardFixture({ overall: 88, bandIndex: 3 }), 'ball-knowledge');
    expect(view.overall).toBeNull();
    expect(view.bandLabel).toBeNull();
    expect(view.elite).toBe(false);
    expect(view.strengthHidden).toBe(true);
    expect(view.displayName).toBe('Alpha Player');
    expect(view.seasonKey).toBe('1980-81');
    const serialized = JSON.stringify(view);
    expect(serialized).not.toContain('"overall":88');
    expect(serialized).not.toContain('"bandLabel":"86-89"');
    expect(serialized).not.toContain('"elite":true');
    expect(serialized).not.toContain('86-89');
    expect(serialized).not.toContain('bandIndex');
  });

  it('maps band index to the published overall band labels', () => {
    OVERALL_BANDS.forEach((band, index) => {
      expect(draftDuelBandLabel(cardFixture({ bandIndex: index }))).toBe(band.label);
    });
    expect(draftDuelBandLabel(cardFixture({ bandIndex: 0 }))).toBe('97-99');
    expect(draftDuelBandLabel(cardFixture({ bandIndex: 9 }))).toBe('40-64');
  });

  it('passes the position list through unchanged', () => {
    const ratings = draftDuelCardView(cardFixture({ positions: ['C', 'PG'] }), 'ratings');
    expect(ratings.positions).toEqual(['C', 'PG']);
    const hidden = draftDuelCardView(cardFixture({ positions: ['SF'] }), 'ball-knowledge');
    expect(hidden.positions).toEqual(['SF']);
  });
});
