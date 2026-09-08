import { describe, expect, it } from 'vitest';
import type { CollectionGameEvent, CollectionGameRecord } from '@hoop-rush/data-contracts';
import {
  cadenceFor,
  clockLabel,
  eventLabel,
  explanationFacts,
  visibleEvents,
} from './collection-gamecast.ts';

function possession(
  eventOrder: number,
  homeScore: number,
  awayScore: number,
  pointsScored: number,
): CollectionGameEvent {
  return {
    eventOrder,
    kind: 'possession',
    period: 1,
    secondsRemaining: 600,
    homeScore,
    awayScore,
    possessionNumber: eventOrder + 1,
    offenseSide: 'home',
    pointsScored,
    participantCardIds: [],
    statDeltas: [],
  };
}

const EVENTS: CollectionGameEvent[] = [
  possession(0, 2, 0, 2),
  possession(1, 2, 2, 2),
  possession(2, 2, 2, 0),
  {
    eventOrder: 3,
    kind: 'substitution',
    period: 1,
    secondsRemaining: 500,
    homeScore: 2,
    awayScore: 2,
    side: 'home',
    playerInCardId: `card-${'1'.repeat(32)}`,
    playerOutCardId: `card-${'2'.repeat(32)}`,
    reason: 'rotation-plan',
    unit: [
      `card-${'1'.repeat(32)}`,
      `card-${'2'.repeat(32)}`,
      `card-${'3'.repeat(32)}`,
      `card-${'4'.repeat(32)}`,
      `card-${'5'.repeat(32)}`,
    ],
  },
  {
    eventOrder: 4,
    kind: 'period-end',
    period: 1,
    secondsRemaining: 0,
    homeScore: 2,
    awayScore: 2,
    periodHomeScore: 2,
    periodAwayScore: 2,
  },
  {
    eventOrder: 5,
    kind: 'final',
    period: 1,
    secondsRemaining: 0,
    homeScore: 2,
    awayScore: 2,
    winner: 'home',
  },
];

describe('collection gamecast', () => {
  it('filters one timeline per watch mode with fixed cadences', () => {
    expect(visibleEvents(EVENTS, 'slow')).toHaveLength(6);
    const standard = visibleEvents(EVENTS, 'standard');
    expect(standard.map((event) => event.kind)).toEqual([
      'possession',
      'possession',
      'substitution',
      'period-end',
      'final',
    ]);
    expect(visibleEvents(EVENTS, 'fast').map((event) => event.kind)).toEqual(['final']);
    expect(cadenceFor('fast')).toBeNull();
    expect(cadenceFor('standard')).toBe(250);
    expect(cadenceFor('slow')).toBe(650);
  });

  it('labels clocks and events factually', () => {
    expect(clockLabel(252)).toBe('4:12');
    expect(clockLabel(0)).toBe('0:00');
    expect(eventLabel(EVENTS[0] as CollectionGameEvent)).toContain('You 2 · CPU 0');
    expect(eventLabel(EVENTS[5] as CollectionGameEvent)).toContain('Final');
  });

  it('derives explanation facts from the record without invention', () => {
    const record = {
      gameVersion: 'collection-game-v1',
      collectionId: 'collection-1',
      gameId: `game-${'3'.repeat(32)}`,
      gameSequence: 0,
      prepared: {},
      result: {
        gameVersion: 'collection-game-v1',
        gameId: `game-${'3'.repeat(32)}`,
        gameSequence: 0,
        catalogVersion: 'collection-catalog-v1',
        rulesVersion: 'collection-game-rules-v1',
        engineVersion: 'm3-engine-v21',
        profileVersion: 'm3-2020s-v1',
        winner: 'home',
        outcome: 'completed',
        overtimePeriods: 0,
        home: {
          teamId: 'collection-player',
          displayName: 'Your Team',
          score: 2,
          periodScores: [2],
          box: {},
          players: [{ cardId: `card-${'1'.repeat(32)}`, points: 2 }],
          shotZones: [],
          foulLimitExceptions: [],
        },
        away: {
          teamId: 'collection-cpu',
          displayName: 'CPU Team',
          score: 2 - 0,
          periodScores: [2],
          box: {},
          players: [{ cardId: `card-${'2'.repeat(32)}`, points: 2 }],
          shotZones: [],
          foulLimitExceptions: [],
        },
        substitutions: [],
        unitStints: [],
        deviations: [],
        foulOuts: [],
      },
      events: [],
      eventDigest: '0'.repeat(32),
      resultDigest: '1'.repeat(32),
      reward: {
        rewardVersion: 'collection-reward-v1',
        reason: 'game-win-reward',
        currency: 'Coins',
        amount: 100,
        transactionId: `txn-${'4'.repeat(32)}`,
      },
      completedAtIso: '2026-01-01T00:00:00.000Z',
    } as unknown as CollectionGameRecord;
    const facts = explanationFacts(record, EVENTS);
    expect(facts.winner).toBe('home');
    expect(facts.rewardCoins).toBe(100);
    expect(facts.topHome?.points).toBe(2);
    expect(facts.leadChanges).toBe(0);
    expect(facts.biggestLead).toEqual({ side: 'home', points: 2 });
  });
});
