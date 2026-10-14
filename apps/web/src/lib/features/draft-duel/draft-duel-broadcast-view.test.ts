import { describe, expect, it } from 'vitest';
import {
  DRAFT_DUEL_TAPE_VERSION,
  draftDuelGameOutputSchema,
  seedSchema,
  type DraftDuelGameOutput,
  type DraftDuelTapeEvent,
  type DraftDuelTapeStatLine,
  type DraftDuelTapeTrip,
} from '@hoop-rush/data-contracts';
import { createEngineContext, simulateRecordedGame } from '@hoop-rush/engine';
import {
  DEFAULT_ERA_SIM_PROFILE,
  buildLegalSimulationTeam,
  seedFromString,
} from '@hoop-rush/test-fixtures';
import { gamecastVisibleState } from '#lib/features/multiplayer/gamecast/gamecast-playback.js';
import { TAPE_STAT_INDEXES } from '#lib/features/multiplayer/gamecast/gamecast-broadcast-view.js';
import {
  draftDuelFeedLines,
  draftDuelPeriodLabel,
  draftDuelTeamOf,
  type DraftDuelFeedLine,
} from './draft-duel-broadcast-view';

const {
  points: POINTS,
  offensiveRebounds: OFFENSIVE_REBOUNDS,
  defensiveRebounds: DEFENSIVE_REBOUNDS,
  turnovers: TURNOVERS,
  teamRebounds: TEAM_REBOUNDS,
} = TAPE_STAT_INDEXES;

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

