import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/svelte';
import {
  DRAFT_DUEL_TAPE_STAT_FIELDS,
  DRAFT_DUEL_TAPE_VERSION,
  SHOT_ZONES,
  draftDuelGameOutputSchema,
  playerIdSchema,
  type DraftDuelGameOutput,
  type DraftDuelTapeStatLine,
  type PlayerBoxScore,
  type TeamResult,
} from '@hoop-rush/data-contracts';
import BroadcastView from '$lib/draft-duel/BroadcastView.svelte';
import type { DraftDuelVisibleState } from '$lib/draft-duel-playback';
import type { DraftDuelFeedLine } from '$lib/draft-duel/draft-duel-broadcast-view';

function tapeLine(
  values: Partial<Record<(typeof DRAFT_DUEL_TAPE_STAT_FIELDS)[number], number>>,
): DraftDuelTapeStatLine {
  return DRAFT_DUEL_TAPE_STAT_FIELDS.map(
    (field) => values[field] ?? 0,
  ) as unknown as DraftDuelTapeStatLine;
}

function playerBox(playerId: string, points: number): PlayerBoxScore {
  return {
    playerId: playerIdSchema.parse(playerId),
    minutes: 32,
    points,
    fieldGoals: { made: Math.round(points / 2), attempted: Math.round(points / 2) + 6 },
    threes: { made: 0, attempted: 2 },
    freeThrows: { made: 0, attempted: 0 },
    rebounds: { total: 6, offensive: 1, defensive: 5 },
    assists: 4,
    steals: 1,
    blocks: 0,
    turnovers: 2,
    fouls: 2,
  };
}

function teamResult(teamId: string, displayName: string, score: number): TeamResult {
  const split = [
    Math.round(score * 0.3),
    Math.round(score * 0.25),
    Math.round(score * 0.2),
    Math.round(score * 0.15),
    0,
  ];
  split[4] = score - split.slice(0, 4).reduce((total, value) => total + value, 0);
  const players = split.map((points, slot) => playerBox(`${teamId}-p${String(slot + 1)}`, points));
  return {
    teamId,
    displayName,
    box: {
      teamId,
      points: score,
      fieldGoals: { made: 40, attempted: 85 },
      threes: { made: 12, attempted: 33 },
      freeThrows: { made: 15, attempted: 18 },
      rebounds: { total: 44, offensive: 9, defensive: 33, team: 2 },
      assists: 25,
      steals: 8,
      blocks: 4,
      turnovers: 13,
      fouls: 20,
      possessions: 98,
    },
    players,
    shotZones: SHOT_ZONES.map((zone) => ({ zone, attempts: 10, makes: 4 })),
  };
}

function makeOutput(): DraftDuelGameOutput {
  return draftDuelGameOutputSchema.parse({
    schemaVersion: DRAFT_DUEL_TAPE_VERSION,
    roomId: 'dd-broadcast-component-room',
    gameNumber: 2,
    homeParticipantId: 'p1',
    awayParticipantId: 'p2',
    seed: 'a'.repeat(16),
    result: {
      schemaVersion: 1,
      gameNumber: 2,
      seed: 'a'.repeat(16),
      engineVersion: 'engine-test',
      dataVersion: 'data-test',
      profileVersion: 'profile-test',
      home: teamResult('draft-duel-p1', 'Draft Duel P1', 99),
      away: teamResult('draft-duel-p2', 'Draft Duel P2', 88),
      periodScores: { home: [24, 25, 25, 25], away: [22, 22, 22, 22] },
      winner: 'home',
      overtimePeriods: 0,
      facts: [],
    },
    tape: [
      {
        kind: 'trip',
        index: 0,
        period: 2,
        clockSeconds: 330,
        offense: 0,
        ended: true,
        secondsElapsed: 14,
        homeScore: 2,
        awayScore: 0,
        homeDeltas: [
          tapeLine({ points: 2, fieldGoalMakes: 1, fieldGoalAttempts: 1 }),
          tapeLine({}),
          tapeLine({}),
          tapeLine({}),
          tapeLine({}),
        ],
        awayDeltas: [tapeLine({}), tapeLine({}), tapeLine({}), tapeLine({}), tapeLine({})],
        homeTeamDeltas: tapeLine({ points: 2, fieldGoalMakes: 1, fieldGoalAttempts: 1 }),
        awayTeamDeltas: tapeLine({}),
      },
    ],
    inputDigest: 'b'.repeat(64),
    resultDigest: 'c'.repeat(64),
    tapeDigest: 'd'.repeat(64),
  });
}

