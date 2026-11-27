import { describe, expect, it } from 'bun:test';
import { buildGameSimulationInput } from '@hoop-rush/test-fixtures';
import { SHOT_ZONES } from '../domain/zones.ts';
import { freeThrowProbability } from './fouls.ts';
import {
  POSSESSION_STARTS,
  encodeTeamActionAndShotTables,
  encodeTeamPickTables,
} from './possession-tables.ts';
import { prepareTeam } from './prepare.ts';
import type { WeightedPickTable } from './rng.ts';
import { ACTION_TYPES } from './usage.ts';

interface TableEvent {
  readonly offset: number;
  readonly value: WeightedPickTable;
  readonly items: readonly unknown[];
}

function fixture() {
  const input = buildGameSimulationInput();
  const prep = prepareTeam(input.home, input.profile);
  return { profile: input.profile, players: input.home.players, prep };
}

function collector() {
  const data: number[] = [];
  const events: TableEvent[] = [];
  const writer = (value: WeightedPickTable, items: readonly unknown[]): void => {
    events.push({ offset: data.length, value, items });
    data.push(value.total, ...value.weights);
  };
  return { data, events, writer };
}

describe('shared possession layout table encoding', () => {
  it('falls back to the profile free-throw probability when the prep array is short', () => {
    const { profile, players, prep } = fixture();
    const { data, writer } = collector();

    encodeTeamPickTables(data, writer, { ...prep, freeThrowP: [] }, players, profile);

    const ftStart = 5 * (players.length + 1);
    expect(data.slice(ftStart, ftStart + players.length)).toEqual(
      players.map((player) => freeThrowProbability(player, profile)),
    );
  });

  it('writes action, pass, teammate-shot, zone, and defender tables in ABI order', () => {
    const { players, prep } = fixture();
    const { data, events, writer } = collector();
    const player = players[0];
    if (!player) throw new Error('fixture requires a player');
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
});