function buildOutput(seed = 'dd-broadcast-view-tape'): DraftDuelGameOutput {
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
    roomId: 'dd-broadcast-view-room',
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

const output = buildOutput();

const trips = output.tape.filter((event): event is DraftDuelTapeTrip => event.kind === 'trip');

function zeroLine(): DraftDuelTapeStatLine {
  return [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
}

function emptyDeltaLines(): DraftDuelTapeStatLine[] {
  return Array.from({ length: 5 }, () => zeroLine());
}

function scoringLine(points: number): DraftDuelTapeStatLine {
  const line = zeroLine();
  line[POINTS] = points;
  return line;
}

function scenarioOutput(configure: (trip: DraftDuelTapeTrip) => void): DraftDuelGameOutput {
  const base = trips[0];
  if (base === undefined) throw new Error('fixture tape has no trips');
  const trip: DraftDuelTapeTrip = {
    ...base,
    period: 3,
    clockSeconds: 300,
    offense: 0,
    ended: true,
    secondsElapsed: 10,
    homeScore: 0,
    awayScore: 0,
    homeDeltas: emptyDeltaLines(),
    awayDeltas: emptyDeltaLines(),
    homeTeamDeltas: zeroLine(),
    awayTeamDeltas: zeroLine(),
  };
  configure(trip);
  return draftDuelGameOutputSchema.parse({ ...output, tape: [trip] });
}

function lastLineFor(tapeOutput: DraftDuelGameOutput, tapeIndex: number): DraftDuelFeedLine {
  const lines = draftDuelFeedLines(tapeOutput, tapeIndex + 1);
  const line = lines.at(-1);
  if (line === undefined) throw new Error(`no feed line for tape index ${String(tapeIndex)}`);
  return line;
}

function reboundDelta(line: DraftDuelTapeStatLine): number {
  return (
    (line[OFFENSIVE_REBOUNDS] ?? 0) + (line[DEFENSIVE_REBOUNDS] ?? 0) + (line[TEAM_REBOUNDS] ?? 0)
  );
}

describe('draftDuelPeriodLabel', () => {
  it('labels regulation quarters and overtimes', () => {
    expect(draftDuelPeriodLabel(1)).toBe('Q1');
    expect(draftDuelPeriodLabel(2)).toBe('Q2');
    expect(draftDuelPeriodLabel(4)).toBe('Q4');
    expect(draftDuelPeriodLabel(5)).toBe('OT1');
    expect(draftDuelPeriodLabel(6)).toBe('OT2');
  });
});

describe('draftDuelTeamOf', () => {
  it('maps participants to sides from homeParticipantId', () => {
    expect(draftDuelTeamOf(output, 'p1')).toBe('home');
    expect(draftDuelTeamOf(output, 'p2')).toBe('away');
    const swapped = draftDuelGameOutputSchema.parse({
      ...output,
      homeParticipantId: 'p2',
      awayParticipantId: 'p1',
    });
    expect(draftDuelTeamOf(swapped, 'p2')).toBe('home');
    expect(draftDuelTeamOf(swapped, 'p1')).toBe('away');
  });
});

describe('draftDuelFeedLines', () => {
  it('produces exactly one line per visible trip and clamps the count', () => {
    expect(draftDuelFeedLines(output, 0)).toEqual([]);
    expect(draftDuelFeedLines(output, -4)).toEqual([]);
    expect(draftDuelFeedLines(output, Number.NaN)).toEqual([]);
    const half = Math.floor(output.tape.length / 2);
    const visibleTrips = output.tape
      .slice(0, half)
      .filter((event): event is DraftDuelTapeTrip => event.kind === 'trip');
    const lines = draftDuelFeedLines(output, half);
    expect(lines).toHaveLength(visibleTrips.length);
    expect(lines.map((line) => line.key)).toEqual(
      visibleTrips.map((trip) => `trip-${String(trip.index)}`),
    );
    const oversized = draftDuelFeedLines(output, output.tape.length + 25);
    expect(oversized).toHaveLength(trips.length);
  });

  it('only reflects the requested visible prefix', () => {
    const split = Math.min(10, output.tape.length);
    const lines = draftDuelFeedLines(output, split);
    const visibleKeys = new Set(lines.map((line) => line.key));
    const hiddenTrips = output.tape
      .slice(split)
      .filter((event): event is DraftDuelTapeTrip => event.kind === 'trip');
    expect(hiddenTrips.length).toBeGreaterThan(0);
    for (const trip of hiddenTrips) {
      expect(visibleKeys.has(`trip-${String(trip.index)}`)).toBe(false);
    }
  });

  it('reports offense, period, clock, and points from the trip deltas', () => {
    for (const [index, event] of output.tape.entries()) {
      if (event.kind !== 'trip') continue;
      const line = lastLineFor(output, index);
      expect(line.period).toBe(event.period);
      expect(line.clockSeconds).toBe(event.clockSeconds);
      expect(line.offense).toBe(event.offense === 0 ? 'p1' : 'p2');
      const offenseTeam = event.offense === 0 ? event.homeTeamDeltas : event.awayTeamDeltas;
      expect(line.points).toBe(offenseTeam[POINTS]);
    }
  });

  it('mentions a player only when exactly one player scored on the trip', () => {
    let singleScorerTrips = 0;
    for (const [index, event] of output.tape.entries()) {
      if (event.kind !== 'trip') continue;
      const line = lastLineFor(output, index);
      const scorers: { side: 0 | 1; slot: number }[] = [];
      for (const side of [0, 1] as const) {
        const deltas = side === 0 ? event.homeDeltas : event.awayDeltas;
        for (let slot = 0; slot < deltas.length; slot += 1) {
          if ((deltas[slot]?.[POINTS] ?? 0) > 0) scorers.push({ side, slot });
        }
      }
      const playerIds = [
        ...output.result.home.players.map((player) => player.playerId),
        ...output.result.away.players.map((player) => player.playerId),
      ];
      if (line.points > 0 && scorers.length === 1) {
        singleScorerTrips += 1;
        const scorer = scorers[0];
        if (scorer === undefined) continue;
        const team = scorer.side === 0 ? output.result.home : output.result.away;
        const playerId = team.players[scorer.slot]?.playerId;
        expect(playerId).toBeDefined();
        const expected = `${String(playerId)} ${String(line.points)} pt${line.points === 1 ? '' : 's'}`;
        expect(line.summary).toContain(expected);
      } else if (scorers.length > 1) {
        for (const playerId of playerIds) {
          expect(line.summary).not.toContain(playerId);
        }
      }
    }
    expect(singleScorerTrips).toBeGreaterThan(0);
  });

  it('marks turnovers and rebounds only when the trip deltas record them', () => {
    for (const [index, event] of output.tape.entries()) {
      if (event.kind !== 'trip') continue;
      const line = lastLineFor(output, index);
      const offenseTeam = event.offense === 0 ? event.homeTeamDeltas : event.awayTeamDeltas;
      const defenseTeam = event.offense === 0 ? event.awayTeamDeltas : event.homeTeamDeltas;
      const turnovers = (offenseTeam[TURNOVERS] ?? 0) + (defenseTeam[TURNOVERS] ?? 0);
      const rebounds = reboundDelta(offenseTeam) + reboundDelta(defenseTeam);
      expect(line.summary.includes('Turnover')).toBe(turnovers > 0);
      expect(line.summary.includes('Rebound')).toBe(rebounds > 0);
      if (line.points === 0) expect(line.summary).toContain('No score');
    }
  });

  it('attributes a single scorer with roster order and reports multi-scorer points without names', () => {
    const single = scenarioOutput((trip) => {
      trip.homeDeltas[2] = scoringLine(2);
      trip.homeTeamDeltas[POINTS] = 2;
    });
    const singlePlayerId = single.result.home.players[2]?.playerId;
    expect(singlePlayerId).toBeDefined();
    expect(draftDuelFeedLines(single, 1)[0]?.summary).toBe(`${String(singlePlayerId)} 2 pts`);

    const onePoint = scenarioOutput((trip) => {
      trip.homeDeltas[0] = scoringLine(1);
      trip.homeTeamDeltas[POINTS] = 1;
    });
    const onePointPlayerId = onePoint.result.home.players[0]?.playerId;
    expect(draftDuelFeedLines(onePoint, 1)[0]?.summary).toBe(`${String(onePointPlayerId)} 1 pt`);

    const multi = scenarioOutput((trip) => {
      trip.homeDeltas[0] = scoringLine(1);
      trip.homeDeltas[1] = scoringLine(2);
      trip.homeTeamDeltas[POINTS] = 3;
    });
    const multiSummary = draftDuelFeedLines(multi, 1)[0]?.summary;
    expect(multiSummary).toBe('3 pts');
    for (const player of multi.result.home.players) {
      expect(multiSummary).not.toContain(player.playerId);
    }
  });

  it('summarizes markers factually and keeps no-score trips factual', () => {
    const turnover = scenarioOutput((trip) => {
      trip.homeTeamDeltas[TURNOVERS] = 1;
    });
    expect(draftDuelFeedLines(turnover, 1)[0]?.summary).toBe('No score · Turnover');

    const rebound = scenarioOutput((trip) => {
      trip.awayTeamDeltas[DEFENSIVE_REBOUNDS] = 1;
    });
    expect(draftDuelFeedLines(rebound, 1)[0]?.summary).toBe('No score · Rebound');

    const quiet = scenarioOutput(() => undefined);
    expect(draftDuelFeedLines(quiet, 1)[0]?.summary).toBe('No score');

    const andOne = scenarioOutput((trip) => {
      trip.homeDeltas[1] = scoringLine(2);
      trip.homeTeamDeltas[POINTS] = 2;
      trip.awayTeamDeltas[DEFENSIVE_REBOUNDS] = 1;
    });
    const scorerId = andOne.result.home.players[1]?.playerId;
    expect(draftDuelFeedLines(andOne, 1)[0]?.summary).toBe(`${String(scorerId)} 2 pts · Rebound`);
  });

  it('full visibility totals match the result boxes', () => {
    const lines = draftDuelFeedLines(output, output.tape.length);
    expect(lines).toHaveLength(trips.length);
    const homePoints = lines
      .filter((line) => line.offense === 'p1')
      .reduce((total, line) => total + line.points, 0);
    const awayPoints = lines
      .filter((line) => line.offense === 'p2')
      .reduce((total, line) => total + line.points, 0);
    expect(homePoints).toBe(output.result.home.box.points);
    expect(awayPoints).toBe(output.result.away.box.points);

    const visible = gamecastVisibleState(output, output.tape.length);
    expect(visible.homeScore).toBe(output.result.home.box.points);
    expect(visible.awayScore).toBe(output.result.away.box.points);
    const linesBySide = [visible.homePlayerLines, visible.awayPlayerLines] as const;
    const playersBySide = [output.result.home.players, output.result.away.players] as const;
    for (const side of [0, 1] as const) {
      for (let slot = 0; slot < 5; slot += 1) {
        expect(linesBySide[side][slot]?.[POINTS]).toBe(playersBySide[side][slot]?.points);
      }
    }
  });
});
