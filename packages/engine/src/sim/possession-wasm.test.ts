import { describe, expect, it } from 'bun:test';
import { buildHavocLockedInputs } from '@hoop-rush/test-fixtures';
import { soloToBattleInput } from '../modes/havoc/core/battle-adapters.ts';
import {
  havocBattleGameResultDigest,
  havocBattleGameTapeDigest,
} from '../modes/havoc/core/battle-digests.ts';
import { simulateHavocBattleGame } from '../modes/havoc/core/battle-game.ts';
import { buildHavocGameInput } from '../modes/havoc/input.ts';
import { createEngineContext } from './kernel.ts';
import { createRng, type Rng } from './rng.ts';

function customRng(seed: string): Rng {
  const inner = createRng(seed);
  return {
    next: () => inner.next(),
    chance: (probability) => inner.chance(probability),
    nextInt: (min, max) => inner.nextInt(min, max),
    pick: (items) => inner.pick(items),
    weightedPick: (items, weights) => inner.weightedPick(items, weights),
    weightedPickTable: (items, table) => inner.weightedPickTable(items, table),
  };
}

function lockedBattleInput() {
  const locked = buildHavocLockedInputs();
  return soloToBattleInput(buildHavocGameInput({ locked, gameNumber: 1, variant: 'havoc' }));
}

describe('shared trip kernel RNG contract', () => {
  it('round-trips the built-in RNG state without changing subsequent draws', () => {
    const first = createRng('possession-state-round-trip');
    for (let index = 0; index < 17; index += 1) first.next();
    const state = first.getState?.();
    expect(state).toBeDefined();
    const expected = Array.from({ length: 12 }, () => first.next());
    first.setState?.(state ?? 0);
    expect(Array.from({ length: 12 }, () => first.next())).toEqual(expected);
  });

  it('matches the built-in stream on the external callback path', () => {
    const input = lockedBattleInput();
    const builtIn = simulateHavocBattleGame(input, createEngineContext());
    const custom = simulateHavocBattleGame(input, createEngineContext({ rngFactory: customRng }));
    expect(custom.result).toEqual(builtIn.result);
    expect(custom.tape).toEqual(builtIn.tape);
    expect(havocBattleGameResultDigest(custom.result)).toBe(
      havocBattleGameResultDigest(builtIn.result),
    );
    expect(havocBattleGameTapeDigest(custom.tape)).toBe(havocBattleGameTapeDigest(builtIn.tape));
  });
});

it('isolates a nested battle started by a custom RNG callback', () => {
  const input = lockedBattleInput();
  const expected = simulateHavocBattleGame(input, createEngineContext());
  let nested = false;
  const actual = simulateHavocBattleGame(
    input,
    createEngineContext({
      rngFactory: (seed) => {
        const rng = customRng(seed);
        return {
          ...rng,
          next() {
            if (!nested) {
              nested = true;
              expect(simulateHavocBattleGame(input, createEngineContext())).toEqual(expected);
            }
            return rng.next();
          },
        };
      },
    }),
  );
  expect(nested).toBe(true);
  expect(actual).toEqual(expected);
});

it('supplies domain items to custom weighted-pick callbacks', () => {
  let picks = 0;
  const input = lockedBattleInput();
  const expected = simulateHavocBattleGame(input, createEngineContext());
  const actual = simulateHavocBattleGame(
    input,
    createEngineContext({
      rngFactory: (seed) => {
        const rng = customRng(seed);
        return {
          ...rng,
          weightedPickTable(items, table) {
            picks += 1;
            expect(
              items.every((item) => typeof item === 'string' || typeof item === 'object'),
            ).toBe(true);
            return rng.weightedPickTable(items, table);
          },
        };
      },
    }),
  );
  expect(picks).toBeGreaterThan(0);
  expect(actual).toEqual(expected);
});
