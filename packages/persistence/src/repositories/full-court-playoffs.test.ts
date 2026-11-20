import { afterEach, expect, test } from 'bun:test';
import {
  CAP_RUSH_FRANCHISE_ALIGNMENT,
  FULL_COURT_HEALTH_VERSION,
  FULL_COURT_PLAYOFFS_VERSION,
  fullCourtPlayoffCheckpointSchema,
} from '@hoop-rush/data-contracts';
import {
  openTestDatabasePair,
  resetIndexedDb,
  restoreIndexedDb,
} from '../testing/repo-test-support.ts';
import { createFullCourtPlayoffRepository } from './full-court-playoffs.ts';

afterEach(restoreIndexedDb);

test('saves the game and health together, reopens, and rejects conflicting replays', async () => {
  resetIndexedDb();
  const { first, second } = openTestDatabasePair('full-court-playoffs');
  const before = fullCourtPlayoffCheckpointSchema.parse({
    schemaVersion: FULL_COURT_PLAYOFFS_VERSION,
    runId: 'playoffs',
    lockDigest: '0123456789abcdef',
    games: [],
    healthByTeam: Object.fromEntries(
      CAP_RUSH_FRANCHISE_ALIGNMENT.map(
        ({ franchiseId }) =>
          [
            franchiseId,
            {
              teamId: franchiseId,
              version: FULL_COURT_HEALTH_VERSION,
              throughDay: 170,
              players: {},
            },
          ] as const,
      ),
    ),
  });
  const after = fullCourtPlayoffCheckpointSchema.parse({
    ...before,
    games: [
      {
        gameId: 'fcp-1-0-1',
        dayOffset: 173,
        homeTeamId: 'celtics',
        awayTeamId: 'knicks',
        winnerTeamId: 'celtics',
        outcome: { kind: 'played', homePoints: 100, awayPoints: 97 },
      },
    ],
    healthByTeam: {
      ...before.healthByTeam,
      celtics: { ...before.healthByTeam.celtics, throughDay: 173 },
      knicks: { ...before.healthByTeam.knicks, throughDay: 173 },
    },
  });
  const repository = createFullCourtPlayoffRepository(first);
  await repository.create(before);
  await expect(
    repository.commitGame({ ...after, healthByTeam: before.healthByTeam }),
  ).rejects.toThrow('health does not match');
  expect(await repository.load(before.runId)).toEqual(before);
  await repository.commitGame(after);
  first.close();

  const reopened = createFullCourtPlayoffRepository(second);
  await reopened.create(before);
  await reopened.commitGame(after);
  expect(await reopened.load(before.runId)).toEqual(after);
  const conflict = structuredClone(after);
  const original = conflict.games[0];
  if (original?.outcome.kind !== 'played') throw new Error('Missing fixture');
  original.outcome.homePoints += 1;
  await expect(reopened.commitGame(conflict)).rejects.toThrow('does not append');
  expect(await reopened.load(before.runId)).toEqual(after);
  second.close();
});
