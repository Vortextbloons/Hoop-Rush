import { describe, expect, test } from 'bun:test';
import {
  FULL_COURT_DEFAULT_COACHING_PLAN,
  playerIdSchema,
  seasonKeySchema,
} from '@hoop-rush/data-contracts';
import type { FullCourtRegularSeason } from '@hoop-rush/engine';
import { buildSimulationPlayer } from '@hoop-rush/test-fixtures';
import { render } from 'svelte/server';
import FullCourtDefensiveMatchupsPanel from './FullCourtDefensiveMatchupsPanel.svelte';
import {
  buildFullCourtMatchupEditorView,
  type FullCourtMatchupEditorContext,
} from './full-court-matchup-presenter.ts';
import type { FullCourtUserFixture } from './full-court-season-presenter.ts';

const USER_ROSTER = Array.from({ length: 6 }, (_, index) =>
  buildSimulationPlayer({
    playerId: playerIdSchema.parse(`usr-${String(index + 1)}`),
    displayName: `User Player ${String(index + 1)}`,
    positions: [index === 0 ? 'PG' : index === 1 ? 'SG' : index === 2 ? 'SF' : 'C'],
  }),
);

const OPPONENT_ROSTER = Array.from({ length: 6 }, (_, index) =>
  buildSimulationPlayer({
    playerId: playerIdSchema.parse(`opp-${String(index + 1)}`),
    displayName: `Opp Star ${String(index + 1)}`,
    positions: [index === 0 ? 'PG' : index === 1 ? 'SG' : index === 2 ? 'SF' : 'C'],
  }),
);

const FIXTURE: FullCourtUserFixture = {
  gameId: 'fc-reg-1-0',
  phase: 'regular',
  label: 'Game 1 of 82',
  dayOffset: 1,
  homeTeamId: 'usr',
  awayTeamId: 'opp',
  userSide: 'home',
};

const USER_TEAM: FullCourtRegularSeason['teams'][number] = {
  teamId: 'usr',
  displayName: 'User Five',
  anchorSeason: null,
  roster: USER_ROSTER,
};

const OPPONENT_TEAM: FullCourtRegularSeason['teams'][number] = {
  teamId: 'opp',
  displayName: 'Boston Celtics',
  anchorSeason: seasonKeySchema.parse('1985-86'),
  roster: OPPONENT_ROSTER,
  rotation: {
    startingFive: OPPONENT_ROSTER.slice(0, 5).map((player) => player.playerId),
  },
};

function makeContext(
  overrides: Partial<FullCourtMatchupEditorContext> = {},
): FullCourtMatchupEditorContext {
  return {
    fixture: FIXTURE,
    userTeam: USER_TEAM,
    opponentTeam: OPPONENT_TEAM,
    userHealth: null,
    opponentHealth: null,
    restingPlayerIds: [],
    coachingPlan: FULL_COURT_DEFAULT_COACHING_PLAN,
    assignments: [],
    forGameId: null,
    forOpponentId: null,
    ...overrides,
  };
}

describe('FullCourtDefensiveMatchupsPanel', () => {
  test('renders nothing when no fixture context is applicable', () => {
    const body = render(FullCourtDefensiveMatchupsPanel, {
      props: { context: null },
    }).body;
    expect(body).not.toContain('Defensive matchups');
  });

  test('renders default state, assigned pairs, and resting fallback warnings', () => {
    const emptyBody = render(FullCourtDefensiveMatchupsPanel, {
      props: {
        context: makeContext(),
        onMatchupsChange: () => undefined,
      },
    }).body;
    expect(emptyBody).toContain('Defensive matchups');
    expect(emptyBody).toContain('Staff default');
    expect(emptyBody).toContain('Game 1 of 82');
    expect(emptyBody).toContain('Add matchup');

    const activeBody = render(FullCourtDefensiveMatchupsPanel, {
      props: {
        context: makeContext({
          forGameId: FIXTURE.gameId,
          forOpponentId: OPPONENT_TEAM.teamId,
          restingPlayerIds: ['usr-3'],
          assignments: [{ opponentPlayerId: 'opp-1', defenderPlayerId: 'usr-3' }],
        }),
        onMatchupsChange: () => undefined,
      },
    }).body;

    expect(activeBody).toContain('1 / 3 assigned');
    expect(activeBody).toContain('User Player 3 is resting — falls back to staff coverage.');
    expect(activeBody).toContain('Reset to staff defaults');
  });

  test('surfaces a clear drift warning when saved matchups belong to an older fixture', () => {
    const drifted = makeContext({
      forGameId: 'fc-reg-0-0',
      forOpponentId: 'other-team',
      assignments: [{ opponentPlayerId: 'opp-1', defenderPlayerId: 'usr-2' }],
    });
    const view = buildFullCourtMatchupEditorView(drifted);
    expect(view?.drifted).toBe(true);
    expect(view?.rows).toHaveLength(0);

    const body = render(FullCourtDefensiveMatchupsPanel, {
      props: {
        context: drifted,
        onMatchupsChange: () => undefined,
      },
    }).body;
    expect(body).toContain('Matchup plan drifted');
    expect(body).toContain('Reset for Game 1 of 82');
  });
});
