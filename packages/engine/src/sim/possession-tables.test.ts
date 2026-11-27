import { describe, expect, it } from 'bun:test';
import type { EraSimulationProfile, SimulationPlayer } from '@hoop-rush/data-contracts';
import { buildGameSimulationInput } from '@hoop-rush/test-fixtures';
import { SHOT_ZONES } from '../domain/zones.ts';
import { ENGINE_CONSTANTS } from './constants.ts';
import { freeThrowProbability } from './fouls.ts';
import {
  POSSESSION_STARTS,
  encodeStruckTables,
  encodeTeamActionAndShotTables,
  encodeTeamPickTables,
  type PickTableWriter,
} from './possession-tables.ts';
import { prepareTeam, type TeamPrep } from './prepare.ts';
import type { WeightedPickTable } from './rng.ts';
import { ACTION_TYPES } from './usage.ts';

interface TableEvent {
  readonly offset: number;
  readonly value: WeightedPickTable;
  readonly items: readonly unknown[];
}

function fixture(): {
  readonly profile: EraSimulationProfile;
  readonly players: readonly SimulationPlayer[];
  readonly prep: TeamPrep;
} {
  const input = buildGameSimulationInput();
  const prep = prepareTeam(input.home, input.profile);
  return { profile: input.profile, players: input.home.players, prep };
}

function collector(): { data: number[]; events: TableEvent[]; writer: PickTableWriter } {
  const data: number[] = [];
  const events: TableEvent[] = [];
  const writer: PickTableWriter = (value, items) => {
    events.push({ offset: data.length, value, items });
    data.push(value.total, ...value.weights);
  };
  return { data, events, writer };
}

function first(players: readonly SimulationPlayer[]): SimulationPlayer {
  const player = players[0];
  if (player === undefined) throw new Error('fixture requires at least one player');
  return player;
}

