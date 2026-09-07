import { describe, expect, it } from 'vitest';
import { auditPlayerStatSanity } from './data-validate.ts';

describe('auditPlayerStatSanity', () => {
  it('flags makes above attempts and impossible scoring rates, not bench minutes', () => {
    expect(
      auditPlayerStatSanity(
        { gamesPlayed: 79, minutes: 322, fieldGoalsMade: 973, fieldGoalsAttempted: 883 },
        'wizards/1960s',
        'Walt Bellamy',
      ),
    ).toEqual(['pools: wizards/1960s Walt Bellamy makes exceed attempts']);
    expect(
      auditPlayerStatSanity(
        { gamesPlayed: 79, minutes: 322, points: 2495 },
        'wizards/1960s',
        'Walt Bellamy',
      ),
    ).toEqual(['pools: wizards/1960s Walt Bellamy impossible scoring rate (2495 pts / 322 min)']);
    expect(
      auditPlayerStatSanity(
        {
          gamesPlayed: 77,
          minutes: 196,
          points: 150,
          rebounds: 90,
          fieldGoalsMade: 60,
          fieldGoalsAttempted: 150,
        },
        'kings/1960s',
        'Ralph Davis',
      ),
    ).toEqual([]);
    expect(
      auditPlayerStatSanity(
        { gamesPlayed: 63, minutes: 0, points: 120 },
        'nets/1980s',
        'George Johnson',
      ),
    ).toEqual([]);
    expect(
      auditPlayerStatSanity(
        {
          gamesPlayed: 82,
          minutes: 2800,
          fieldGoalsMade: 800,
          fieldGoalsAttempted: 1600,
          freeThrowsMade: 300,
          freeThrowsAttempted: 350,
          threesMade: 100,
          threesAttempted: 300,
        },
        'warriors/2010s',
        'Stephen Curry',
      ),
    ).toEqual([]);
  });
});
