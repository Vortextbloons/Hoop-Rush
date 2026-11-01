import { describe, expect, it } from 'bun:test';
import {
  createEngineContext,
  createGameInput,
  gameResultDigest,
  simulateGame,
} from '../../index.ts';
import { chooseBestRunSeed, chooseBestRunSeedWithGames } from './selection.ts';
import { buildChallengeRun, buildEraSimulationProfile } from '@hoop-rush/test-fixtures';

const PROFILE = buildEraSimulationProfile();
const context = createEngineContext();

function fixtureRun(): ReturnType<typeof buildChallengeRun> {
  return buildChallengeRun({ runId: 'selection-run' });
}

function digests(results: readonly { readonly gameNumber: number }[]): string[] {
  return results.map((result) => gameResultDigest(result as never));
}

describe('chooseBestRunSeedWithGames', () => {
  it('chooses the same attempt as chooseBestRunSeed', () => {
    const run = fixtureRun();
    const choice = chooseBestRunSeed(run, PROFILE, context);
    const withGames = chooseBestRunSeedWithGames(run, PROFILE, context);
    expect(withGames.chosenRunSeed).toBe(choice.chosenRunSeed);
    expect(withGames.chosenWins).toBe(choice.chosenWins);
    expect(withGames.chosenLosses).toBe(choice.chosenLosses);
    expect(withGames.chosenDifferential).toBe(choice.chosenDifferential);
  });

  it('returns the chosen attempt games that a fresh simulation reproduces', () => {
    const run = fixtureRun();
    const choice = chooseBestRunSeedWithGames(run, PROFILE, context);
    expect(choice.chosenGames).toHaveLength(82);
    expect(choice.chosenGames.map((game) => game.gameNumber)).toEqual(
      Array.from({ length: 82 }, (_, index) => index + 1),
    );
    const chosenRun = { ...run, runSeed: choice.chosenRunSeed };
    const replayed = Array.from({ length: 82 }, (_, index) =>
      simulateGame(createGameInput(chosenRun, PROFILE, index + 1), context),
    );
    expect(digests(choice.chosenGames)).toEqual(digests(replayed));
  });

  it('reports a score that matches the returned games', () => {
    const run = fixtureRun();
    const choice = chooseBestRunSeedWithGames(run, PROFILE, context);
    const wins = choice.chosenGames.filter(
      (game) => game.home.box.points > game.away.box.points,
    ).length;
    const differential = choice.chosenGames.reduce(
      (total, game) => total + game.home.box.points - game.away.box.points,
      0,
    );
    expect(choice.chosenWins).toBe(wins);
    expect(choice.chosenLosses).toBe(82 - wins);
    expect(choice.chosenDifferential).toBe(differential);
  });

  it('is deterministic across calls', () => {
    const run = fixtureRun();
    const first = chooseBestRunSeedWithGames(run, PROFILE, context);
    const second = chooseBestRunSeedWithGames(fixtureRun(), PROFILE, context);
    expect(second.chosenRunSeed).toBe(first.chosenRunSeed);
    expect(digests(second.chosenGames)).toEqual(digests(first.chosenGames));
  });
});