describe('shared possession layout table encoding', () => {
  it('writes team pick tables and their fixed values in ABI order', () => {
    const { profile, players, prep } = fixture();
    const { data, events, writer } = collector();

    encodeTeamPickTables(data, writer, prep, players, profile);

    expect(events).toHaveLength(6);
    expect(events.every((event) => event.items === players)).toBe(true);
    expect(events.map((event) => event.value)).toEqual([
      prep.initiatorPickTable,
      prep.foulerPickTable,
      prep.stealerPickTable,
      prep.rebounderPickTables[0],
      prep.rebounderPickTables[1],
      prep.freeThrowShooterPickTable,
    ]);
    const ftStart = (events[4]?.offset ?? 0) + 1 + players.length;
    const ftShooterStart = ftStart + players.length;
    const fixedStart = ftShooterStart + 1 + players.length;
    expect(data.slice(fixedStart)).toEqual([
      prep.offensiveReboundMean,
      prep.defensiveReboundMean,
      prep.spacing,
      prep.pressure,
      Math.min(
        0.9,
        Math.max(
          0.3,
          profile.parameters.stealShareOfTurnovers *
            (1 + (prep.stealAbility - ENGINE_CONSTANTS.stealNeutralAbility) / 100),
        ),
      ),
    ]);
    expect(data.slice(ftStart, ftStart + players.length)).toEqual([...prep.freeThrowP]);
  });

  it('falls back to the profile free-throw probability when the prep array is short', () => {
    const { profile, players, prep } = fixture();
    const shortPrep: TeamPrep = { ...prep, freeThrowP: [] };
    const { data, writer } = collector();

    encodeTeamPickTables(data, writer, shortPrep, players, profile);

    const ftStart = 5 * (players.length + 1);
    expect(data.slice(ftStart, ftStart + players.length)).toEqual(
      players.map((player) => freeThrowProbability(player, profile)),
    );
  });

  it('writes action, pass, teammate-shot, zone, and defender tables in ABI order', () => {
    const { players, prep } = fixture();
    const { data, events, writer } = collector();
    const player = first(players);
    const key = prep.keyOf(player);

    encodeTeamActionAndShotTables(data, writer, prep, players, prep.keyOf, 'possession');

    const actionTables = players.length * POSSESSION_STARTS.length;
    const teammateTables = players.length * ACTION_TYPES.length;
    const zoneTables = players.length * ACTION_TYPES.length;
    const defenderTables = SHOT_ZONES.length * players.length;
    const actionStart = 0;
    const teammateStart = actionStart + actionTables;
    const zoneStart = teammateStart + teammateTables;
    const defenderStart = zoneStart + zoneTables;
    expect(events).toHaveLength(actionTables + teammateTables + zoneTables + defenderTables);
    expect(
      events.slice(actionStart, teammateStart).every((event) => event.items === ACTION_TYPES),
    ).toBe(true);
    expect(
      events
        .slice(teammateStart, zoneStart)
        .every((event) => event.items.length === players.length - 1),
    ).toBe(true);
    expect(
      events.slice(zoneStart, defenderStart).every((event) => event.items === SHOT_ZONES),
    ).toBe(true);
    expect(events.slice(defenderStart).every((event) => event.items === players)).toBe(true);
    expect(events[actionStart]?.value).toBe(prep.actionPickTables.get(key)?.byStart.neutral);
    expect(events[teammateStart]?.value).toBe(prep.teammateShots.get(key)?.byAction[0]?.pickTable);
    expect(events[zoneStart]?.value).toBe(prep.zonePrep.get(key)?.actionPickTables.isolation);
    expect(events[defenderStart]?.value).toBe(prep.defenderBase.pickTables[0]?.[0]);

    const lastAction = events[teammateStart - 1];
    const passStart = (lastAction?.offset ?? 0) + 1 + ACTION_TYPES.length;
    const passes = players.flatMap((current) => prep.passP.get(prep.keyOf(current)) ?? []);
    expect(data.slice(passStart, events[teammateStart]?.offset ?? 0)).toEqual(passes);
    expect(data).toHaveLength(
      8 * actionTables +
        passes.length +
        players.length * teammateTables +
        6 * zoneTables +
        6 * defenderTables,
    );
  });

  it('keeps each mode error prefix when a prepared table is missing', () => {
    const { players, prep } = fixture();
    const missing: TeamPrep = {
      ...prep,
      actionPickTables: new Map(prep.actionPickTables),
    };
    missing.actionPickTables.delete(prep.keyOf(first(players)));

    for (const label of ['possession', 'havoc battle']) {
      const { data, writer } = collector();
      expect(() =>
        encodeTeamActionAndShotTables(data, writer, missing, players, missing.keyOf, label),
      ).toThrow(`${label}: missing action tables`);
    }
  });

  it('writes the struck pool prefix, tables, and zero fallback in ABI order', () => {
    const { profile, players } = fixture();
    const pool = players.slice(1);
    const adjusted = prepareTeam({ teamId: 'home', displayName: 'Home', players: pool }, profile);
    const missing: TeamPrep = {
      ...adjusted,
      defenderBase: {
        ...adjusted.defenderBase,
        pickTables: adjusted.defenderBase.pickTables.map((zone, index) =>
          index === 0 ? [undefined as unknown as WeightedPickTable, ...zone.slice(1)] : zone,
        ),
      },
    };

    const { data, events, writer } = collector();
    encodeStruckTables(data, writer, missing, pool, players, players.length);

    expect(data.slice(0, 2 + pool.length)).toEqual([
      pool.length,
      ...pool.map((player) => players.indexOf(player)),
      missing.defensiveReboundMean,
    ]);
    expect(events[0]?.value).toBe(missing.stealerPickTable);
    expect(events[1]?.value).toBe(missing.rebounderPickTables[1]);
    expect(events[2]?.value.total).toBe(0);
    expect(events[2]?.value.weights).toEqual(Array(pool.length).fill(0));
    expect(events.at(-1)?.value.total).toBe(0);
    expect(data).toHaveLength(
      2 +
        pool.length +
        2 * (pool.length + 1) +
        SHOT_ZONES.length * players.length * (pool.length + 1) +
        (pool.length + 1),
    );
  });
});
