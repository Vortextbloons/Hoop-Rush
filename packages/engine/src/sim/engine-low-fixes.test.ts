import { describe, expect, it } from 'vitest';
import { seedSchema } from '@hoop-rush/data-contracts';
import {
  buildEraSimulationProfile,
  buildLegalSimulationTeam,
  seedFromString,
} from '@hoop-rush/test-fixtures';
import { createEngineContext } from './context.ts';
import { DEEP_FOUR_FT_MISS } from './evolution-rules.ts';
import { createGameState, createTripContext } from './possession.ts';
import { GameRecorder } from './recorder.ts';
import { buildWeightedPickTable, createRng } from './rng.ts';

describe('sim low fixes', () => {
  it('rejects non-finite weights instead of biasing toward the last item', () => {
    expect(() => buildWeightedPickTable([1, NaN])).toThrow(/finite/);
    expect(() => buildWeightedPickTable([1, Infinity])).toThrow(/finite/);
    expect(() => buildWeightedPickTable([1, -Infinity])).toThrow(/finite/);
    const table = buildWeightedPickTable([0, 0]);
    expect(table.total).toBe(0);
    const rng = createRng(seedSchema.parse(seedFromString('lowfix-uniform-fallback')));
    expect(rng.weightedPick(['a', 'b'], table)).toMatch(/^[ab]$/);
  });

  it('marks versionless trip units explicitly instead of recording blank ids', () => {
    const home = buildLegalSimulationTeam();
    const away = buildLegalSimulationTeam({
      teamId: 'fixture-away',
      displayName: 'Fixture Away',
    });
    const rng = createEngineContext().rngFactory(seedSchema.parse(seedFromString('lowfix-units')));
    const ctx = createTripContext(
      rng,
      new GameRecorder(),
      createGameState(),
      buildEraSimulationProfile(),
      [home, away],
    );
    expect(ctx.teamUnits[0]).toEqual(home.players.map((player) => `missing:${player.playerId}`));
    expect(ctx.teamUnits[1]).toEqual(away.players.map((player) => `missing:${player.playerId}`));
    expect(ctx.teamUnits.flat().some((id) => id === '')).toBe(false);
  });

  it('keeps the deep-four free-throw count identical to the previous literal', () => {
    expect(DEEP_FOUR_FT_MISS).toBe(4);
  });
});
