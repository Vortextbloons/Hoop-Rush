import { describe, expect, it } from 'vitest';
import {
  DRAFT_DUEL_BROADCAST_MS,
  DRAFT_DUEL_TAPE_VERSION,
  draftDuelGameOutputSchema,
  seedSchema,
  type DraftDuelGameOutput,
  type DraftDuelTapeEvent,
  type DraftDuelTapeTrip,
} from '@hoop-rush/data-contracts';
import { createEngineContext, simulateRecordedGame } from '@hoop-rush/engine';
import {
  DEFAULT_ERA_SIM_PROFILE,
  buildLegalSimulationTeam,
  seedFromString,
} from '@hoop-rush/test-fixtures';
import {
  gamecastPlaybackPositionMs,
  gamecastPlaybackWeights,
  gamecastVisibleEventCount,
  gamecastVisibleState,
} from '#lib/features/multiplayer/gamecast/gamecast-playback.js';

function integerSecondsTape(tape: readonly DraftDuelTapeEvent[]): DraftDuelTapeEvent[] {
  return tape.map((event) =>
    event.kind === 'trip'
      ? {
          ...event,
          clockSeconds: Math.round(event.clockSeconds),
          secondsElapsed: Math.round(event.secondsElapsed),
        }
      : event,
  );
}

function buildOutput(seed: string): DraftDuelGameOutput {
  const seedValue = seedSchema.parse(seedFromString(seed));
  const recorded = simulateRecordedGame(
    {
      schemaVersion: 2,
      seed: seedValue,
      gameNumber: 1,
      dataVersion: 'fixture-data-v1',
      profile: DEFAULT_ERA_SIM_PROFILE,
      home: buildLegalSimulationTeam({ teamId: 'p1', displayName: 'P1' }),
      away: buildLegalSimulationTeam({ teamId: 'p2', displayName: 'P2' }),
    },
    createEngineContext(),
  );
  return draftDuelGameOutputSchema.parse({
    schemaVersion: DRAFT_DUEL_TAPE_VERSION,
    roomId: 'dd-playback-room',
    gameNumber: 1,
    homeParticipantId: 'p1',
    awayParticipantId: 'p2',
    seed: seedValue,
    result: recorded.result,
    tape: integerSecondsTape(recorded.tape),
    inputDigest: 'a'.repeat(64),
    resultDigest: 'b'.repeat(64),
    tapeDigest: 'c'.repeat(64),
  });
}

const output = buildOutput('dd-playback-tape');

describe('gamecastPlaybackWeights', () => {
  it('is cumulative, monotonic, and ends at 1', () => {
    const weights = gamecastPlaybackWeights(output.tape);
    expect(weights).toHaveLength(output.tape.length);
    expect(weights.at(-1)).toBe(1);
    for (let index = 0; index < weights.length; index += 1) {
      const weight = weights[index] ?? Number.NaN;
      expect(weight).toBeGreaterThanOrEqual(index === 0 ? 0 : (weights[index - 1] ?? 0));
      expect(weight).toBeLessThanOrEqual(1);
    }
  });

  it('holds period events at the previous cumulative weight', () => {
    const weights = gamecastPlaybackWeights(output.tape);
    for (let index = 0; index < output.tape.length; index += 1) {
      if (output.tape[index]?.kind !== 'period') continue;
      expect(weights[index]).toBe(weights[index - 1] ?? 0);
    }
  });

  it('weights every trip uniformly regardless of game-clock duration', () => {
    const trip = output.tape.find((event): event is DraftDuelTapeTrip => event.kind === 'trip');
    expect(trip).toBeDefined();
    if (trip === undefined) return;
    const weights = gamecastPlaybackWeights([
      { ...trip, secondsElapsed: 0 },
      { ...trip, secondsElapsed: 24 },
      { ...trip, secondsElapsed: 2 },
    ]);
    expect(weights).toEqual([1 / 3, 2 / 3, 1]);
  });
});

