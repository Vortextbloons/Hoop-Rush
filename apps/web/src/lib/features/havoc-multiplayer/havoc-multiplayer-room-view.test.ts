import { describe, expect, it } from 'vitest';
import {
  havocMultiplayerSeriesSnapshotSchema,
  seasonKeySchema,
  type HavocMultiplayerSeriesSnapshot,
} from '@hoop-rush/data-contracts';
import { buildHavocCard } from '@hoop-rush/test-fixtures';
import {
  havocMultiplayerCurrentGameNumber,
  havocMultiplayerGamecastSeries,
  havocMultiplayerLineupSlots,
  havocMultiplayerLocalSide,
  havocMultiplayerMvpPick,
  havocMultiplayerPhaseLabel,
  havocMultiplayerSecondsLeft,
  havocMultiplayerSeriesRows,
  havocMultiplayerStageIndex,
  havocMultiplayerVerificationOf,
} from './havoc-multiplayer-room-view';

const DIGEST = 'a'.repeat(32);

function buildSeries(): HavocMultiplayerSeriesSnapshot {
  return havocMultiplayerSeriesSnapshotSchema.parse({
    wins: { p1: 0, p2: 1 },
    games: [
      {
        gameNumber: 1,
        homeParticipantId: 'p1',
        awayParticipantId: 'p2',
        status: 'verified',
        winner: 'p2',
        inputDigest: DIGEST,
        resultDigest: DIGEST,
        tapeDigest: DIGEST,
      },
      {
        gameNumber: 2,
        homeParticipantId: 'p1',
        awayParticipantId: 'p2',
        status: 'scheduled',
        winner: null,
        inputDigest: null,
        resultDigest: null,
        tapeDigest: null,
      },
    ],
    champion: null,
  });
}

describe('havoc multiplayer room view helpers', () => {
  it('labels every phase and maps phases to the four stages', () => {
    expect(havocMultiplayerPhaseLabel('lobby')).toBe('Lobby');
    expect(havocMultiplayerPhaseLabel('drafting')).toBe('Draft');
    expect(havocMultiplayerPhaseLabel('lineup-showdown')).toBe('Lineups');
    expect(havocMultiplayerPhaseLabel('preparing-game')).toBe('Ready check');
    expect(havocMultiplayerPhaseLabel('broadcasting')).toBe('Broadcast');
    expect(havocMultiplayerPhaseLabel('game-results')).toBe('Game results');
    expect(havocMultiplayerPhaseLabel('championship')).toBe('Champion');
    expect(havocMultiplayerPhaseLabel('expired')).toBe('Room expired');
    expect(havocMultiplayerPhaseLabel('integrity-failed')).toBe('Result mismatch');

    expect(havocMultiplayerStageIndex('lobby')).toBe(0);
    expect(havocMultiplayerStageIndex('drafting')).toBe(1);
    expect(havocMultiplayerStageIndex('lineup-showdown')).toBe(1);
    expect(havocMultiplayerStageIndex('preparing-game')).toBe(2);
    expect(havocMultiplayerStageIndex('broadcasting')).toBe(2);
    expect(havocMultiplayerStageIndex('game-results')).toBe(2);
    expect(havocMultiplayerStageIndex('championship')).toBe(3);
    expect(havocMultiplayerStageIndex('expired')).toBe(2);
  });

  it('resolves verification status and countdown seconds', () => {
    const entries = [
      { gameNumber: 1, status: 'verified' as const },
      { gameNumber: 2, status: 'mismatch' as const },
    ];
    expect(havocMultiplayerVerificationOf(entries, 1)).toBe('verified');
    expect(havocMultiplayerVerificationOf(entries, 2)).toBe('mismatch');
    expect(havocMultiplayerVerificationOf(entries, 3)).toBe('pending');
    expect(havocMultiplayerVerificationOf(entries, null)).toBe('pending');
    expect(havocMultiplayerSecondsLeft(null)).toBeNull();
    expect(havocMultiplayerSecondsLeft(0)).toBe(0);
    expect(havocMultiplayerSecondsLeft(10_001)).toBe(11);
    expect(havocMultiplayerSecondsLeft(-5)).toBe(0);
  });

  it('adapts the havoc series to the gamecast tracker with decided games only', () => {
    const mapped = havocMultiplayerGamecastSeries(buildSeries());
    expect(mapped).not.toBeNull();
    expect(mapped?.games).toHaveLength(1);
    expect(mapped?.games[0]?.winner).toBe('p2');
    expect(mapped?.p1Wins).toBe(0);
    expect(mapped?.p2Wins).toBe(1);
    expect(mapped?.currentGameNumber).toBe(2);
    expect(mapped?.champion).toBeNull();
    expect(mapped?.homeWinner).toBe('p1');
    expect(havocMultiplayerGamecastSeries(null)).toBeNull();
    expect(havocMultiplayerCurrentGameNumber(buildSeries())).toBe(2);
    expect(havocMultiplayerCurrentGameNumber(null)).toBeNull();
  });

  it('maps local sides and per-game rows with scores from stored outputs', () => {
    const series = buildSeries();
    expect(havocMultiplayerLocalSide(series, 1, 'p2')).toBe('away');
    expect(havocMultiplayerLocalSide(series, 2, 'p2')).toBe('away');
    expect(havocMultiplayerLocalSide(series, 2, 'p1')).toBe('home');
    expect(havocMultiplayerLocalSide(null, 1, 'p1')).toBe('home');

    const rows = havocMultiplayerSeriesRows(
      series,
      { 1: { result: { home: { points: 88 }, away: { points: 95 } } } },
      'p2',
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]?.homeScore).toBe(88);
    expect(rows[0]?.awayScore).toBe(95);
    expect(rows[0]?.localWon).toBe(true);
    expect(rows[1]?.homeScore).toBeNull();
    expect(rows[1]?.localWon).toBeNull();
    expect(rows[0]?.localIsHome).toBe(false);
    expect(havocMultiplayerSeriesRows(null, {}, 'p1')).toEqual([]);
  });

  it('finds the drafted pick behind a series MVP', () => {
    const picks = [
      { participantId: 'p1' as const, slot: 'PG' as const, label: 'Marcus Webb' },
      { participantId: 'p2' as const, slot: 'SG' as const, label: 'Cameron Vale' },
    ];
    const mvp = havocMultiplayerMvpPick(picks, { participantId: 'p2', slot: 'SG', index: 41 });
    expect(mvp?.label).toBe('Cameron Vale');
    expect(havocMultiplayerMvpPick(picks, { participantId: 'p1', slot: 'C', index: 1 })).toBeNull();
    expect(havocMultiplayerMvpPick(picks, null)).toBeNull();
  });

  it('converts multiplayer draft picks into lineup slot views', () => {
    const card = buildHavocCard({ slot: 'PG' });
    const pick = {
      turnOrdinal: 0,
      participantId: 'p1' as const,
      slot: 'PG' as const,
      claimKey: {
        playerId: card.source.playerId,
        seasonKey: seasonKeySchema.parse(card.source.seasonKey ?? '1996-97'),
      },
      card,
    };
    const slots = havocMultiplayerLineupSlots([pick]);
    expect(slots).toHaveLength(1);
    expect(slots[0]?.slot).toBe('PG');
    expect(slots[0]?.displayName).toBe(card.source.displayName);
    expect(slots[0]?.tier).toBe(card.tier);
    expect(slots[0]?.overall).toBe(card.source.originalOverall);
    expect(slots[0]?.mutations).toEqual(card.mutations);
    expect(havocMultiplayerLineupSlots([])).toEqual([]);
  });
});
