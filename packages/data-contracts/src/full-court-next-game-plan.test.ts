import { describe, expect, it } from 'bun:test';
import {
  FULL_COURT_NEXT_GAME_PLAN_SCHEMA_VERSION,
  fullCourtNextGamePlanSchema,
} from './full-court-next-game-plan.ts';
import { FULL_COURT_MAX_ROSTER_SIZE } from './full-court-draft.ts';

function plan(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: FULL_COURT_NEXT_GAME_PLAN_SCHEMA_VERSION,
    gameId: 'crl-01-bos-nyk',
    opponentTeamId: 'nyk',
    restingPlayerIds: ['usr-3'],
    ...overrides,
  };
}

describe('fullCourtNextGamePlanSchema', () => {
  it('accepts fixture-scoped rest and defensive matchup choices', () => {
    const parsed = fullCourtNextGamePlanSchema.safeParse(
      plan({
        defensiveMatchups: {
          gameId: 'crl-01-bos-nyk',
          opponentTeamId: 'nyk',
          assignments: [{ opponentPlayerId: 'opp-1', defenderPlayerId: 'usr-1' }],
        },
      }),
    );
    expect(parsed.success).toBe(true);
  });

  it('rejects duplicate resting players and too many rest choices', () => {
    expect(
      fullCourtNextGamePlanSchema.safeParse(plan({ restingPlayerIds: ['usr-1', 'usr-1'] })).success,
    ).toBe(false);
    const tooMany = Array.from(
      { length: FULL_COURT_MAX_ROSTER_SIZE + 1 },
      (_value, index) => `usr-${String(index + 1)}`,
    );
    expect(fullCourtNextGamePlanSchema.safeParse(plan({ restingPlayerIds: tooMany })).success).toBe(
      false,
    );
  });

  it('rejects defensive matchups scoped to another fixture or opponent', () => {
    const anotherGame = fullCourtNextGamePlanSchema.safeParse(
      plan({
        defensiveMatchups: {
          gameId: 'crl-02-bos-nyk',
          opponentTeamId: 'nyk',
          assignments: [{ opponentPlayerId: 'opp-1', defenderPlayerId: 'usr-1' }],
        },
      }),
    );
    expect(anotherGame.success).toBe(false);

    const anotherOpponent = fullCourtNextGamePlanSchema.safeParse(
      plan({
        defensiveMatchups: {
          gameId: 'crl-01-bos-nyk',
          opponentTeamId: 'mia',
          assignments: [{ opponentPlayerId: 'opp-1', defenderPlayerId: 'usr-1' }],
        },
      }),
    );
    expect(anotherOpponent.success).toBe(false);
  });
});
