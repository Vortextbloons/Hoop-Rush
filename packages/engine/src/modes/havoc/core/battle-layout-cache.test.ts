import { describe, expect, test } from 'bun:test';
import { buildHavocGameInput } from '@hoop-rush/test-fixtures';
import { seedSchema } from '@hoop-rush/data-contracts';
import { createEngineContext } from '../../../sim/kernel.ts';
import { createRng } from '../../../sim/rng.ts';
import { soloToBattleInputValidated } from './battle-adapters.ts';
import { simulateValidatedHavocBattleGame } from './battle-game.ts';

/**
 * The layout template cache reuses a team's block across opponents and games,
 * rewriting only the turnover and shooting-foul regions on each use.
 *
 * These tests compare the cached path against the uncached full build. A custom
 * RNG factory is functionally identical to the built-in one but has a different
 * identity, which makes the simulator take the full-build path, so every
 * comparison below is genuinely "cached vs freshly computed".
 */
describe('battle layout template cache', () => {
  const seedOf = (value: string) => {
    let hex = '';
    for (const char of value) hex += char.charCodeAt(0).toString(16).padStart(2, '0');
    return seedSchema.parse(hex.padEnd(16, '0').slice(0, 16));
  };

  // Same numbers as createRng, different function identity: forces the
  // uncached layout build without changing any random draw.
  const uncachedContext = () => createEngineContext({ rngFactory: (seed) => createRng(seed) });
  const cachedContext = () => createEngineContext();

  const raiseOpponentRatings = (
    input: ReturnType<typeof soloToBattleInputValidated>,
    by: number,
  ) => {
    for (const participant of [
      ...input.away.starters,
      ...input.away.replacements,
      ...input.away.clones,
    ]) {
      for (const key of Object.keys(participant.source.profile.ratings) as Array<
        keyof typeof participant.source.profile.ratings
      >) {
        participant.source.profile.ratings[key] = Math.min(
          99,
          participant.source.profile.ratings[key] + by,
        );
        participant.effective.ratings[key] = Math.min(99, participant.effective.ratings[key] + by);
      }
    }
  };

  test('cached build matches the uncached build for the same matchup', () => {
    const input = soloToBattleInputValidated(buildHavocGameInput());
    input.seed = seedOf('cachedvsuncached');

    const cached = simulateValidatedHavocBattleGame(input, cachedContext());
    const uncached = simulateValidatedHavocBattleGame(input, uncachedContext());
    expect(cached.result).toEqual(uncached.result);
    expect(cached.tape).toEqual(uncached.tape);
  });

  test('cached build matches the uncached build after the opponent changes', () => {
    // First matchup warms the cache under the original opponent.
    const base = soloToBattleInputValidated(buildHavocGameInput());
    base.seed = seedOf('opponentchange');

    const warmed = simulateValidatedHavocBattleGame(base, cachedContext());
    // Sanity: the warm-up run is the one whose block the cache now holds.
    expect(warmed.result.gameNumber).toBe(base.gameNumber);

    // A different opponent rating must not inherit the cached regions.
    const changed = structuredClone(base);
    raiseOpponentRatings(changed, 25);

    const cachedChanged = simulateValidatedHavocBattleGame(changed, cachedContext());
    const uncachedChanged = simulateValidatedHavocBattleGame(changed, uncachedContext());
    expect(cachedChanged.result).toEqual(uncachedChanged.result);
    expect(cachedChanged.tape).toEqual(uncachedChanged.tape);

    // And it really is a different game, so the comparison has teeth.
    expect(cachedChanged.result.home.points).not.toBe(warmed.result.home.points);
  });

  test('cached build matches the uncached build after shooting anchors change', () => {
    // Anchors live on the simulation players rather than the kernel spec, so a
    // key derived only from the spec would alias two different teams here. This
    // is the shape Cap Rush playoff performance adjustments take.
    const base = soloToBattleInputValidated(buildHavocGameInput());
    base.seed = seedOf('anchorchange1');

    simulateValidatedHavocBattleGame(base, cachedContext());

    const adjusted = structuredClone(base);
    for (const participant of [
      ...adjusted.home.starters,
      ...adjusted.home.replacements,
      ...adjusted.home.clones,
    ]) {
      const anchors = participant.source.profile.anchors;
      if (anchors === undefined || anchors.threePointPct === null) continue;
      participant.source.profile.anchors = {
        ...anchors,
        threePointPct: Math.min(0.95, anchors.threePointPct + 0.2),
      };
    }

    const cached = simulateValidatedHavocBattleGame(adjusted, cachedContext());
    const uncached = simulateValidatedHavocBattleGame(adjusted, uncachedContext());
    expect(cached.result).toEqual(uncached.result);
    expect(cached.tape).toEqual(uncached.tape);
  });

  test('cached build matches the uncached build across many seeds and opponents', () => {
    for (const seedText of ['seedaa', 'seedbb', 'seedcc', 'seeddd']) {
      for (const delta of [0, -20, 20]) {
        const input = soloToBattleInputValidated(buildHavocGameInput());
        input.seed = seedOf(`${seedText}${String(delta)}`);
        if (delta !== 0) raiseOpponentRatings(input, delta);
        const cached = simulateValidatedHavocBattleGame(input, cachedContext());
        const uncached = simulateValidatedHavocBattleGame(input, uncachedContext());
        expect(cached.result).toEqual(uncached.result);
        expect(cached.tape).toEqual(uncached.tape);
      }
    }
  });
});
