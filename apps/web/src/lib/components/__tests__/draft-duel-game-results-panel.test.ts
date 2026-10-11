import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/svelte';
import {
  DRAFT_DUEL_TAPE_STAT_FIELDS,
  DRAFT_DUEL_TAPE_VERSION,
  SHOT_ZONES,
  draftDuelGameOutputSchema,
  playerIdSchema,
  type DraftDuelGameOutput,
  type DraftDuelSeriesSnapshot,
  type DraftDuelTapeStatLine,
  type PlayerBoxScore,
  type TeamResult,
} from '@hoop-rush/data-contracts';
import GameResultsPanel from '$lib/draft-duel/GameResultsPanel.svelte';

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
    players: split.map((points, slot) => playerBox(`${teamId}-p${String(slot + 1)}`, points)),
    shotZones: SHOT_ZONES.map((zone) => ({ zone, attempts: 10, makes: 4 })),
  };
}

function makeOutput(): DraftDuelGameOutput {
  return draftDuelGameOutputSchema.parse({
    schemaVersion: DRAFT_DUEL_TAPE_VERSION,
    roomId: 'dd-results-panel-room',
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
        period: 1,
        clockSeconds: 620,
        offense: 0,
        ended: true,
        secondsElapsed: 12,
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

function makeSeries(): DraftDuelSeriesSnapshot {
  return {
    homeWinner: 'p1',
    games: [
      { gameNumber: 1, homeParticipantId: 'p1', awayParticipantId: 'p2', winner: 'p1' },
      { gameNumber: 2, homeParticipantId: 'p1', awayParticipantId: 'p2', winner: 'p1' },
    ],
    p1Wins: 2,
    p2Wins: 0,
    currentGameNumber: 3,
    champion: null,
  };
}

function baseProps(
  overrides: {
    verification?: 'pending' | 'verified' | 'mismatch';
    readyCountdownMs?: number | null;
    localReady?: boolean;
    onready?: () => void;
  } = {},
) {
  return {
    output: makeOutput(),
    series: makeSeries(),
    localParticipantId: 'p1' as const,
    verification: overrides.verification ?? ('pending' as const),
    readyCountdownMs: overrides.readyCountdownMs ?? null,
    localReady: overrides.localReady ?? false,
    onready: overrides.onready ?? (() => undefined),
  };
}

describe('GameResultsPanel', () => {
  it('never reads as verified while verification is pending', () => {
    const { container, getByText, queryByText } = render(GameResultsPanel, {
      props: baseProps({ verification: 'pending' }),
    });
    expect(getByText('Waiting for opponent verification')).toBeTruthy();
    expect(container.querySelector('[data-verification="pending"]')).not.toBeNull();
    expect(container.querySelector('[data-verification="verified"]')).toBeNull();
    expect(queryByText('Verified by both simulations')).toBeNull();
    const text = container.textContent.toLowerCase();
    expect(text).not.toContain('verified by');
  });

  it('labels verified and mismatch states without mixing them', () => {
    const verified = render(GameResultsPanel, {
      props: baseProps({ verification: 'verified' }),
    });
    expect(verified.getByText('Verified by both simulations')).toBeTruthy();
    expect(verified.queryByText('Waiting for opponent verification')).toBeNull();
    expect(verified.container.querySelector('[data-verification="verified"]')).not.toBeNull();

    const mismatch = render(GameResultsPanel, {
      props: baseProps({ verification: 'mismatch' }),
    });
    expect(mismatch.getByText('Verification mismatch')).toBeTruthy();
    expect(mismatch.queryByText('Waiting for opponent verification')).toBeNull();
    expect(mismatch.container.querySelector('[data-verification="mismatch"]')).not.toBeNull();
  });

  it('renders the final box score and series state from the result', () => {
    const { container, getByText } = render(GameResultsPanel, {
      props: baseProps(),
    });
    expect(container.querySelector('[data-score="local"]')?.textContent).toBe('99');
    expect(container.querySelector('[data-score="opponent"]')?.textContent).toBe('88');
    expect(getByText(/You win Game 2/)).toBeTruthy();
    expect(container.querySelectorAll('[data-role="player-row"]')).toHaveLength(10);
    expect(getByText(/Game 3 is next/)).toBeTruthy();
  });

  it('fires the ready callback and shows the countdown', async () => {
    const onready = vi.fn();
    const { getByRole, getByText } = render(GameResultsPanel, {
      props: baseProps({ verification: 'verified', readyCountdownMs: 7000, onready }),
    });
    const button = getByRole('button', { name: 'Ready for Game 3' });
    await fireEvent.click(button);
    expect(onready).toHaveBeenCalledTimes(1);
    expect(getByText(/Auto-ready in/)).toBeTruthy();
    expect(getByText('0:07')).toBeTruthy();
  });

  it('disables the ready button when already ready', () => {
    const onready = vi.fn();
    const { getByRole, getByText } = render(GameResultsPanel, {
      props: baseProps({ localReady: true, readyCountdownMs: 7000, onready }),
    });
    const button = getByRole('button', { name: 'Ready' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(getByText("You're ready for the next game.")).toBeTruthy();
  });

  it.each(['pending', 'mismatch'] as const)(
    'keeps the ready button disabled for %s results',
    (verification) => {
      const onready = vi.fn();
      const { getByRole } = render(GameResultsPanel, {
        props: baseProps({ verification, onready }),
      });
      const button = getByRole('button', { name: 'Ready for Game 3' }) as HTMLButtonElement;
      expect(button.disabled).toBe(true);
      button.click();
      expect(onready).not.toHaveBeenCalled();
    },
  );

  it('waits for the series to advance before allowing readiness', () => {
    const props = baseProps({ verification: 'verified' });
    props.series.currentGameNumber = props.output.gameNumber;
    const { getByRole } = render(GameResultsPanel, { props });
    expect((getByRole('button', { name: 'Ready for Game 2' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });
});