describe('gamecastVisibleEventCount', () => {
  it('is monotonic, bounded, and complete at progress 1', () => {
    let previous = 0;
    for (let step = 0; step <= 200; step += 1) {
      const count = gamecastVisibleEventCount(output.tape, step / 200);
      expect(count).toBeGreaterThanOrEqual(previous);
      expect(count).toBeLessThanOrEqual(output.tape.length);
      previous = count;
    }
    expect(gamecastVisibleEventCount(output.tape, 0)).toBe(0);
    expect(gamecastVisibleEventCount(output.tape, 1)).toBe(output.tape.length);
    expect(gamecastVisibleEventCount(output.tape, -1)).toBe(0);
    expect(gamecastVisibleEventCount(output.tape, 2)).toBe(output.tape.length);
    expect(gamecastVisibleEventCount(output.tape, Number.NaN)).toBe(0);
    expect(gamecastVisibleEventCount([], 1)).toBe(0);
  });

  it('reveals a period boundary exactly when its cumulative weight is crossed', () => {
    const weights = gamecastPlaybackWeights(output.tape);
    for (let index = 0; index < output.tape.length; index += 1) {
      if (output.tape[index]?.kind !== 'period') continue;
      const boundary = weights[index] ?? Number.NaN;
      expect(gamecastVisibleEventCount(output.tape, boundary)).toBe(index + 1);
      expect(gamecastVisibleEventCount(output.tape, boundary - 1e-9)).toBeLessThan(index + 1);
    }
  });
});

describe('gamecastVisibleState', () => {
  it('reconstructs the final box score and lines from the full prefix', () => {
    const state = gamecastVisibleState(output, output.tape.length);
    expect(state.homeScore).toBe(output.result.home.box.points);
    expect(state.awayScore).toBe(output.result.away.box.points);
    const linesBySide = [state.homePlayerLines, state.awayPlayerLines] as const;
    const playersBySide = [output.result.home.players, output.result.away.players] as const;
    for (let side = 0; side < 2; side += 1) {
      for (let slot = 0; slot < 5; slot += 1) {
        const line = linesBySide[side]?.[slot];
        const player = playersBySide[side]?.[slot];
        expect(line).toBeDefined();
        expect(player).toBeDefined();
        if (line === undefined || player === undefined) continue;
        expect(line[0]).toBe(player.points);
        expect(line[1]).toBe(player.fieldGoals.made);
        expect(line[2]).toBe(player.fieldGoals.attempted);
        expect(line[3]).toBe(player.threes.made);
        expect(line[4]).toBe(player.threes.attempted);
        expect(line[5]).toBe(player.freeThrows.made);
        expect(line[6]).toBe(player.freeThrows.attempted);
        expect(line[7]).toBe(player.rebounds.offensive);
        expect(line[8]).toBe(player.rebounds.defensive);
        expect(line[9]).toBe(player.assists);
        expect(line[10]).toBe(player.steals);
        expect(line[11]).toBe(player.blocks);
        expect(line[12]).toBe(player.turnovers);
        expect(line[13]).toBe(player.fouls);
      }
    }
  });

  it('never decreases scores as more events become visible', () => {
    let previousHome = 0;
    let previousAway = 0;
    for (let count = 0; count <= output.tape.length; count += 1) {
      const state = gamecastVisibleState(output, count);
      expect(state.homeScore).toBeGreaterThanOrEqual(previousHome);
      expect(state.awayScore).toBeGreaterThanOrEqual(previousAway);
      previousHome = state.homeScore;
      previousAway = state.awayScore;
    }
  });

  it('exposes only the visible period boundaries', () => {
    const half = Math.floor(output.tape.length / 2);
    const state = gamecastVisibleState(output, half);
    const visiblePeriods = output.tape.slice(0, half).filter((event) => event.kind === 'period');
    expect(state.periods).toHaveLength(visiblePeriods.length);
    const full = gamecastVisibleState(output, output.tape.length);
    const tapePeriods = output.tape.filter((event) => event.kind === 'period');
    expect(full.periods).toHaveLength(tapePeriods.length);
    full.periods.forEach((period, index) => {
      const tapePeriod = tapePeriods[index];
      expect(period.period).toBe(tapePeriod?.period);
      expect(period.homeScore).toBe(tapePeriod?.homeScore);
      expect(period.awayScore).toBe(tapePeriod?.awayScore);
    });
  });

  it('clamps visible counts to the tape bounds', () => {
    const empty = gamecastVisibleState(output, 0);
    expect(empty.homeScore).toBe(0);
    expect(empty.awayScore).toBe(0);
    expect(empty.periods).toEqual([]);
    const negative = gamecastVisibleState(output, -5);
    expect(negative).toEqual(empty);
    const clamped = gamecastVisibleState(output, Number.NaN);
    expect(clamped).toEqual(empty);
    const oversized = gamecastVisibleState(output, output.tape.length + 10);
    expect(oversized.homeScore).toBe(output.result.home.box.points);
    expect(oversized.awayScore).toBe(output.result.away.box.points);
  });
});

