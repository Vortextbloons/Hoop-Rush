import { describe, expect, it } from 'bun:test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { seedSchema } from '@hoop-rush/data-contracts';
import {
  buildGameSimulationInput,
  buildStrongWeakFixture,
  seedFromString,
} from '@hoop-rush/test-fixtures';
import { simulateGame as simulateArchivedGame } from '../archive/code/sim/game.ts';
import {
  createGameBatchSimulator,
  simulateGame,
  type TripObservation,
  type PeriodObservation,
} from './game.ts';
import { checkGameResult } from './invariants.ts';
import { createEngineContext } from './kernel.ts';
import { createRng, type Rng } from './rng.ts';
import { GAME_WASM_BYTES, GAME_WASM_SOURCE_HASH } from './wasm/game-wasm.gen.ts';

describe('production Rust game kernel', () => {
  it('ships a valid module matching its Rust source', () => {
    const source = readFileSync(new URL('./wasm/game.rs', import.meta.url), 'utf8').replace(
      /\r\n/g,
      '\n',
    );
    expect(createHash('sha256').update(source).digest('hex')).toBe(GAME_WASM_SOURCE_HASH);
    expect(WebAssembly.validate(GAME_WASM_BYTES)).toBe(true);
  });

  it('preserves archived results, trip snapshots and period callbacks across matchups and overtime', () => {
    const base = buildGameSimulationInput();
    const { strong, weak } = buildStrongWeakFixture();
    const context = createEngineContext({ engineVersion: 'test-version' });
    const batch = createGameBatchSimulator(context);
    let overtime = 0;
    for (let i = 0; i < 100; i++) {
      const input = {
        ...base,
        seed: seedSchema.parse(seedFromString(`wasm-parity-${String(i)}`)),
        home: i % 2 === 0 ? base.home : strong,
        away: i % 3 === 0 ? base.away : weak,
      };
      const expectedTrips: TripObservation[] = [];
      const actualTrips: TripObservation[] = [];
      const expectedPeriods: PeriodObservation[] = [];
      const actualPeriods: PeriodObservation[] = [];
      const expected = simulateArchivedGame(input, context, {
        onTrip: (trip) => expectedTrips.push(trip),
        onPeriod: (period) => expectedPeriods.push(period),
      });
      const actual = batch(input, {
        onTrip: (trip) => actualTrips.push(trip),
        onPeriod: (period) => actualPeriods.push(period),
      });
      expect(actual).toEqual(expected);
      expect(actualTrips).toEqual(expectedTrips);
      expect(actualPeriods).toEqual(expectedPeriods);
      expect(actual.engineVersion).toBe('test-version');
      expect(checkGameResult(actual)).toEqual([]);
      overtime += actual.overtimePeriods;
    }
    expect(overtime).toBeGreaterThan(0);
  });

  it('preserves injected RNG method calls, weighted items and draw order', () => {
    const input = buildGameSimulationInput();
    const trace =
      (calls: unknown[]) =>
      (seed: string): Rng => {
        const rng = createRng(seed);
        return {
          ...rng,
          next: () => {
            const value = rng.next();
            calls.push(['next', value]);
            return value;
          },
          chance: (p) => {
            const value = rng.chance(p);
            calls.push(['chance', p, value]);
            return value;
          },
          weightedPickTable: (items, table) => {
            const value = rng.weightedPickTable(items, table);
            calls.push(['pick', items, table, value]);
            return value;
          },
        };
      };
    const expectedCalls: unknown[] = [];
    const actualCalls: unknown[] = [];
    const expected = simulateArchivedGame(
      input,
      createEngineContext({ rngFactory: trace(expectedCalls) }),
    );
    const actual = simulateGame(input, createEngineContext({ rngFactory: trace(actualCalls) }));
    expect(actual).toEqual(expected);
    expect(actualCalls).toEqual(expectedCalls);
  });

  it('isolates nested simulations started by a playback observer', () => {
    const input = buildGameSimulationInput();
    const context = createEngineContext();
    const expected = simulateArchivedGame(input, context);
    let nested = false;
    const actual = simulateGame(input, context, {
      onTrip: () => {
        if (nested) return;
        nested = true;
        expect(simulateGame(input, context)).toEqual(expected);
        expect(simulateGame(input, context, { onPeriod: () => {} })).toEqual(expected);
      },
    });
    expect(nested).toBe(true);
    expect(actual).toEqual(expected);
  });
});
