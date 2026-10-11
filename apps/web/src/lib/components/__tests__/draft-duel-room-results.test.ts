import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/svelte';
import { contentHashSchema, idSchema, seedSchema } from '@hoop-rush/data-contracts';
import type {
  DraftDuelGameOutput,
  DraftDuelSeriesSnapshot,
  TeamResult,
} from '@hoop-rush/data-contracts';
import RoomPage from '../../../routes/draft-duel/room/[roomId]/+page.svelte';

const { controller } = vi.hoisted(() => {
  const outputs: Record<number, DraftDuelGameOutput> = {};
  return {
    controller: {
      snapshot: {
        code: '1234',
        members: [],
        settings: { presentation: 'ratings', fairness: 'fair' },
      },
      phase: 'game-results',
      participantId: 'p1',
      series: {} as DraftDuelSeriesSnapshot,
      outputs,
      currentOutput: null as DraftDuelGameOutput | null,
      verification: [] as Array<{ gameNumber: number; status: 'verified' }>,
      readyCountdownMs: null,
      localReady: false,
      readyForNextGame: vi.fn(),
      attach: vi.fn(),
      dispose: vi.fn(),
    },
  };
});

vi.mock('$lib/draft-duel/draft-duel-controller.svelte', () => ({
  DraftDuelController: vi.fn(function () {
    return controller;
  }),
}));
vi.mock('$app/stores', async () => {
  const { readable } = await import('svelte/store');
  return { page: readable({ params: { roomId: 'results-room' } }) };
});

function team(teamId: string, points: number): TeamResult {
  return {
    teamId,
    displayName: teamId,
    players: [],
    shotZones: [],
    box: {
      teamId,
      points,
      fieldGoals: { made: 40, attempted: 80 },
      threes: { made: 10, attempted: 30 },
      freeThrows: { made: 10, attempted: 12 },
      rebounds: { total: 40, offensive: 10, defensive: 30, team: 0 },
      assists: 20,
      steals: 5,
      blocks: 5,
      turnovers: 10,
      fouls: 15,
      possessions: 90,
    },
  };
}

function output(gameNumber: number): DraftDuelGameOutput {
  return {
    schemaVersion: 1,
    roomId: idSchema.parse('results-room'),
    gameNumber,
    homeParticipantId: 'p1',
    awayParticipantId: 'p2',
    seed: seedSchema.parse('a'.repeat(16)),
    inputDigest: contentHashSchema.parse('b'.repeat(64)),
    resultDigest: contentHashSchema.parse('c'.repeat(64)),
    tapeDigest: contentHashSchema.parse('d'.repeat(64)),
    tape: [],
    result: {
      schemaVersion: 1,
      gameNumber,
      seed: 'a'.repeat(16),
      engineVersion: 'test',
      dataVersion: 'test',
      profileVersion: 'test',
      home: team('p1', 100),
      away: team('p2', 90),
      periodScores: { home: [25, 25, 25, 25], away: [20, 20, 25, 25] },
      winner: 'home',
      overtimePeriods: 0,
      facts: [],
    },
  };
}

beforeEach(() => {
  controller.series = {
    homeWinner: 'p1',
    games: [],
    p1Wins: 0,
    p2Wins: 0,
    currentGameNumber: 1,
    champion: null,
  };
  controller.currentOutput = output(1);
  controller.outputs = { 1: controller.currentOutput };
  controller.verification = [];
});

describe('Draft Duel room results transition', () => {
  it('shows the first simulated game while peer verification is pending', () => {
    const { getByRole, getByText } = render(RoomPage);
    expect(getByRole('region', { name: 'Game results' })).toBeTruthy();
    expect(getByText('You win Game 1')).toBeTruthy();
    expect(getByText('Waiting for opponent verification')).toBeTruthy();
  });

  it('shows the current game and its verification instead of the previous confirmed game', () => {
    const series = controller.series;
    series.games = [
      { gameNumber: 1, homeParticipantId: 'p1', awayParticipantId: 'p2', winner: 'p1' },
    ];
    series.p1Wins = 1;
    series.currentGameNumber = 2;
    controller.outputs[2] = output(2);
    controller.currentOutput = controller.outputs[2];
    controller.verification = [{ gameNumber: 1, status: 'verified' }];
    const { getByText, queryByText } = render(RoomPage);
    expect(getByText('You win Game 2')).toBeTruthy();
    expect(getByText('Waiting for opponent verification')).toBeTruthy();
    expect(queryByText('You win Game 1')).toBeNull();
  });
});