describe('gamecastPlaybackPositionMs', () => {
  const startedAtIso = '2026-01-01T00:00:00.000Z';
  const startMs = Date.parse(startedAtIso);
  it('tracks elapsed time with server clock offsets', () => {
    expect(
      gamecastPlaybackPositionMs({
        startedAtIso,
        durationMs: DRAFT_DUEL_BROADCAST_MS,
        serverOffsetMs: 0,
        nowMs: startMs + 5000,
      }),
    ).toBe(5000);
    expect(
      gamecastPlaybackPositionMs({
        startedAtIso,
        durationMs: DRAFT_DUEL_BROADCAST_MS,
        serverOffsetMs: 2000,
        nowMs: startMs + 5000,
      }),
    ).toBe(7000);
    expect(
      gamecastPlaybackPositionMs({
        startedAtIso,
        durationMs: DRAFT_DUEL_BROADCAST_MS,
        serverOffsetMs: -3000,
        nowMs: startMs + 5000,
      }),
    ).toBe(2000);
  });

  it('clamps to the broadcast window', () => {
    expect(
      gamecastPlaybackPositionMs({
        startedAtIso,
        durationMs: DRAFT_DUEL_BROADCAST_MS,
        serverOffsetMs: 0,
        nowMs: startMs - 10_000,
      }),
    ).toBe(0);
    expect(
      gamecastPlaybackPositionMs({
        startedAtIso,
        durationMs: DRAFT_DUEL_BROADCAST_MS,
        serverOffsetMs: 0,
        nowMs: startMs + DRAFT_DUEL_BROADCAST_MS,
      }),
    ).toBe(DRAFT_DUEL_BROADCAST_MS);
    expect(
      gamecastPlaybackPositionMs({
        startedAtIso,
        durationMs: DRAFT_DUEL_BROADCAST_MS,
        serverOffsetMs: 0,
        nowMs: startMs + DRAFT_DUEL_BROADCAST_MS + 10_000,
      }),
    ).toBe(DRAFT_DUEL_BROADCAST_MS);
  });

  it('returns 0 for invalid input', () => {
    expect(
      gamecastPlaybackPositionMs({
        startedAtIso: 'not-a-date',
        durationMs: DRAFT_DUEL_BROADCAST_MS,
        serverOffsetMs: 0,
        nowMs: startMs,
      }),
    ).toBe(0);
    expect(
      gamecastPlaybackPositionMs({
        startedAtIso,
        durationMs: 0,
        serverOffsetMs: 0,
        nowMs: startMs,
      }),
    ).toBe(0);
    expect(
      gamecastPlaybackPositionMs({
        startedAtIso,
        durationMs: DRAFT_DUEL_BROADCAST_MS,
        serverOffsetMs: 0,
        nowMs: Number.NaN,
      }),
    ).toBe(0);
  });
});
