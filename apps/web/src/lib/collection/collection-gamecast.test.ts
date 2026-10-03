import { describe, expect, it } from 'vitest';
import type { CollectionGameEvent } from '@hoop-rush/data-contracts';
import { clockLabel, eventLabel, visibleEvents } from './collection-gamecast';

const scoreEvent: Extract<CollectionGameEvent, { kind: 'possession' }> = {
  kind: 'possession',
  eventOrder: 7,
  period: 5,
  secondsRemaining: 61,
  homeScore: 104,
  awayScore: 101,
  possessionNumber: 220,
  offenseSide: 'home',
  pointsScored: 3,
  participantCardIds: ['scorer'],
  statDeltas: [
    {
      cardId: 'scorer',
      side: 'home',
      points: 3,
      fieldGoalsMade: 1,
      fieldGoalsAttempted: 1,
      threePointMade: 1,
      threePointAttempted: 1,
      freeThrowMade: 0,
      freeThrowAttempted: 0,
      offensiveRebounds: 0,
      defensiveRebounds: 0,
      assists: 0,
      steals: 0,
      blocks: 0,
      turnovers: 0,
      fouls: 0,
    },
  ],
};

describe('recorded gamecast presentation', () => {
  it('attributes points only to the recorded scoring delta and labels overtime', () => {
    expect(eventLabel(scoreEvent, () => 'Mitch Richmond')).toBe(
      'OT1 1:01 — You 104 · CPU 101 · Mitch Richmond +3',
    );
    expect(eventLabel({ ...scoreEvent, statDeltas: [] }, () => 'Mitch Richmond')).toBe(
      'OT1 1:01 — You 104 · CPU 101 (+3)',
    );
  });

  it('names the recorded substitution without inferring a play', () => {
    expect(
      eventLabel(
        {
          kind: 'substitution',
          eventOrder: 8,
          period: 4,
          secondsRemaining: 90,
          homeScore: 90,
          awayScore: 88,
          side: 'home',
          playerInCardId: 'in',
          playerOutCardId: 'out',
          reason: 'rotation-plan',
          unit: [],
        },
        (id) => (id === 'in' ? 'David Robinson' : 'Steve Patterson'),
      ),
    ).toContain('David Robinson in · Steve Patterson out (rotation-plan)');
  });

  it('filters replay views without mutating the saved event order', () => {
    const missed = { ...scoreEvent, eventOrder: 6, pointsScored: 0, statDeltas: [] };
    const final: CollectionGameEvent = {
      kind: 'final',
      eventOrder: 8,
      period: 5,
      secondsRemaining: 0,
      homeScore: 104,
      awayScore: 101,
      winner: 'home',
    };
    const events = [missed, scoreEvent, final];
    expect(visibleEvents(events, 'standard')).toEqual([scoreEvent, final]);
    expect(visibleEvents(events, 'fast')).toEqual([final]);
    visibleEvents(events, 'slow').reverse();
    expect(events.map((event) => event.eventOrder)).toEqual([6, 7, 8]);
  });

  it('labels overtime period boundaries and clamps clock values', () => {
    expect(
      eventLabel({
        kind: 'period-end',
        eventOrder: 9,
        period: 6,
        secondsRemaining: 0,
        homeScore: 110,
        awayScore: 108,
        periodHomeScore: 6,
        periodAwayScore: 7,
      }),
    ).toBe('End of OT2 — You 110 · CPU 108');
    expect(clockLabel(-1)).toBe('0:00');
  });
});
