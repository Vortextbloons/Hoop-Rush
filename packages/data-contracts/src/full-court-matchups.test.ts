import { describe, expect, it } from 'bun:test';
import {
  FULL_COURT_MAX_DEFENSIVE_MATCHUPS,
  fullCourtDefensiveMatchupsSchema,
} from './full-court-matchups.ts';

describe('fullCourtDefensiveMatchupsSchema', () => {
  it('accepts a bounded set of unique opponent-to-defender assignments', () => {
    const parsed = fullCourtDefensiveMatchupsSchema.safeParse({
      gameId: 'fc-reg-1-0',
      opponentTeamId: 'bos',
      assignments: [
        { opponentPlayerId: 'opp-1', defenderPlayerId: 'usr-3' },
        { opponentPlayerId: 'opp-2', defenderPlayerId: 'usr-1' },
        { opponentPlayerId: 'opp-4', defenderPlayerId: 'usr-5' },
      ],
    });
    expect(parsed.success).toBe(true);
  });

  it('rejects more than the maximum bounded assignments', () => {
    const assignments = Array.from(
      { length: FULL_COURT_MAX_DEFENSIVE_MATCHUPS + 1 },
      (_value, index) => ({
        opponentPlayerId: `opp-${String(index + 1)}`,
        defenderPlayerId: `usr-${String(index + 1)}`,
      }),
    );
    const parsed = fullCourtDefensiveMatchupsSchema.safeParse({
      opponentTeamId: 'bos',
      assignments,
    });
    expect(parsed.success).toBe(false);
  });

  it('rejects duplicate opponent targets and assigning one defender to simultaneous targets', () => {
    const duplicateOpponent = fullCourtDefensiveMatchupsSchema.safeParse({
      opponentTeamId: 'bos',
      assignments: [
        { opponentPlayerId: 'opp-1', defenderPlayerId: 'usr-1' },
        { opponentPlayerId: 'opp-1', defenderPlayerId: 'usr-2' },
      ],
    });
    expect(duplicateOpponent.success).toBe(false);

    const duplicateDefender = fullCourtDefensiveMatchupsSchema.safeParse({
      opponentTeamId: 'bos',
      assignments: [
        { opponentPlayerId: 'opp-1', defenderPlayerId: 'usr-2' },
        { opponentPlayerId: 'opp-2', defenderPlayerId: 'usr-2' },
      ],
    });
    expect(duplicateDefender.success).toBe(false);
  });
});
