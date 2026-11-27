import type { FullCourtPlayoffCheckpoint, FullCourtWatchedReplay } from '@hoop-rush/data-contracts';
import {
  createFullCourtPlayoffCheckpoint,
  fullCourtPlayoffView,
  lockFullCourtPlayoffs,
  type FullCourtPlayoffGameOutcome,
  type FullCourtPlayoffLock,
  type FullCourtSeasonLock,
  type FullCourtSeasonSlotOptions,
} from '@hoop-rush/engine';
import { buildFullCourtWatchedReplay } from './replay.ts';
import type { FullCourtSeasonRepository } from './season.ts';

export interface FullCourtPlayoffRepository {
  load(runId: string): Promise<FullCourtPlayoffCheckpoint | null>;
  create(checkpoint: FullCourtPlayoffCheckpoint): Promise<void>;
  commitGame(
    checkpoint: FullCourtPlayoffCheckpoint,
    options?: { readonly watchedReplay?: FullCourtWatchedReplay },
  ): Promise<void>;
}

export async function startFullCourtPlayoffs(
  season: FullCourtSeasonLock,
  dependencies: {
    readonly regular: Pick<FullCourtSeasonRepository, 'load' | 'listScores'>;
    readonly playoffs: FullCourtPlayoffRepository;
  },
) {
  const runId = season.season.runId;
  const [regular, scores] = await Promise.all([
    dependencies.regular.load(runId),
    dependencies.regular.listScores(runId),
  ]);
  if (regular === null) throw new Error('Full Court regular-season checkpoint is missing');
  const lock = lockFullCourtPlayoffs(season, regular, scores);
  await dependencies.playoffs.create(createFullCourtPlayoffCheckpoint(lock));
  const checkpoint = await dependencies.playoffs.load(runId);
  if (checkpoint === null) throw new Error('Full Court playoff checkpoint was not created');
  return { lock, checkpoint, view: fullCourtPlayoffView(lock, checkpoint) };
}

export async function advanceFullCourtPlayoffs(
  input: {
    readonly lock: FullCourtPlayoffLock;
    readonly expectedGames: number;
    readonly options?: FullCourtSeasonSlotOptions;
  },
  dependencies: {
    readonly repository: FullCourtPlayoffRepository;
    readonly simulateGame: (
      lock: FullCourtPlayoffLock,
      checkpoint: FullCourtPlayoffCheckpoint,
      options: FullCourtSeasonSlotOptions,
    ) => FullCourtPlayoffGameOutcome | Promise<FullCourtPlayoffGameOutcome>;
  },
): Promise<
  FullCourtPlayoffGameOutcome | { readonly kind: 'stale'; readonly committedGames: number }
> {
  const { lock } = input;
  const checkpoint = await dependencies.repository.load(lock.seasonLock.season.runId);
  if (checkpoint === null) throw new Error('Start Full Court playoffs before simulating a game');
  const nextFixture = fullCourtPlayoffView(lock, checkpoint).nextGame;
  if (checkpoint.games.length !== input.expectedGames)
    return { kind: 'stale', committedGames: checkpoint.games.length };
  const outcome = await dependencies.simulateGame(lock, checkpoint, input.options ?? {});
  if (outcome.kind !== 'simulated') return outcome;
  if (outcome.checkpoint.games.length !== checkpoint.games.length + 1)
    throw new Error('Full Court playoffs did not return the next game');
  fullCourtPlayoffView(lock, outcome.checkpoint);
  const watchedReplay =
    input.options?.record === true &&
    nextFixture !== null &&
    nextFixture.userSide !== null &&
    outcome.game.kind === 'played' &&
    outcome.game.tape !== null
      ? buildFullCourtWatchedReplay({
          phase: 'playoff',
          runId: lock.seasonLock.season.runId,
          seasonLockDigest: lock.seasonLock.digest,
          lockDigest: lock.digest,
          gameId: nextFixture.gameId,
          slot: null,
          dayOffset: nextFixture.dayOffset,
          userTeamId: lock.seasonLock.season.userTeamId,
          game: outcome.game,
        })
      : undefined;
  await dependencies.repository.commitGame(
    outcome.checkpoint,
    watchedReplay === undefined ? undefined : { watchedReplay },
  );
  return outcome;
}
