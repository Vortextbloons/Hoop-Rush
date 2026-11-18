import { expect, test } from 'bun:test';
import type {
  CapRushLeagueGame,
  CapRushMultiplayerLockedInputs,
  CapRushMultiplayerState,
} from '@hoop-rush/data-contracts';
import { createCapRushMultiplayerState } from '@hoop-rush/engine';
import {
  capRushMultiplayerAchievementAwards,
  capRushMultiplayerBindingId,
} from './cap-rush-multiplayer-achievements';

const P1_TEAM = 'franchise-p1';
const P2_TEAM = 'franchise-p2';

test('uses the stable room binding and one award event per achievement', () => {
  const state = {
    ...createCapRushMultiplayerState(null),
    locked: {
      seats: {
        p1: { franchise: { franchiseId: P1_TEAM }, payrollDollars: 80_000_000 },
        p2: { franchise: { franchiseId: P2_TEAM }, payrollDollars: 80_000_000 },
      },
    } as unknown as CapRushMultiplayerLockedInputs,
    season: {
      games: [
        {
          gameId: 'crl-5-franchise-p1-franchise-p2',
          slot: 5,
          homeTeamId: P1_TEAM,
          awayTeamId: P2_TEAM,
          winnerTeamId: P1_TEAM,
        },
        {
          gameId: 'crl-61-franchise-p2-franchise-p1',
          slot: 61,
          homeTeamId: P2_TEAM,
          awayTeamId: P1_TEAM,
          winnerTeamId: P1_TEAM,
        },
      ] as unknown as CapRushLeagueGame[],
    },
  } as CapRushMultiplayerState;

  const awards = capRushMultiplayerAchievementAwards(state, 'p1');

  expect(capRushMultiplayerBindingId('room-a')).toBe('cap-rush-multiplayer:room-a');
  expect(awards.map((award) => award.eventId)).toEqual(['cap-rush:season-sweep']);
  expect(awards[0]?.candidate.id).toBe('season-sweep');
  expect(awards[0]?.candidate.evidence).not.toContain('room-a');
});