function makeVisible(): DraftDuelVisibleState {
  return {
    homeScore: 12,
    awayScore: 9,
    homePlayerLines: [
      tapeLine({
        points: 8,
        fieldGoalMakes: 3,
        fieldGoalAttempts: 6,
        offensiveRebounds: 1,
        defensiveRebounds: 2,
        assists: 2,
        turnovers: 1,
      }),
      tapeLine({ points: 4, fieldGoalMakes: 2, fieldGoalAttempts: 5, defensiveRebounds: 3 }),
      tapeLine({ points: 0, fieldGoalAttempts: 2, defensiveRebounds: 1 }),
      tapeLine({ points: 0, defensiveRebounds: 2 }),
      tapeLine({ points: 0, defensiveRebounds: 1 }),
    ],
    awayPlayerLines: [
      tapeLine({ points: 5, fieldGoalMakes: 2, fieldGoalAttempts: 7, assists: 1 }),
      tapeLine({ points: 2, fieldGoalMakes: 1, fieldGoalAttempts: 4, offensiveRebounds: 2 }),
      tapeLine({ points: 2, fieldGoalMakes: 1, fieldGoalAttempts: 3 }),
      tapeLine({ points: 0, defensiveRebounds: 4 }),
      tapeLine({ points: 0, defensiveRebounds: 2 }),
    ],
    periods: [],
  };
}

const feed: DraftDuelFeedLine[] = [
  {
    key: 'trip-0',
    period: 1,
    clockSeconds: 640,
    offense: 'p1',
    summary: 'draft-duel-p1-p1 2 pts',
    points: 2,
  },
  {
    key: 'trip-1',
    period: 2,
    clockSeconds: 330,
    offense: 'p2',
    summary: 'No score · Rebound',
    points: 0,
  },
];

describe('BroadcastView', () => {
  it('renders scores and player stats from the visible prefix, not the final result', () => {
    const { container } = render(BroadcastView, {
      props: {
        output: makeOutput(),
        visible: makeVisible(),
        progress: 0.35,
        localParticipantId: 'p1' as const,
        feed,
      },
    });
    expect(container.querySelector('[data-score="local"]')?.textContent).toBe('12');
    expect(container.querySelector('[data-score="opponent"]')?.textContent).toBe('9');
    const localPts = Array.from(
      container.querySelectorAll('[data-side="home"] [data-stat="pts"]'),
    ).map((cell) => cell.textContent);
    expect(localPts).toEqual(['8', '4', '0', '0', '0']);
    const awayPts = Array.from(
      container.querySelectorAll('[data-side="away"] [data-stat="pts"]'),
    ).map((cell) => cell.textContent);
    expect(awayPts).toEqual(['5', '2', '2', '0', '0']);
    expect(container.querySelectorAll('[data-side="home"] [data-role="player-row"]')).toHaveLength(
      5,
    );
  });

  it('shows the period and clock from the last visible trip', () => {
    const { container, getByText } = render(BroadcastView, {
      props: {
        output: makeOutput(),
        visible: makeVisible(),
        progress: 0.35,
        localParticipantId: 'p1' as const,
        feed,
      },
    });
    expect(container.querySelector('.score-clock')?.textContent).toContain('Q2 · 5:30');
    expect(getByText('No score · Rebound')).toBeTruthy();
  });

  it('has no skip or seek controls', () => {
    const { container } = render(BroadcastView, {
      props: {
        output: makeOutput(),
        visible: makeVisible(),
        progress: 0.35,
        localParticipantId: 'p1' as const,
        feed,
      },
    });
    expect(
      container.querySelectorAll('button, input, select, textarea, [role="slider"]'),
    ).toHaveLength(0);
    expect(container.textContent.toLowerCase()).not.toMatch(/skip|seek/);
  });
});
