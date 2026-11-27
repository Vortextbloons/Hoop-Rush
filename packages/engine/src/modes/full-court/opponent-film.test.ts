import { describe, expect, it } from 'bun:test';
import type { SimulationRatings, SimulationTendencies } from '@hoop-rush/data-contracts';
import {
  SIMULATION_RATINGS,
  SIMULATION_TENDENCIES,
  playerVersionId,
  seasonKeySchema,
} from '@hoop-rush/data-contracts';
import { buildSeasonDraftCandidate } from '@hoop-rush/test-fixtures';
import type { FullCourtHistoricalTeam } from './league.ts';
import {
  fullCourtFilmReport,
  fullCourtFilmRotationOf,
  fullCourtFreeOpponentReport,
  type FullCourtFilmPlayer,
} from './opponent-film.ts';

function filmPlayer(input: {
  readonly name: string;
  readonly minutes: number;
  readonly starter?: boolean;
  readonly ratings?: Partial<SimulationRatings>;
  readonly tendencies?: Partial<SimulationTendencies>;
}): FullCourtFilmPlayer {
  const playerId = `p-${input.name}`;
  return {
    playerId,
    playerVersionId: playerVersionId(playerId, 'celtics', '2000s', '2007-08'),
    displayName: input.name,
    positions: ['SF'],
    minutes: input.minutes,
    starter: input.starter ?? true,
    ratings: { ...SIMULATION_RATINGS, ...input.ratings },
    tendencies: { ...SIMULATION_TENDENCIES, ...input.tendencies },
  };
}

function historicalTeam(
  starterCount: number,
): Pick<FullCourtHistoricalTeam, 'teamId' | 'seasonKey' | 'players' | 'starterVersionIds'> {
  const players = [0, 1, 2, 3].map((index) =>
    buildSeasonDraftCandidate({ franchiseId: 'celtics', eraId: '2000s', index }),
  );
  return {
    teamId: 'celtics',
    seasonKey: seasonKeySchema.parse('2007-08'),
    players,
    starterVersionIds: players.slice(0, starterCount).map((player) => player.playerVersionId),
  };
}

describe('full court opponent film', () => {
  it('reads the historical rotation input without a played game', () => {
    const team = historicalTeam(2);
    const rotation = fullCourtFilmRotationOf(team);
    expect(rotation.map((player) => player.minutes)).toEqual(
      team.players.map((player) => player.stamina.historicalMpg),
    );
    expect(rotation.map((player) => player.starter)).toEqual([true, true, false, false]);
  });

  it('separates free opponent identity from paid film', () => {
    const team = historicalTeam(2);
    const free = fullCourtFreeOpponentReport(team);
    expect(free.tier).toBe('free');
    expect(free.rosterSize).toBe(4);
    expect(free.starters).toHaveLength(2);
    expect(free.starters[0]?.displayName).toBe(team.players[0]?.displayName ?? '');
    expect(free).not.toHaveProperty('shotProfile');
    expect(free).not.toHaveProperty('notes');
  });

  it('weights the film by rotation minutes and states its evidence basis', () => {
    const primary = filmPlayer({
      name: 'primary',
      minutes: 30,
      tendencies: { usageRate: 30, threePointRate: 40, foulRate: 4, rimFrequency: 20 },
    });
    const reserve = filmPlayer({
      name: 'reserve',
      minutes: 10,
      starter: false,
      tendencies: { usageRate: 14, threePointRate: 0, foulRate: 8, rimFrequency: 40 },
    });
    const report = fullCourtFilmReport({
      teamId: 'celtics',
      seasonKey: '2007-08',
      rotation: [primary, reserve],
    });
    expect(report.basis).toBe('historical-rotation-input');
    expect(report.rotationSize).toBe(2);
    expect(report.creationOrder.map((player) => player.displayName)).toEqual([
      'primary',
      'reserve',
    ]);
    expect(report.rotation[0]?.minutesShare).toBe(0.75);
    expect(report.shotProfile.find((zone) => zone.zone === 'rim')?.frequency).toBe(25);
    expect(report.defensiveProfile.foulRate).toBe(5);
    expect(report.notes).toContainEqual({
      code: 'three-point-volume',
      metric: 'threePointRate',
      value: 30,
    });
    expect(Object.keys(report).sort()).toEqual(
      [
        'basis',
        'creationOrder',
        'defensiveProfile',
        'notes',
        'rotation',
        'rotationSize',
        'seasonKey',
        'shotProfile',
        'teamId',
        'tier',
      ].sort(),
    );
  });

  it('produces the same report regardless of rotation order', () => {
    const left = filmPlayer({ name: 'left', minutes: 24, tendencies: { usageRate: 22 } });
    const right = filmPlayer({ name: 'right', minutes: 24, tendencies: { usageRate: 18 } });
    const forward = fullCourtFilmReport({
      teamId: 'celtics',
      seasonKey: '2007-08',
      rotation: [left, right],
    });
    const reversed = fullCourtFilmReport({
      teamId: 'celtics',
      seasonKey: '2007-08',
      rotation: [right, left],
    });
    expect(reversed).toEqual(forward);
  });

  it('rejects a rotation with no minutes', () => {
    expect(() =>
      fullCourtFilmReport({
        teamId: 'celtics',
        seasonKey: '2007-08',
        rotation: [filmPlayer({ name: 'empty', minutes: 0 })],
      }),
    ).toThrow(/positive minutes/);
  });
});
