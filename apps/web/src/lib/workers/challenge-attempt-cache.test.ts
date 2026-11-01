import { describe, expect, it } from 'bun:test';
import { createEngineContext, createGameInput, simulateGame } from '@hoop-rush/engine';
import { playerIdSchema, seedSchema } from '@hoop-rush/data-contracts';
import { buildChallengeRun, buildEraSimulationProfile } from '@hoop-rush/test-fixtures';
import { ChallengeAttemptCache, challengeAttemptIdentity } from './challenge-attempt-cache';

const PROFILE = buildEraSimulationProfile();
const ENGINE_VERSION = 'cache-test-engine';
const context = createEngineContext({ engineVersion: ENGINE_VERSION });

const RUN = buildChallengeRun({ runId: 'cache-run' });

function gamesOf(runSeed: string) {
  const run = { ...RUN, runSeed: seedSchema.parse(runSeed) };
  return Array.from({ length: 82 }, (_, index) =>
    simulateGame(createGameInput(run, PROFILE, index + 1), context),
  );
}

describe('ChallengeAttemptCache', () => {
  it('returns retained games for the identical attempt and consumes them', () => {
    const games = gamesOf(RUN.runSeed);
    const cache = new ChallengeAttemptCache();
    cache.retain(RUN, PROFILE, ENGINE_VERSION, games);
    expect(cache.take(RUN, PROFILE, ENGINE_VERSION, 1)).toBe(games);
    expect(cache.take(RUN, PROFILE, ENGINE_VERSION, 1)).toBeNull();
  });

  it('rejects a different run seed, engine version, or profile', () => {
    const games = gamesOf(RUN.runSeed);
    const otherSeed = {
      ...RUN,
      runSeed: seedSchema.parse('ffffffffffffffffffffffffffffffff'),
    };
    const otherProfile = buildEraSimulationProfile({ profileVersion: 'm2-1990s-fixture-v2' });

    const cases = [
      (cache: ChallengeAttemptCache) => cache.take(otherSeed, PROFILE, ENGINE_VERSION, 1),
      (cache: ChallengeAttemptCache) => cache.take(RUN, PROFILE, 'other-engine', 1),
      (cache: ChallengeAttemptCache) => cache.take(RUN, otherProfile, ENGINE_VERSION, 1),
    ];
    for (const attempt of cases) {
      const cache = new ChallengeAttemptCache();
      cache.retain(RUN, PROFILE, ENGINE_VERSION, games);
      expect(attempt(cache)).toBeNull();
    }
  });

  it('rejects a resumed run that already holds games', () => {
    const games = gamesOf(RUN.runSeed);
    const resumed = { ...RUN, games: games.slice(0, 1) };
    const cache = new ChallengeAttemptCache();
    cache.retain(resumed, PROFILE, ENGINE_VERSION, games);
    expect(cache.take(resumed, PROFILE, ENGINE_VERSION, 1)).toBeNull();
  });

  it('rejects a request that starts after game 1', () => {
    const games = gamesOf(RUN.runSeed);
    const cache = new ChallengeAttemptCache();
    cache.retain(RUN, PROFILE, ENGINE_VERSION, games);
    expect(cache.take(RUN, PROFILE, ENGINE_VERSION, 40)).toBeNull();
    // A rejected take still drops the attempt; it is only ever used once.
    expect(cache.take(RUN, PROFILE, ENGINE_VERSION, 1)).toBeNull();
  });

  it('retains nothing unless a whole run was simulated', () => {
    const cache = new ChallengeAttemptCache();
    cache.retain(RUN, PROFILE, ENGINE_VERSION, gamesOf(RUN.runSeed).slice(0, 81));
    expect(cache.take(RUN, PROFILE, ENGINE_VERSION, 1)).toBeNull();
  });

  it('drops the attempt on clear', () => {
    const cache = new ChallengeAttemptCache();
    cache.retain(RUN, PROFILE, ENGINE_VERSION, gamesOf(RUN.runSeed));
    cache.clear();
    expect(cache.take(RUN, PROFILE, ENGINE_VERSION, 1)).toBeNull();
  });

  it('identifies attempts by every input the simulation derives from', () => {
    const base = challengeAttemptIdentity(RUN, PROFILE, ENGINE_VERSION);
    expect(challengeAttemptIdentity(RUN, PROFILE, ENGINE_VERSION)).toBe(base);
    expect(challengeAttemptIdentity({ ...RUN, games: [] }, PROFILE, ENGINE_VERSION)).toBe(base);
    expect(
      challengeAttemptIdentity(
        { ...RUN, versions: { ...RUN.versions, engineVersion: 'other' } },
        PROFILE,
        ENGINE_VERSION,
      ),
    ).not.toBe(base);
    expect(
      challengeAttemptIdentity(
        {
          ...RUN,
          players: RUN.players.map((player, index) => ({
            ...player,
            playerId: playerIdSchema.parse(`p-x${String(index)}`),
          })),
        },
        PROFILE,
        ENGINE_VERSION,
      ),
    ).not.toBe(base);
  });
});
