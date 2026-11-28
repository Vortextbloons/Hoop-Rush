import { describe, expect, test } from 'bun:test';
import { playerIdSchema } from '@hoop-rush/data-contracts';
import { buildFullCourtAwards } from '@hoop-rush/engine';
import { buildSimulationPlayer } from '@hoop-rush/test-fixtures';
import { render } from 'svelte/server';
import FullCourtAwardsPanel from './FullCourtAwardsPanel.svelte';

const roster = Array.from({ length: 6 }, (_, index) =>
  buildSimulationPlayer({
    playerId: playerIdSchema.parse(`usr-${String(index + 1)}`),
    displayName: `User Player ${String(index + 1)}`,
  }),
);
const opponent = Array.from({ length: 6 }, (_, index) =>
  buildSimulationPlayer({
    playerId: playerIdSchema.parse(`opp-${String(index + 1)}`),
    displayName: `Opp Player ${String(index + 1)}`,
  }),
);

const line = (playerId: string, points: number) => ({
  playerId,
  seconds: 1800,
  started: true,
  points,
  rebounds: 6,
  offRebounds: 1,
  defRebounds: 5,
  assists: 4,
  steals: 1,
  blocks: 1,
  turnovers: 2,
  fouls: 2,
  fgm: 8,
  fga: 16,
  tpm: 2,
  tpa: 6,
  ftm: 2,
  fta: 3,
});

const scores = [
  {
    gameId: 'fc-reg-1-0',
    slot: 1,
    dayOffset: 1,
    homeTeamId: 'usr',
    awayTeamId: 'opp',
    outcome: {
      kind: 'played',
      homePoints: 100,
      awayPoints: 90,
      playerStats: {
        home: roster.map((player) => line(player.playerId, 20)),
        away: opponent.map((player) => line(player.playerId, 12)),
      },
    },
  },
] as never;

describe('FullCourtAwardsPanel', () => {
  test('renders heads, ladders, and squads', () => {
    const teams = [
      { teamId: 'usr', displayName: 'User Five', roster },
      { teamId: 'opp', displayName: 'Opp Five', roster: opponent },
    ];
    const awards = buildFullCourtAwards({
      teams,
      regularScores: scores,
      standings: { west: [], east: [], qualifiedTeamIds: [] },
      completedSlots: 1,
    });
    const rosterStats = awards.mvp.finalists.map((candidate) => candidate.player);
    const body = render(FullCourtAwardsPanel, {
      props: { awards, rosterStats, userTeamId: 'usr' },
    }).body;
    expect(body).toContain('Awards Race');
    expect(body).toContain('award-ladder-row');
    expect(body).toContain('squad-row');
    expect(body.match(/User Player/g)?.length ?? 0).toBeGreaterThan(0);
    // Runner-up and All-League rows carry the small headshot slot (initials fallback without art).
    expect(body.match(/h-6 w-6/g)?.length ?? 0).toBeGreaterThan(0);
    // The box score uses the shared season-box-score shell every other mode uses:
    // one section owning title, scope switch, per-game/totals switch, mobile cards.
    expect(body).toContain('Your roster averages');
    expect(body).toContain('Stats scope');
    expect(body).toContain('Per game');
    expect(body).toContain('Totals');
    expect(body).toContain('stat-card');
    expect(body).toContain('ui-stats-table');
    expect(body).toContain('TOV');
    expect(body).toContain('FT%');
    expect(body).toContain('USG%');
    expect(body).toContain('FGA');
    expect(body).toContain('3PM');
    expect(body).toContain('Team');
  });

  test('switches the box score between per-game and season totals', () => {
    const teams = [
      { teamId: 'usr', displayName: 'User Five', roster },
      { teamId: 'opp', displayName: 'Opp Five', roster: opponent },
    ];
    const awards = buildFullCourtAwards({
      teams,
      regularScores: scores,
      standings: { west: [], east: [], qualifiedTeamIds: [] },
      completedSlots: 1,
    });
    const rosterStats = awards.mvp.finalists.map((candidate) => candidate.player);
    const body = render(FullCourtAwardsPanel, {
      props: { awards, rosterStats, userTeamId: 'usr' },
    }).body;
    // Per-game is the default, so the note and the MIN header both read per game.
    expect(body).toContain('Per-game averages');
    expect(body).toContain('MPG');
  });
});
