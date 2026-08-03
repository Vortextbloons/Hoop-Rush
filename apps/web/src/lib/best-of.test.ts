import { describe, expect, it } from 'vitest';
import type { Seed } from '@hoop-rush/data-contracts';
import {
  buildFixtureBracket,
  buildGameSimulationInput,
  buildUserTeam,
  seedFromString,
} from '@hoop-rush/test-fixtures';
import {
  BEST_OF_ATTEMPTS,
  createChallenge,
  createEngineContext,
  deriveAttemptSeed,
  simulateChallengeBestOf,
  type ChallengeCreation,
} from '@hoop-rush/engine';
import { chooseBestRunFromRun } from './best-of';

/**
 * Worker best-of parity (spec/01 sandbox loop): the challenge worker's
 * chooseBestRunFromRun must choose exactly the attempt the engine's
 * main-thread simulateChallengeBestOf would, because the persisted run seed
 * drives per-game seeds, resume, and result validation.
 */

const context = createEngineContext();

/** Sandbox creation built exactly like apps/web sandbox-run.ts. */
function fixtureCreation(runSeed: Seed): ChallengeCreation {
  const bracket = buildFixtureBracket();
  const team = buildUserTeam();
  return {
    runId: 'run-best-of-web',
    mode: 'sandbox',
    franchiseId: 'lakers',
    eraId: '1990s',
    homeDisplayName: 'Los Angeles Lakers',
    lineup: {
      structure: ['G', 'G', 'F', 'F', 'C'],
      assignments: team.players.map((player, slotIndex) => ({
        slotIndex: slotIndex as 0 | 1 | 2 | 3 | 4,
        playerId: player.playerId,
        positions: player.positions,
      })),
    },
    players: team.players,
    selections: team.players.map((player) => ({
      playerId: player.playerId,
      franchiseId: 'lakers',
      eraId: '1990s',
    })),
    runSeed,
    dataVersion: 'data-v1',
    ratingVersion: 'ratings-v1',
    positionNormalizationVersion: 'position-v1',
    engineVersion: context.engineVersion,
    profile: buildGameSimulationInput().profile,
    bracket,
  };
}

describe('chooseBestRunFromRun (worker best-of)', () => {
  it('is deterministic: the same run and profile choose the same attempt', () => {
    const creation = fixtureCreation(seedFromString('worker-best-of'));
    const run = createChallenge(creation);
    const first = chooseBestRunFromRun(run, creation.profile, context);
    const second = chooseBestRunFromRun(run, creation.profile, context);
    expect(second).toEqual(first);
  });

  it('chooses one of the derived attempt seeds', () => {
    const creation = fixtureCreation(seedFromString('worker-best-of'));
    const run = createChallenge(creation);
    const chosen = chooseBestRunFromRun(run, creation.profile, context);
    const attemptSeeds = Array.from({ length: BEST_OF_ATTEMPTS }, (_, attempt) =>
      deriveAttemptSeed(run.runSeed, attempt),
    );
    expect(attemptSeeds).toContain(chosen.chosenRunSeed);
  });

  it('matches the engine main-thread best-of choice for the same creation', () => {
    const creation = fixtureCreation(seedFromString('worker-best-of'));
    const engineChosen = simulateChallengeBestOf(creation, creation.profile, context);
    const chosen = chooseBestRunFromRun(
      createChallenge({ ...creation, runSeed: creation.runSeed }),
      creation.profile,
      context,
    );
    expect(chosen.chosenRunSeed).toBe(engineChosen.runSeed);
    expect(chosen.chosenWins).toBe(engineChosen.aggregates.team.wins);
    expect(chosen.chosenLosses).toBe(engineChosen.aggregates.team.losses);
    let differential = 0;
    for (const game of engineChosen.games) {
      differential += game.home.box.points - game.away.box.points;
    }
    expect(chosen.chosenDifferential).toBe(differential);
  });
});
