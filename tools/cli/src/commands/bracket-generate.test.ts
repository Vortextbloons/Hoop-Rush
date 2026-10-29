import { describe, expect, it } from 'bun:test';
import { buildSimulationPlayer } from '@hoop-rush/test-fixtures';
import { playerIdSchema, type PositionUnion } from '@hoop-rush/data-contracts';
import { seasonPositions, selectSeasonFive } from './bracket-generate.ts';

function candidate(
  id: string,
  positions: PositionUnion,
  minutes: number,
  involvement: number,
  score = 60,
) {
  return {
    ...buildSimulationPlayer({ playerId: playerIdSchema.parse(id), positions }),
    seasonKey: '2023-24',
    minutes,
    offensiveInvolvement: involvement,
    score,
  };
}

describe('season-specific bracket selection', () => {
  it('keeps the cornerstone and important rotation players even when a reserve has a higher rating', () => {
    const roster = [
      candidate('p-cornerstone', ['PG'], 2400, 2500, 58),
      candidate('p-guard', ['SG'], 2200, 1500),
      candidate('p-wing', ['SF'], 2100, 1400),
      candidate('p-forward', ['PF'], 2000, 1300),
      candidate('p-center', ['C'], 1900, 1200, 75),
      candidate('p-reserve-guard', ['PG'], 900, 500, 90),
      candidate('p-reserve-center', ['C'], 800, 400, 95),
    ];
    const five = selectSeasonFive(roster);
    expect(five?.map((player) => player.playerId)).toEqual(
      roster.slice(0, 5).map((player) => player.playerId),
    );
    expect(five?.map((player) => player.score)).toEqual([58, 60, 60, 60, 75]);
    expect(selectSeasonFive([...roster].reverse())?.map((player) => player.playerId)).toEqual(
      five?.map((player) => player.playerId),
    );
  });

  it('does not silently replace a cornerstone when the roster cannot form a legal five around him', () => {
    const roster = [
      candidate('p-cornerstone', ['PG'], 2400, 2500),
      candidate('p-guard', ['PG'], 2300, 1500),
      candidate('p-wing', ['SF'], 2100, 1400),
      candidate('p-forward', ['PF'], 2000, 1300),
      candidate('p-center', ['C'], 1900, 1200),
    ];
    expect(selectSeasonFive(roster)).toBeNull();
  });

  it('assigns ambiguous guards and forwards by their recorded roles', () => {
    const anchors = {
      gamesPlayed: 70,
      minutesPerGame: 30,
      pointsPerGame: 15,
      reboundsPerGame: 5,
      offensiveReboundsPerGame: 1,
      defensiveReboundsPerGame: 4,
      assistsPerGame: 2,
      stealsPerGame: 1,
      blocksPerGame: 1,
      turnoversPerGame: 2,
      fieldGoalPct: 0.45,
      threePointPct: 0.35,
      freeThrowPct: 0.8,
      threePointAttemptRate: 0.3,
      freeThrowAttemptRate: 0.2,
    };
    const roster = [
      { ...candidate('p-scorer', ['PG', 'SG'], 2500, 30), anchors },
      {
        ...candidate('p-playmaker', ['PG', 'SG'], 2400, 25),
        anchors: { ...anchors, assistsPerGame: 8 },
      },
      {
        ...candidate('p-big-forward', ['SF', 'PF'], 2300, 20),
        anchors: { ...anchors, reboundsPerGame: 10 },
      },
      { ...candidate('p-wing', ['SF', 'PF'], 2200, 18), anchors },
      candidate('p-center', ['C'], 2100, 15),
    ];
    expect(selectSeasonFive(roster)?.map((player) => player.playerId)).toEqual([
      'p-playmaker',
      'p-scorer',
      'p-wing',
      'p-big-forward',
      'p-center',
    ]);
  });

  it('restricts hybrid wings and bigs to adjacent positions', () => {
    expect(seasonPositions({ position: 'G-F', secondaryPositions: [] })).toEqual(['SF', 'SG']);
    expect(seasonPositions({ position: 'F-C', secondaryPositions: [] })).toEqual(['C', 'PF']);
    expect(seasonPositions({ position: 'PG', secondaryPositions: ['SG'] })).toEqual(['PG', 'SG']);
  });
});
